import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AiProposalService } from '../src/modules/ai/ai-proposal.service';
import type { TenantContext } from '../src/common/tenancy/tenant-context';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(180_000);

type OperationType = 'UPDATE_RECORD' | 'CREATE_FOLLOW_UP' | 'ADD_ACTIVITY_NOTE';

function isolatedUrl(name: string): URL {
  const url = new URL(process.env[name] ?? '');
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '55433' ||
    url.pathname !== '/crm_v1b_test'
  ) {
    throw new Error(`Refusing non-isolated database in ${name}`);
  }
  return url;
}

function candidate(type: OperationType, recordId: string) {
  if (type === 'UPDATE_RECORD') {
    return {
      operationType: type,
      objectCode: 'leads',
      recordId,
      values: { name: 'HTTP confirmed' },
    };
  }
  if (type === 'CREATE_FOLLOW_UP') {
    return {
      operationType: type,
      objectCode: 'leads',
      recordId,
      title: 'HTTP follow-up',
      dueAt: '2026-10-01T12:00:00Z',
    };
  }
  return {
    operationType: type,
    objectCode: 'leads',
    recordId,
    content: 'HTTP note',
  };
}

describe('AI confirmation API acceptance (isolated HTTP + DB)', () => {
  let harness: CriticalHarness;
  let fixture: CriticalFixture;
  let proposals: AiProposalService;
  let context: TenantContext;

  beforeAll(async () => {
    const admin = isolatedUrl('TEST_DATABASE_ADMIN_URL');
    const runtime = isolatedUrl('TEST_DATABASE_URL');
    if (admin.username !== 'crm' || runtime.username !== 'crm_app') {
      throw new Error('Refusing unexpected database roles');
    }
    harness = await createCriticalHarness();
    proposals = harness.app.get(AiProposalService);
  });

  beforeEach(async () => {
    fixture = await provisionCriticalFixture(harness);
    context = {
      tenantId: fixture.tenantA.id,
      tenantCode: fixture.tenantA.code,
      memberId: fixture.employee.memberId,
      userId: fixture.employee.userId,
      role: 'EMPLOYEE',
    };
  });

  afterAll(async () => {
    if (harness) await closeCriticalHarness(harness);
  });

  async function proposal(type: OperationType = 'ADD_ACTIVITY_NOTE') {
    const turnId = randomUUID();
    const conversation = await harness.adminDatabase.aiConversation.create({
      data: {
        tenantId: context.tenantId,
        createdByMemberId: context.memberId,
        title: 'HTTP acceptance',
        lastMessageAt: new Date(),
      },
    });
    await harness.adminDatabase.aiMessage.create({
      data: {
        tenantId: context.tenantId,
        conversationId: conversation.id,
        turnId,
        role: 'USER',
        status: 'COMPLETED',
        content: 'make the change',
      },
    });
    return proposals.preview(
      context,
      turnId,
      candidate(type, fixture.ownedRecord.id),
      'make the change',
    );
  }

  it.each(['UPDATE_RECORD', 'CREATE_FOLLOW_UP', 'ADD_ACTIVITY_NOTE'] as const)(
    'runs %s through HTTP preview status and confirm, with no write before confirm',
    async (type) => {
      const before = await Promise.all([
        harness.adminDatabase.record.findUniqueOrThrow({
          where: { id: fixture.ownedRecord.id },
        }),
        harness.adminDatabase.recordFollowUp.count(),
        harness.adminDatabase.recordActivity.count(),
        harness.adminDatabase.auditLog.count(),
      ]);
      const view = await proposal(type);
      const base = `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${view.proposalId}`;

      const preview = await request(harness.app.getHttpServer())
        .get(base)
        .set('Cookie', fixture.employee.cookie)
        .expect(200);
      expect(preview.body).toMatchObject({
        proposalId: view.proposalId,
        status: 'PROPOSED',
      });
      expect(
        await Promise.all([
          harness.adminDatabase.record.findUniqueOrThrow({
            where: { id: fixture.ownedRecord.id },
          }),
          harness.adminDatabase.recordFollowUp.count(),
          harness.adminDatabase.recordActivity.count(),
          harness.adminDatabase.auditLog.count(),
        ]),
      ).toEqual(before);

      const confirmed = await request(harness.app.getHttpServer())
        .post(`${base}/confirm`)
        .set('Cookie', fixture.employee.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('X-Request-Id', randomUUID())
        .send({ idempotencyKey: randomUUID() })
        .expect(200);
      expect(confirmed.body).toMatchObject({
        proposalId: view.proposalId,
        status: 'EXECUTED',
      });
      expect(confirmed.body.auditId).toEqual(expect.any(String));
      const operation = await harness.adminDatabase.aiOperation.findUniqueOrThrow({
        where: { id: view.proposalId },
      });
      expect(operation.status).toBe('EXECUTED');
      expect(operation.auditId).toBe(confirmed.body.auditId);
      expect(await harness.adminDatabase.auditLog.findUnique({ where: { id: operation.auditId! } })).toMatchObject({
        id: operation.auditId,
        after: expect.objectContaining({ aiOperationId: view.proposalId }),
      });
    },
  );

  it('denies cross-tenant and different-member HTTP reads/confirms without mutation', async () => {
    const view = await proposal('UPDATE_RECORD');
    const path = `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${view.proposalId}`;
    await request(harness.app.getHttpServer())
      .get(`/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${view.proposalId}`)
      .set('Cookie', fixture.otherEmployee.cookie)
      .expect(404);
    await request(harness.app.getHttpServer())
      .post(`${path}/confirm`)
      .set('Cookie', fixture.otherEmployee.cookie)
      .send({ idempotencyKey: randomUUID() })
      .expect(403);
    await request(harness.app.getHttpServer())
      .get(`/api/v1/workspaces/${fixture.tenantB.code}/ai/proposals/${view.proposalId}`)
      .set('Cookie', fixture.tenantBAdmin.cookie)
      .expect(404);
    expect(
      await harness.adminDatabase.aiOperation.findUniqueOrThrow({
        where: { id: view.proposalId },
      }),
    ).toMatchObject({ status: 'PROPOSED', auditId: null });
  });

  it('rechecks permission, record version, and expiry at HTTP confirm', async () => {
    const permission = await proposal('UPDATE_RECORD');
    await harness.adminDatabase.objectPermission.create({
      data: {
        tenantId: context.tenantId,
        objectId: fixture.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: context.memberId,
        canRead: true,
        canUpdate: false,
        readScope: 'OWN',
        updateScope: 'NONE',
      },
    });
    await request(harness.app.getHttpServer())
      .post(`/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${permission.proposalId}/confirm`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ idempotencyKey: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('CONFLICTED'));
    await harness.adminDatabase.objectPermission.deleteMany({
      where: { tenantId: context.tenantId, objectId: fixture.object.id, subjectMemberId: context.memberId },
    });

    const stale = await proposal('ADD_ACTIVITY_NOTE');
    await harness.adminDatabase.record.update({
      where: { id: fixture.ownedRecord.id },
      data: { version: { increment: 1 } },
    });
    await request(harness.app.getHttpServer())
      .post(`/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${stale.proposalId}/confirm`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ idempotencyKey: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('CONFLICTED'));

    const expired = await proposal('CREATE_FOLLOW_UP');
    await harness.adminDatabase.aiOperation.update({
      where: { id: expired.proposalId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(harness.app.getHttpServer())
      .post(`/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${expired.proposalId}/confirm`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ idempotencyKey: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('EXPIRED'));
  });

  it('makes concurrent duplicate HTTP confirms idempotent and failed stored input leaves no audit', async () => {
    const view = await proposal('ADD_ACTIVITY_NOTE');
    const path = `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${view.proposalId}/confirm`;
    const [first, second] = await Promise.all(
      [randomUUID(), randomUUID()].map((idempotencyKey) =>
        request(harness.app.getHttpServer())
          .post(path)
          .set('Cookie', fixture.employee.cookie)
          .set('Origin', 'http://localhost:3000')
          .send({ idempotencyKey }),
      ),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.status).toBe('EXECUTED');
    expect(second.body.status).toBe('EXECUTED');
    expect(await harness.adminDatabase.recordActivity.count()).toBe(1);
    expect(await harness.adminDatabase.auditLog.count()).toBe(1);

    const failed = await proposal('CREATE_FOLLOW_UP');
    await harness.adminDatabase.aiOperation.update({
      where: { id: failed.proposalId },
      data: {
        proposalJson: {
          operationType: 'CREATE_FOLLOW_UP',
          objectCode: 'leads',
          recordId: fixture.ownedRecord.id,
          title: '',
          dueAt: 'invalid',
        },
      },
    });
    const before = await harness.adminDatabase.auditLog.count();
    await request(harness.app.getHttpServer())
      .post(`/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${failed.proposalId}/confirm`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ idempotencyKey: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('FAILED'));
    expect(await harness.adminDatabase.auditLog.count()).toBe(before);
    expect(
      await harness.adminDatabase.aiOperation.findUniqueOrThrow({ where: { id: failed.proposalId } }),
    ).toMatchObject({ status: 'FAILED', auditId: null });
  });
});
