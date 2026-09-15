import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { AuditService } from '../audit/audit.service';
import { FollowUpsRepository } from './follow-ups.repository';
import type { FollowUpRecordScope } from './follow-up-command';

/**
 * §24 boundary tests: the ordinary repository keeps opening the tenant
 * transaction and runs the shared command inside it. The transaction client is
 * faked by SQL shape, as in `records.repository.spec.ts`.
 */

const context: TenantContext = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-actor',
  memberId: 'member-actor',
  role: 'EMPLOYEE',
};
const meta = { requestId: 'req-1' };
const RECORD_ID = '018f47a2-4b5c-7d8e-9f01-00000000000f';
const SCOPE: FollowUpRecordScope = {
  objectId: 'object-leads',
  recordId: RECORD_ID,
  expectedRole: 'EMPLOYEE',
  requiredOwnerMemberId: context.memberId,
};

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    assigneeMemberId: context.memberId,
    assignee: { employeeNo: 'E-001', user: { displayName: '王五' } },
    recordId: RECORD_ID,
    record: {
      title: '张三',
      objectId: 'object-leads',
      object: { code: 'leads', name: '销售线索' },
    },
    title: '回访客户',
    dueAt: new Date('2026-09-20T00:00:00.000Z'),
    status: 'OPEN',
    version: 1,
    ...overrides,
  };
}

interface HarnessOptions {
  actorRows?: Array<{ id: string; role: string }>;
  recordRows?: Array<{ id: string }>;
  updateCount?: number;
}

function harness(options: HarnessOptions = {}) {
  const sqlCalls: string[] = [];
  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('$').replace(/\s+/g, ' ').trim();
      sqlCalls.push(sql);
      if (/FROM tenant_members/.test(sql))
        return Promise.resolve(
          options.actorRows ?? [{ id: context.memberId, role: context.role }],
        );
      if (/FROM records/.test(sql))
        return Promise.resolve(options.recordRows ?? [{ id: RECORD_ID }]);
      throw new Error(`unexpected SQL: ${sql}`);
    }),
    recordFollowUp: {
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(taskRow({ id: 'task-created', ...args.data })),
      ),
      findFirst: jest.fn(() =>
        Promise.resolve(
          taskRow({ status: 'OPEN', dueAt: new Date('2026-09-20T00:00:00Z') }),
        ),
      ),
      findFirstOrThrow: jest.fn(() =>
        Promise.resolve(taskRow({ status: 'DONE', version: 2 })),
      ),
      updateMany: jest.fn(() =>
        Promise.resolve({ count: options.updateCount ?? 1 }),
      ),
    },
  };
  const withTenant = jest.fn(
    (_ctx: TenantContext, work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
  );
  const append = jest.fn<Promise<void>, [unknown, Record<string, unknown>]>();
  return {
    tx,
    withTenant,
    append,
    sqlCalls,
    repository: new FollowUpsRepository(
      { withTenant } as unknown as DatabaseContextRunner,
      { append } as unknown as AuditService,
    ),
  };
}

describe('FollowUpsRepository transaction boundary', () => {
  it('runs the shared create command inside exactly one tenant transaction', async () => {
    const fixture = harness();

    const created = await fixture.repository.create(
      context,
      {
        objectCode: 'leads',
        recordId: RECORD_ID,
        title: '回访客户',
        dueAt: '2026-09-20T08:00:00+08:00',
      },
      meta,
      SCOPE,
    );

    expect(fixture.withTenant).toHaveBeenCalledTimes(1);
    expect(fixture.withTenant).toHaveBeenCalledWith(
      context,
      expect.any(Function),
    );
    expect(fixture.sqlCalls[0]).toContain('FROM tenant_members');
    expect(fixture.sqlCalls[1]).toContain('FROM records');
    expect(created).toMatchObject({
      assigneeMemberId: context.memberId,
      recordId: RECORD_ID,
      status: 'OPEN',
      version: 1,
    });
    // The audit went through the same client the repository opened.
    expect(fixture.append).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        action: 'follow_up.created',
        resourceType: 'record_follow_up',
        resourceId: created.id,
      }),
    );
  });

  it('propagates the follow-up create actor error code', async () => {
    const fixture = harness({ actorRows: [] });

    await expect(
      fixture.repository.create(
        context,
        {
          objectCode: 'leads',
          recordId: RECORD_ID,
          title: '回访客户',
          dueAt: '2026-09-20T08:00:00+08:00',
        },
        meta,
        SCOPE,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
    expect(fixture.tx.recordFollowUp.create).not.toHaveBeenCalled();
  });

  it('keeps the update path on its own WORKSPACE_FORBIDDEN actor lock', async () => {
    const fixture = harness({ actorRows: [] });

    await expect(
      fixture.repository.update(
        context,
        'task-1',
        { version: 1, status: 'DONE' },
        meta,
        SCOPE,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    expect(fixture.sqlCalls[0]).toContain('JOIN users');
    expect(fixture.tx.recordFollowUp.updateMany).not.toHaveBeenCalled();
    expect(fixture.append).not.toHaveBeenCalled();
  });

  it('still audits an update through the shared helper on the same client', async () => {
    const fixture = harness();

    const updated = await fixture.repository.update(
      context,
      'task-1',
      { version: 1, status: 'DONE' },
      meta,
      SCOPE,
    );

    expect(fixture.sqlCalls[1]).toContain('FROM records');
    expect(updated).toMatchObject({ id: 'task-1', status: 'DONE' });
    expect(fixture.append).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        action: 'follow_up.completed',
        resourceType: 'record_follow_up',
        resourceId: 'task-1',
      }),
    );
    const event = fixture.append.mock.calls[0][1];
    expect(event.after).toMatchObject({ status: 'DONE', version: 2 });
    expect(event.before).toMatchObject({ status: 'OPEN', version: 1 });
  });
});
