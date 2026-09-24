import { randomUUID } from 'node:crypto';
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

describe('isolated AI proposal atomic confirmation', () => {
  let harness: CriticalHarness;
  let fixture: CriticalFixture;
  let service: AiProposalService;
  let context: TenantContext;
  beforeAll(async () => {
    const adminUrl = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? '');
    const runtimeUrl = new URL(process.env.TEST_DATABASE_URL ?? '');
    for (const url of [adminUrl, runtimeUrl]) {
      if (
        url.hostname !== '127.0.0.1' ||
        url.port !== '55433' ||
        url.pathname !== '/crm_v1b_test'
      )
        throw new Error('Refusing non-isolated database');
    }
    if (adminUrl.username !== 'crm' || runtimeUrl.username !== 'crm_app')
      throw new Error('Refusing unexpected database roles');
    harness = await createCriticalHarness();
    service = harness.app.get(AiProposalService);
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

  async function turn(): Promise<string> {
    const conversation = await harness.adminDatabase.aiConversation.create({
      data: {
        tenantId: context.tenantId,
        createdByMemberId: context.memberId,
        title: 'Write',
        lastMessageAt: new Date(),
      },
    });
    const turnId = randomUUID();
    await harness.adminDatabase.aiMessage.create({
      data: {
        tenantId: context.tenantId,
        conversationId: conversation.id,
        turnId,
        role: 'USER',
        status: 'COMPLETED',
        content: 'write',
      },
    });
    return turnId;
  }
  const meta = { requestId: randomUUID(), ip: '127.0.0.1' };
  it.each(['UPDATE_RECORD', 'CREATE_FOLLOW_UP', 'ADD_ACTIVITY_NOTE'] as const)(
    '%s writes one business row and correlated audit only after confirm; retry does not replay',
    async (operationType) => {
      const candidate =
        operationType === 'UPDATE_RECORD'
          ? {
              operationType,
              objectCode: 'leads',
              recordId: fixture.ownedRecord.id,
              values: { name: '已更新' },
            }
          : operationType === 'CREATE_FOLLOW_UP'
            ? {
                operationType,
                objectCode: 'leads',
                recordId: fixture.ownedRecord.id,
                title: '联系客户',
                dueAt: '2026-10-01T12:00:00Z',
              }
            : {
                operationType,
                objectCode: 'leads',
                recordId: fixture.ownedRecord.id,
                content: '沟通记录',
              };
      const before = await Promise.all([
        harness.adminDatabase.recordFollowUp.count(),
        harness.adminDatabase.recordActivity.count(),
        harness.adminDatabase.auditLog.count(),
      ]);
      const view = await service.preview(
        context,
        await turn(),
        candidate,
        'write',
      );
      expect(view.status).toBe('PROPOSED');
      expect(
        await Promise.all([
          harness.adminDatabase.recordFollowUp.count(),
          harness.adminDatabase.recordActivity.count(),
          harness.adminDatabase.auditLog.count(),
        ]),
      ).toEqual(before);
      const confirmed = await service.confirm(
        context,
        view.proposalId,
        randomUUID(),
        meta,
      );
      expect(confirmed.status).toBe('EXECUTED');
      expect(confirmed.auditId).toEqual(expect.any(String));
      const stored = await harness.adminDatabase.aiOperation.findUniqueOrThrow({
        where: { id: view.proposalId },
      });
      expect(stored.status).toBe('EXECUTED');
      expect(stored.auditId).toBe(confirmed.auditId);
      expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
        15 * 60_000,
      );
      const audit = await harness.adminDatabase.auditLog.findUniqueOrThrow({
        where: { id: confirmed.auditId! },
      });
      expect(audit.after).toMatchObject({ aiOperationId: view.proposalId });
      const after = await Promise.all([
        harness.adminDatabase.recordFollowUp.count(),
        harness.adminDatabase.recordActivity.count(),
        harness.adminDatabase.auditLog.count(),
      ]);
      expect(after).toEqual([
        before[0] + Number(operationType === 'CREATE_FOLLOW_UP'),
        before[1] + Number(operationType === 'ADD_ACTIVITY_NOTE'),
        before[2] + 1,
      ]);
      expect(
        await service.confirm(context, view.proposalId, randomUUID(), meta),
      ).toEqual(confirmed);
      expect(
        await Promise.all([
          harness.adminDatabase.recordFollowUp.count(),
          harness.adminDatabase.recordActivity.count(),
          harness.adminDatabase.auditLog.count(),
        ]),
      ).toEqual(after);
    },
  );
  it('rejects without writing and cannot confirm after reject', async () => {
    const view = await service.preview(
      context,
      await turn(),
      {
        operationType: 'ADD_ACTIVITY_NOTE',
        objectCode: 'leads',
        recordId: fixture.ownedRecord.id,
        content: 'note',
      },
      'note',
    );
    const before = await harness.adminDatabase.recordActivity.count();
    expect((await service.reject(context, view.proposalId)).status).toBe(
      'REJECTED',
    );
    expect(
      (await service.confirm(context, view.proposalId, randomUUID(), meta))
        .status,
    ).toBe('REJECTED');
    expect(await harness.adminDatabase.recordActivity.count()).toBe(before);
  });
  it('denies cross-tenant and different-member proposal confirmation without mutation', async () => {
    const view = await service.preview(
      context,
      await turn(),
      {
        operationType: 'UPDATE_RECORD',
        objectCode: 'leads',
        recordId: fixture.ownedRecord.id,
        values: { name: 'changed' },
      },
      'update',
    );
    const foreign: TenantContext = {
      ...context,
      tenantId: fixture.tenantB.id,
      tenantCode: fixture.tenantB.code,
      memberId: fixture.tenantBAdmin.memberId,
      userId: fixture.tenantBAdmin.userId,
      role: 'TENANT_ADMIN',
    };
    const other: TenantContext = {
      ...context,
      memberId: fixture.otherEmployee.memberId,
      userId: fixture.otherEmployee.userId,
    };
    await expect(
      service.confirm(foreign, view.proposalId, randomUUID(), meta),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_FOUND' });
    await expect(
      service.confirm(other, view.proposalId, randomUUID(), meta),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_FOUND' });
    expect(
      (
        await harness.adminDatabase.aiOperation.findUniqueOrThrow({
          where: { id: view.proposalId },
        })
      ).status,
    ).toBe('PROPOSED');
  });
  it('forbids preview of a hidden field and a foreign-owned target', async () => {
    const turnId = await turn();
    await expect(
      service.preview(
        context,
        turnId,
        {
          operationType: 'UPDATE_RECORD',
          objectCode: 'leads',
          recordId: fixture.ownedRecord.id,
          values: { secret: 'hidden' },
        },
        'hidden',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.preview(
        context,
        turnId,
        {
          operationType: 'CREATE_FOLLOW_UP',
          objectCode: 'leads',
          recordId: fixture.otherRecord.id,
          title: 'contact',
          dueAt: '2026-10-01T12:00:00Z',
        },
        'other',
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(await harness.adminDatabase.aiOperation.count()).toBe(0);
  });
  it.each(['UPDATE_RECORD', 'CREATE_FOLLOW_UP', 'ADD_ACTIVITY_NOTE'] as const)(
    '%s conflicts on stale record without business/audit writes',
    async (operationType) => {
      const candidate =
        operationType === 'UPDATE_RECORD'
          ? {
              operationType,
              objectCode: 'leads',
              recordId: fixture.ownedRecord.id,
              values: { name: '已更新' },
            }
          : operationType === 'CREATE_FOLLOW_UP'
            ? {
                operationType,
                objectCode: 'leads',
                recordId: fixture.ownedRecord.id,
                title: '联系客户',
                dueAt: '2026-10-01T12:00:00Z',
              }
            : {
                operationType,
                objectCode: 'leads',
                recordId: fixture.ownedRecord.id,
                content: '沟通记录',
              };
      const view = await service.preview(
        context,
        await turn(),
        candidate,
        'write',
      );
      await harness.adminDatabase.record.update({
        where: { id: fixture.ownedRecord.id },
        data: { version: { increment: 1 } },
      });
      const before = await Promise.all([
        harness.adminDatabase.recordFollowUp.count(),
        harness.adminDatabase.recordActivity.count(),
        harness.adminDatabase.auditLog.count(),
      ]);
      expect(
        (await service.confirm(context, view.proposalId, randomUUID(), meta))
          .status,
      ).toBe('CONFLICTED');
      expect(
        await Promise.all([
          harness.adminDatabase.recordFollowUp.count(),
          harness.adminDatabase.recordActivity.count(),
          harness.adminDatabase.auditLog.count(),
        ]),
      ).toEqual(before);
    },
  );
  it('revalidates member permissions after preview without leaking hidden fields', async () => {
    const view = await service.preview(
      context,
      await turn(),
      {
        operationType: 'UPDATE_RECORD',
        objectCode: 'leads',
        recordId: fixture.ownedRecord.id,
        values: { name: 'changed' },
      },
      'update',
    );
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
    const before = await harness.adminDatabase.auditLog.count();
    expect(
      (await service.confirm(context, view.proposalId, randomUUID(), meta))
        .status,
    ).toBe('CONFLICTED');
    expect(await harness.adminDatabase.auditLog.count()).toBe(before);
    expect(
      (
        await harness.adminDatabase.record.findUniqueOrThrow({
          where: { id: fixture.ownedRecord.id },
        })
      ).data,
    ).toMatchObject({ name: '员工自己的线索' });
  });
  it('commits expiration with no business write and concurrent confirms at most once', async () => {
    const expired = await service.preview(
      context,
      await turn(),
      {
        operationType: 'ADD_ACTIVITY_NOTE',
        objectCode: 'leads',
        recordId: fixture.ownedRecord.id,
        content: 'expired',
      },
      'expired',
    );
    await harness.adminDatabase.aiOperation.update({
      where: { id: expired.proposalId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await service.confirm(context, expired.proposalId, randomUUID(), meta))
        .status,
    ).toBe('EXPIRED');
    expect(
      (
        await harness.adminDatabase.aiOperation.findUniqueOrThrow({
          where: { id: expired.proposalId },
        })
      ).status,
    ).toBe('EXPIRED');
    const ready = await service.preview(
      context,
      await turn(),
      {
        operationType: 'ADD_ACTIVITY_NOTE',
        objectCode: 'leads',
        recordId: fixture.ownedRecord.id,
        content: 'once',
      },
      'once',
    );
    const results = await Promise.all([
      service.confirm(context, ready.proposalId, randomUUID(), meta),
      service.confirm(context, ready.proposalId, randomUUID(), meta),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'EXECUTED',
      'EXECUTED',
    ]);
    expect(await harness.adminDatabase.recordActivity.count()).toBe(1);
    expect(await harness.adminDatabase.auditLog.count()).toBe(1);
  });
  it('rolls back invalid stored candidate then conditionally commits FAILED', async () => {
    const view = await service.preview(
      context,
      await turn(),
      {
        operationType: 'CREATE_FOLLOW_UP',
        objectCode: 'leads',
        recordId: fixture.ownedRecord.id,
        title: 'valid',
        dueAt: '2026-10-01T12:00:00Z',
      },
      'valid',
    );
    await harness.adminDatabase.aiOperation.update({
      where: { id: view.proposalId },
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
    expect(
      (await service.confirm(context, view.proposalId, randomUUID(), meta))
        .status,
    ).toBe('FAILED');
    expect(
      (
        await harness.adminDatabase.aiOperation.findUniqueOrThrow({
          where: { id: view.proposalId },
        })
      ).auditId,
    ).toBeNull();
    expect(await harness.adminDatabase.recordFollowUp.count()).toBe(0);
    expect(await harness.adminDatabase.auditLog.count()).toBe(0);
  });
  it('marks stale NOTE target conflicted with zero business/audit writes', async () => {
    const view = await service.preview(
      context,
      await turn(),
      {
        operationType: 'ADD_ACTIVITY_NOTE',
        objectCode: 'leads',
        recordId: fixture.ownedRecord.id,
        content: 'note',
      },
      'note',
    );
    await harness.adminDatabase.record.update({
      where: { id: fixture.ownedRecord.id },
      data: { version: { increment: 1 } },
    });
    const before = await harness.adminDatabase.auditLog.count();
    expect(
      (await service.confirm(context, view.proposalId, randomUUID(), meta))
        .status,
    ).toBe('CONFLICTED');
    expect(await harness.adminDatabase.auditLog.count()).toBe(before);
    expect(await harness.adminDatabase.recordActivity.count()).toBe(0);
  });
});
