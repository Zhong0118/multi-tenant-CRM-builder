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
  tenantTimezone?: string | null;
}

interface WorkbenchQueryArgs {
  where: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  include?: unknown;
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
      count: jest.fn((_args: WorkbenchQueryArgs) => Promise.resolve(0)),
      findMany: jest.fn((_args: WorkbenchQueryArgs) =>
        Promise.resolve([] as unknown[]),
      ),
    },
    tenant: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          timezone:
            options.tenantTimezone === undefined
              ? 'Asia/Shanghai'
              : options.tenantTimezone,
        }),
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

describe('FollowUpsRepository tenant timezone', () => {
  it('reads the current tenant timezone through the tenant context runner', async () => {
    const fixture = harness();

    await expect(
      fixture.repository.getTenantTimezone(context),
    ).resolves.toBe('Asia/Shanghai');

    expect(fixture.withTenant).toHaveBeenCalledWith(
      context,
      expect.any(Function),
    );
    expect(fixture.tx.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: context.tenantId },
      select: { timezone: true },
    });
  });

  it('reports a missing tenant row as null instead of guessing a zone', async () => {
    const fixture = harness({ tenantTimezone: null });

    await expect(
      fixture.repository.getTenantTimezone(context),
    ).resolves.toBeNull();
  });
});

describe('FollowUpsRepository personal workbench', () => {
  const RANGE = {
    now: new Date('2026-09-17T07:00:00.000Z'),
    todayStart: new Date('2026-09-16T16:00:00.000Z'),
    tomorrowStart: new Date('2026-09-17T16:00:00.000Z'),
    day8Start: new Date('2026-09-24T16:00:00.000Z'),
  };
  const SCOPES = [{ objectId: 'object-leads', canUpdate: true }];

  it('hard-binds every workbench query to the tenant and the acting member', async () => {
    const fixture = harness();

    await fixture.repository.workbench(context, SCOPES, RANGE, 'Asia/Shanghai');

    const queries = [
      ...fixture.tx.recordFollowUp.count.mock.calls,
      ...fixture.tx.recordFollowUp.findMany.mock.calls,
    ];
    expect(queries).toHaveLength(7);
    for (const [args] of queries) {
      expect(args.where).toMatchObject({
        tenantId: context.tenantId,
        assigneeMemberId: context.memberId,
        status: 'OPEN',
      });
      expect(args.where).not.toHaveProperty('recordId');
      // The Record must still exist and still be inside a readable scope.
      expect(args.where.record).toMatchObject({
        tenantId: context.tenantId,
        deletedAt: null,
      });
    }
  });

  it('splits the tenant calendar into non-overlapping bucket predicates', async () => {
    const fixture = harness();

    await fixture.repository.workbench(context, SCOPES, RANGE, 'Asia/Shanghai');

    const counts = fixture.tx.recordFollowUp.count.mock.calls.map(
      (call) => call[0].where,
    );
    expect(counts[0].dueAt).toBeUndefined();
    expect(counts[1].dueAt).toEqual({ lt: RANGE.now });
    expect(counts[2].dueAt).toEqual({
      gte: RANGE.now,
      lt: RANGE.tomorrowStart,
    });
    expect(counts[3].dueAt).toEqual({
      gte: RANGE.tomorrowStart,
      lt: RANGE.day8Start,
    });
  });

  it('puts a same-day 09:00 due into overdue when queried at 15:00, not today', async () => {
    const fixture = harness();
    const dueAt = new Date('2026-09-17T01:00:00.000Z');

    await fixture.repository.workbench(context, SCOPES, RANGE, 'Asia/Shanghai');

    const overdue = fixture.tx.recordFollowUp.count.mock.calls[1][0].where
      .dueAt as { lt: Date };
    const today = fixture.tx.recordFollowUp.count.mock.calls[2][0].where
      .dueAt as { gte: Date; lt: Date };
    expect(dueAt < overdue.lt).toBe(true);
    expect(dueAt >= today.gte && dueAt < today.lt).toBe(false);
  });

  it('orders every preview by dueAt then id and caps it at five', async () => {
    const fixture = harness();

    await fixture.repository.workbench(context, SCOPES, RANGE, 'Asia/Shanghai');

    const previews = fixture.tx.recordFollowUp.findMany.mock.calls.map(
      (call) => call[0],
    );
    expect(previews).toHaveLength(3);
    for (const args of previews) {
      expect(args.orderBy).toEqual([{ dueAt: 'asc' }, { id: 'asc' }]);
      expect(args.take).toBe(5);
      expect(args.include).toBeDefined();
    }
    expect(previews[0].where.dueAt).toEqual({ lt: RANGE.now });
    expect(previews[1].where.dueAt).toEqual({
      gte: RANGE.now,
      lt: RANGE.tomorrowStart,
    });
    expect(previews[2].where.dueAt).toEqual({
      gte: RANGE.tomorrowStart,
      lt: RANGE.day8Start,
    });
  });

  it('returns full-set counts that are independent of the preview limit', async () => {
    const fixture = harness();
    fixture.tx.recordFollowUp.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(4);

    const result = await fixture.repository.workbench(
      context,
      SCOPES,
      RANGE,
      'Asia/Shanghai',
    );

    expect(result.counts).toEqual({
      allOpen: 9,
      overdue: 2,
      today: 1,
      upcoming: 4,
    });
  });

  it('returns the empty safe shape without querying when nothing is readable', async () => {
    const fixture = harness();

    await expect(
      fixture.repository.workbench(context, [], RANGE, 'Asia/Shanghai'),
    ).resolves.toEqual({
      timezone: 'Asia/Shanghai',
      counts: { allOpen: 0, overdue: 0, today: 0, upcoming: 0 },
      preview: { overdue: [], today: [], upcoming: [] },
    });
    expect(fixture.tx.recordFollowUp.count).not.toHaveBeenCalled();
    expect(fixture.tx.recordFollowUp.findMany).not.toHaveBeenCalled();
  });

  it('projects only the safe workbench fields, with overdue matching dueAt < now', async () => {
    const fixture = harness();
    fixture.tx.recordFollowUp.findMany.mockResolvedValue([taskRow()]);

    const result = await fixture.repository.workbench(
      context,
      SCOPES,
      RANGE,
      'Asia/Shanghai',
    );

    const item = result.preview.overdue[0];
    expect(Object.keys(item).sort()).toEqual([
      'canManage',
      'dueAt',
      'id',
      'objectCode',
      'objectName',
      'overdue',
      'recordId',
      'recordTitle',
      'title',
      'version',
    ]);
    expect(item).toMatchObject({
      id: 'task-1',
      recordId: RECORD_ID,
      recordTitle: '张三',
      objectCode: 'leads',
      objectName: '销售线索',
      title: '回访客户',
      dueAt: '2026-09-20T00:00:00.000Z',
      version: 1,
      overdue: true,
      canManage: true,
    });
    expect(item).not.toHaveProperty('assigneeMemberId');
    expect(item).not.toHaveProperty('assigneeName');
    expect(item).not.toHaveProperty('status');
    expect(result.preview.today[0].overdue).toBe(false);
    expect(result.preview.upcoming[0].overdue).toBe(false);
  });

  it('withholds canManage when the actor cannot update the record', async () => {
    const fixture = harness();
    fixture.tx.recordFollowUp.findMany.mockResolvedValue([taskRow()]);

    const result = await fixture.repository.workbench(
      context,
      [{ objectId: 'object-leads', canUpdate: false }],
      RANGE,
      'Asia/Shanghai',
    );

    expect(result.preview.overdue[0].canManage).toBe(false);
  });
});
