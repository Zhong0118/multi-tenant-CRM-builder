import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AiProposalService } from '../src/modules/ai/ai-proposal.service';
import { validateProposalCandidate } from '../src/modules/ai/ai-proposal.schema';
import { parsePublishedObjectSchema } from '../src/modules/objects/published-object.service';
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
    'creates %s through an HTTP turn and restores its safe proposal before confirmation',
    async (type) => {
      const before = await Promise.all([
        harness.adminDatabase.record.findUniqueOrThrow({
          where: { id: fixture.ownedRecord.id },
        }),
        harness.adminDatabase.recordFollowUp.count(),
        harness.adminDatabase.recordActivity.count(),
        harness.adminDatabase.auditLog.count(),
      ]);
      const base = `/api/v1/workspaces/${fixture.tenantA.code}/ai`;
      const turn = await request(harness.app.getHttpServer())
        .post(`${base}/turns`)
        .set('Cookie', fixture.employee.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('Accept', 'text/event-stream')
        .send({
          content: `critical:propose-change:${type}:${fixture.ownedRecord.id}`,
        })
        .expect(200);
      expect(turn.headers['content-type']).toMatch(/text\/event-stream/);
      const events = turn.text
        .split('\n\n')
        .filter(Boolean)
        .map((block) => {
          const name = block
            .split('\n')
            .find((line) => line.startsWith('event: '));
          const data = block
            .split('\n')
            .find((line) => line.startsWith('data: '));
          return {
            event: name?.slice(7),
            data: data ? JSON.parse(data.slice(6)) : null,
          };
        });
      const ready = events.find((event) => event.event === 'proposal.ready');
      expect(ready).toBeDefined();
      expect(events.map((event) => event.event)).toContain('turn.completed');
      const view = ready!.data.proposal;
      expect(view).toMatchObject({ operation: type, status: 'PROPOSED' });
      const safeStream = JSON.stringify(events);
      for (const secret of [
        'hidden-owned',
        'hidden-other',
        '"secret"',
        'provider-raw-secret',
      ]) {
        expect(safeStream).not.toContain(secret);
      }
      const preview = await request(harness.app.getHttpServer())
        .get(`${base}/proposals/${view.proposalId}`)
        .set('Cookie', fixture.employee.cookie)
        .expect(200);
      expect(preview.body).toMatchObject(view);
      const conversationId = events.find(
        (event) => event.event === 'conversation.ready',
      )!.data.conversationId;
      const history = await request(harness.app.getHttpServer())
        .get(`${base}/conversations/${conversationId}/messages`)
        .set('Cookie', fixture.employee.cookie)
        .expect(200);
      expect(JSON.stringify(history.body)).toContain(view.proposalId);
      for (const secret of [
        'hidden-owned',
        'hidden-other',
        '"secret"',
        'provider-raw-secret',
      ]) {
        expect(JSON.stringify(preview.body)).not.toContain(secret);
        expect(JSON.stringify(history.body)).not.toContain(secret);
      }
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
        .post(`${base}/proposals/${view.proposalId}/confirm`)
        .set('Cookie', fixture.employee.cookie)
        .set('Origin', 'http://localhost:3000')
        .send({ idempotencyKey: randomUUID() })
        .expect(200);
      expect(confirmed.body).toMatchObject({
        status: 'EXECUTED',
        auditId: expect.any(String),
      });
      const operation =
        await harness.adminDatabase.aiOperation.findUniqueOrThrow({
          where: { id: view.proposalId },
        });
      expect(operation.auditId).toBe(confirmed.body.auditId);
      const audit = await harness.adminDatabase.auditLog.findUnique({
        where: { id: operation.auditId! },
      });
      expect(audit).toMatchObject({
        after: expect.objectContaining({ aiOperationId: view.proposalId }),
      });
      expect(audit?.action).toBe(
        {
          UPDATE_RECORD: 'record.updated',
          CREATE_FOLLOW_UP: 'follow_up.created',
          ADD_ACTIVITY_NOTE: 'record.activity_created',
        }[type],
      );
      if (type === 'UPDATE_RECORD') {
        expect(
          await harness.adminDatabase.record.findUniqueOrThrow({
            where: { id: fixture.ownedRecord.id },
          }),
        ).toMatchObject({
          version: before[0].version + 1,
          data: expect.objectContaining({ name: 'HTTP confirmed' }),
        });
      } else if (type === 'CREATE_FOLLOW_UP') {
        expect(await harness.adminDatabase.recordFollowUp.findMany()).toEqual([
          expect.objectContaining({
            tenantId: fixture.tenantA.id,
            recordId: fixture.ownedRecord.id,
            assigneeMemberId: fixture.employee.memberId,
            title: 'HTTP follow-up',
          }),
        ]);
      } else {
        expect(await harness.adminDatabase.recordActivity.findMany()).toEqual([
          expect.objectContaining({
            tenantId: fixture.tenantA.id,
            recordId: fixture.ownedRecord.id,
            actorMemberId: fixture.employee.memberId,
            activityType: 'NOTE',
            content: 'HTTP note',
          }),
        ]);
      }
      expect(await harness.adminDatabase.auditLog.count()).toBe(before[3] + 1);
    },
  );

  it('does not replay an earlier proposal on a later ordinary HTTP turn in the same conversation', async () => {
    const base = `/api/v1/workspaces/${fixture.tenantA.code}/ai`;
    const first = await request(harness.app.getHttpServer())
      .post(`${base}/turns`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('Accept', 'text/event-stream')
      .send({
        content: `critical:propose-change:ADD_ACTIVITY_NOTE:${fixture.ownedRecord.id}`,
      })
      .expect(200);
    const conversationId = JSON.parse(
      first.text.match(/event: conversation.ready\ndata: ([^\n]+)/)![1],
    ).conversationId as string;
    expect(first.text).toContain('event: proposal.ready');
    const second = await request(harness.app.getHttpServer())
      .post(`${base}/turns`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('Accept', 'text/event-stream')
      .send({ conversationId, content: '谢谢，请解释一下建议。' })
      .expect(200);
    expect(second.text).toContain('event: turn.completed');
    expect(second.text).not.toContain('event: proposal.ready');
    expect(await harness.adminDatabase.aiOperation.count()).toBe(1);
    expect(await harness.adminDatabase.recordActivity.count()).toBe(0);
    expect(await harness.adminDatabase.auditLog.count()).toBe(0);
  });

  it('rejects an HTTP proposal without writing any business data', async () => {
    const view = await proposal('ADD_ACTIVITY_NOTE');
    const base = `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${view.proposalId}`;
    const before = await Promise.all([
      harness.adminDatabase.record.findUniqueOrThrow({
        where: { id: fixture.ownedRecord.id },
      }),
      harness.adminDatabase.recordActivity.count(),
      harness.adminDatabase.auditLog.count(),
    ]);
    const rejected = await request(harness.app.getHttpServer())
      .post(`${base}/reject`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', auditId: null });
    const rejectedAgain = await request(harness.app.getHttpServer())
      .post(`${base}/reject`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(rejectedAgain.body).toEqual(rejected.body);
    await request(harness.app.getHttpServer())
      .post(`${base}/confirm`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ idempotencyKey: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('REJECTED'));
    expect(
      await Promise.all([
        harness.adminDatabase.record.findUniqueOrThrow({
          where: { id: fixture.ownedRecord.id },
        }),
        harness.adminDatabase.recordActivity.count(),
        harness.adminDatabase.auditLog.count(),
      ]),
    ).toEqual(before);
  });

  it('denies a published ordinary READ_ONLY field after candidate schema validation, without a proposal or leak', async () => {
    const publication =
      await harness.adminDatabase.objectDefinition.findUniqueOrThrow({
        where: { id: fixture.object.id },
        include: { activePublication: true },
      });
    const published = parsePublishedObjectSchema(
      publication.activePublication!.configuration,
    );
    expect(published.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: 'reviewCode',
          type: 'TEXT',
          required: false,
          isSystem: false,
        }),
      ]),
    );
    expect(published.employeeAccess.fields.reviewCode).toBe('READ_ONLY');
    expect(
      validateProposalCandidate({
        operationType: 'UPDATE_RECORD',
        objectCode: 'leads',
        recordId: fixture.ownedRecord.id,
        values: { reviewCode: 'changed' },
      }),
    ).toMatchObject({ values: { reviewCode: 'changed' } });
    const before = await harness.adminDatabase.record.findUniqueOrThrow({
      where: { id: fixture.ownedRecord.id },
    });
    expect(before.data).toMatchObject({ reviewCode: 'initial-review-code' });
    const turn = await request(harness.app.getHttpServer())
      .post(`/api/v1/workspaces/${fixture.tenantA.code}/ai/turns`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('Accept', 'text/event-stream')
      .send({
        content: `critical:propose-change:UPDATE_RECORD:${fixture.ownedRecord.id}:READ_ONLY`,
      })
      .expect(200);
    expect(turn.text).toMatch(/event: turn\.(failed|completed)/);
    expect(turn.text).not.toContain('event: proposal.ready');
    expect(turn.text).not.toContain('initial-review-code');
    expect(turn.text).not.toContain('hidden-owned');
    expect(turn.text).not.toContain('"secret"');
    expect(await harness.adminDatabase.aiOperation.count()).toBe(0);
    expect(await harness.adminDatabase.auditLog.count()).toBe(0);
    expect(
      await harness.adminDatabase.record.findUniqueOrThrow({
        where: { id: fixture.ownedRecord.id },
      }),
    ).toEqual(before);
  });

  it('denies hidden fields and another owner through HTTP turn before proposal creation', async () => {
    const base = `/api/v1/workspaces/${fixture.tenantA.code}/ai`;
    const cases = [
      `critical:propose-change:UPDATE_RECORD:${fixture.ownedRecord.id}:HIDDEN`,
      `critical:propose-change:UPDATE_RECORD:${fixture.otherRecord.id}`,
    ];
    for (const content of cases) {
      const turn = await request(harness.app.getHttpServer())
        .post(`${base}/turns`)
        .set('Cookie', fixture.employee.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('Accept', 'text/event-stream')
        .send({ content })
        .expect(200);
      expect(turn.text).toMatch(/event: turn\.(failed|completed)/);
      expect(turn.text).not.toContain('event: proposal.ready');
      expect(turn.text).not.toContain('hidden-owned');
      expect(turn.text).not.toContain('hidden-other');
      expect(turn.text).not.toContain('内部备注');
      expect(turn.text).not.toContain('"secret"');
    }
    expect(await harness.adminDatabase.aiOperation.count()).toBe(0);
    expect(await harness.adminDatabase.auditLog.count()).toBe(0);
    expect(
      await harness.adminDatabase.record.findUniqueOrThrow({
        where: { id: fixture.ownedRecord.id },
      }),
    ).toMatchObject({ version: fixture.ownedRecord.version });
  });

  it('does not publish a provider raw failure code or secrets in the HTTP SSE', async () => {
    const response = await request(harness.app.getHttpServer())
      .post(`/api/v1/workspaces/${fixture.tenantA.code}/ai/turns`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('Accept', 'text/event-stream')
      .send({ content: 'critical:provider-secret-failure' })
      .expect(200);
    expect(response.text).toContain('turn.failed');
    expect(response.text).toContain('AI_TURN_FAILED');
    expect(response.text).not.toContain('provider-raw-secret');
    expect(response.text).not.toContain('hidden-owned');
  });

  it('uses a non-BYPASSRLS runtime role and FORCE RLS on AI persistence tables', async () => {
    const role = await harness.runtimeDatabase.$queryRaw<
      Array<{ rolname: string; rolbypassrls: boolean }>
    >`
      SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual([{ rolname: 'crm_app', rolbypassrls: false }]);
    const tables = await harness.runtimeDatabase.$queryRaw<
      Array<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>
    >`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname IN ('ai_conversations', 'ai_messages', 'ai_operations')`;
    expect(tables).toHaveLength(3);
    expect(tables.map(({ relname }) => relname).sort()).toEqual([
      'ai_conversations',
      'ai_messages',
      'ai_operations',
    ]);
    expect(
      tables.every(
        ({ relrowsecurity, relforcerowsecurity }) =>
          relrowsecurity && relforcerowsecurity,
      ),
    ).toBe(true);
  });

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
      const operation =
        await harness.adminDatabase.aiOperation.findUniqueOrThrow({
          where: { id: view.proposalId },
        });
      expect(operation.status).toBe('EXECUTED');
      expect(operation.auditId).toBe(confirmed.body.auditId);
      expect(
        await harness.adminDatabase.auditLog.findUnique({
          where: { id: operation.auditId! },
        }),
      ).toMatchObject({
        id: operation.auditId,
        after: expect.objectContaining({ aiOperationId: view.proposalId }),
      });
    },
  );

  it('denies cross-tenant and different-member HTTP reads/confirms without mutation', async () => {
    const view = await proposal('UPDATE_RECORD');
    const path = `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${view.proposalId}`;
    await request(harness.app.getHttpServer())
      .get(
        `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${view.proposalId}`,
      )
      .set('Cookie', fixture.otherEmployee.cookie)
      .expect(404);
    await request(harness.app.getHttpServer())
      .post(`${path}/confirm`)
      .set('Cookie', fixture.otherEmployee.cookie)
      .send({ idempotencyKey: randomUUID() })
      .expect(403);
    await request(harness.app.getHttpServer())
      .get(
        `/api/v1/workspaces/${fixture.tenantB.code}/ai/proposals/${view.proposalId}`,
      )
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
      .post(
        `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${permission.proposalId}/confirm`,
      )
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ idempotencyKey: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('CONFLICTED'));
    await harness.adminDatabase.objectPermission.deleteMany({
      where: {
        tenantId: context.tenantId,
        objectId: fixture.object.id,
        subjectMemberId: context.memberId,
      },
    });

    const stale = await proposal('ADD_ACTIVITY_NOTE');
    await harness.adminDatabase.record.update({
      where: { id: fixture.ownedRecord.id },
      data: { version: { increment: 1 } },
    });
    await request(harness.app.getHttpServer())
      .post(
        `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${stale.proposalId}/confirm`,
      )
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
      .post(
        `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${expired.proposalId}/confirm`,
      )
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
      .post(
        `/api/v1/workspaces/${fixture.tenantA.code}/ai/proposals/${failed.proposalId}/confirm`,
      )
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ idempotencyKey: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('FAILED'));
    expect(await harness.adminDatabase.auditLog.count()).toBe(before);
    expect(
      await harness.adminDatabase.aiOperation.findUniqueOrThrow({
        where: { id: failed.proposalId },
      }),
    ).toMatchObject({ status: 'FAILED', auditId: null });
  });
});
