import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';
import {
  appendFollowUpAudit,
  createFollowUpCommand,
  lockFollowUpActor,
  lockFollowUpRecord,
  presentFollowUp,
  type FollowUpRecordScope,
} from './follow-up-command';

/**
 * §22 / §24 parity tests for the extracted transaction-aware CREATE_FOLLOW_UP
 * command. The transaction client is faked by SQL shape (actor lock, record
 * lock) as in `records.repository.spec.ts` / `workflow.repository.spec.ts`.
 */

const context: TenantContext = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-actor',
  memberId: 'member-actor',
  role: 'EMPLOYEE',
};
const meta = { requestId: 'req-1', ip: '127.0.0.1' };
const RECORD_ID = '018f47a2-4b5c-7d8e-9f01-00000000000f';
const SCOPE: FollowUpRecordScope = {
  objectId: 'object-leads',
  recordId: RECORD_ID,
  expectedRole: 'EMPLOYEE',
  requiredOwnerMemberId: context.memberId,
};
const INPUT = {
  recordId: RECORD_ID,
  title: '回访客户',
  dueAt: '2026-09-20T08:00:00+08:00',
};

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface HarnessOptions {
  /** Rows the actor lock returns; defaults to the acting member's own role. */
  actors?: Array<{ id: string; role: string }>;
  /** `false` makes both record locks report a missing/soft-deleted record. */
  recordExists?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const sqlCalls: Array<{ sql: string; values: unknown[] }> = [];
  const createArgs: Array<{ data: Record<string, unknown> }> = [];
  const append = jest.fn().mockResolvedValue(undefined);

  const tx = {
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('$').replace(/\s+/g, ' ').trim();
        sqlCalls.push({ sql, values });
        if (/FROM tenant_members/.test(sql))
          return (
            options.actors ?? [{ id: context.memberId, role: context.role }]
          );
        if (/FROM records/.test(sql))
          return options.recordExists === false ? [] : [{ id: RECORD_ID }];
        throw new Error(`unexpected SQL: ${sql}`);
      },
    ),
    recordFollowUp: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        createArgs.push(args);
        const data = args.data as {
          id: string;
          assigneeMemberId: string;
          recordId: string;
          title: string;
          dueAt: Date;
        };
        return {
          id: data.id,
          assigneeMemberId: data.assigneeMemberId,
          assignee: {
            employeeNo: 'E-001',
            user: { displayName: '王五' },
          },
          recordId: data.recordId,
          record: {
            title: '张三',
            objectId: 'object-leads',
            object: { code: 'leads', name: '销售线索' },
          },
          title: data.title,
          dueAt: data.dueAt,
          status: 'OPEN',
          version: 1,
        };
      }),
    },
  };

  return {
    tx,
    append,
    sqlCalls,
    createArgs,
    run: (input: typeof INPUT = INPUT, scope: FollowUpRecordScope = SCOPE) =>
      createFollowUpCommand(tx as never, context, input, meta, scope, {
        audit: { append } as never,
      }),
  };
}

async function rejection(promise: Promise<unknown>): Promise<ApiException> {
  try {
    await promise;
  } catch (error) {
    return error as ApiException;
  }
  throw new Error('expected the command to reject');
}

describe('createFollowUpCommand', () => {
  it('locks the acting member first and creates the follow-up in the caller transaction', async () => {
    const fixture = harness();

    const created = await fixture.run();

    expect(fixture.sqlCalls[0].sql).toContain('FROM tenant_members');
    expect(fixture.sqlCalls[0].sql).toContain("status='ACTIVE'");
    expect(fixture.sqlCalls[0].sql).toContain('FOR UPDATE');
    expect(fixture.sqlCalls[0].values).toEqual(['tenant-a', 'member-actor']);
    expect(fixture.createArgs).toHaveLength(1);
    expect(fixture.createArgs[0].data.id).toMatch(UUID_V4);
    expect({ ...fixture.createArgs[0].data, id: undefined }).toEqual({
      tenantId: 'tenant-a',
      assigneeMemberId: 'member-actor',
      recordId: RECORD_ID,
      title: '回访客户',
      dueAt: new Date('2026-09-20T08:00:00+08:00'),
    });
    expect(created.id).toMatch(UUID_V4);
    expect({ ...created, id: undefined }).toEqual({
      assigneeMemberId: 'member-actor',
      assigneeName: '王五',
      recordId: RECORD_ID,
      recordTitle: '张三',
      objectCode: 'leads',
      objectName: '销售线索',
      title: '回访客户',
      dueAt: '2026-09-20T00:00:00.000Z',
      status: 'OPEN',
      version: 1,
      overdue: false,
      canManage: true,
    });
  });

  it('does not join users in the follow-up actor lock', async () => {
    const fixture = harness();

    await fixture.run();

    // Preserved asymmetry: the follow-up create lock never checked
    // `users.status` (the relation path and `update()` do).
    expect(fixture.sqlCalls[0].sql).not.toContain('JOIN users');
    expect(fixture.sqlCalls[0].sql).not.toContain('u.status');
  });

  const actorCases: Array<[string, Array<{ id: string; role: string }>]> = [
    ['a missing actor', []],
    ['a changed role', [{ id: 'member-actor', role: 'TENANT_ADMIN' }]],
  ];
  it.each(actorCases)(
    'rejects %s with the follow-up error code before locking the record',
    async (_label, actors) => {
      const fixture = harness({ actors });

      const error = await rejection(fixture.run());

      expect(error.code).toBe('OBJECT_ACTION_FORBIDDEN');
      expect(error.getStatus()).toBe(403);
      expect(fixture.sqlCalls).toHaveLength(1);
      expect(fixture.createArgs).toHaveLength(0);
      expect(fixture.append).not.toHaveBeenCalled();
    },
  );

  it('locks the target record second and honours the required owner', async () => {
    const fixture = harness();

    await fixture.run();
    await fixture.run(INPUT, { ...SCOPE, requiredOwnerMemberId: undefined });

    const [firstLock, secondLock, thirdLock, fourthLock] = fixture.sqlCalls;
    expect(firstLock.sql).toContain('FROM tenant_members');
    expect(secondLock.sql).toContain('FROM records');
    expect(secondLock.sql).toContain('object_id =');
    expect(secondLock.sql).toContain('deleted_at IS NULL');
    expect(secondLock.sql).toContain('owner_member_id =');
    expect(secondLock.sql).toContain('FOR UPDATE');
    expect(secondLock.values).toEqual([
      'tenant-a',
      'object-leads',
      RECORD_ID,
      'member-actor',
      'member-actor',
    ]);
    expect(thirdLock.sql).toContain('FROM tenant_members');
    expect(fourthLock.values).toEqual([
      'tenant-a',
      'object-leads',
      RECORD_ID,
      null,
      null,
    ]);
  });

  it('rejects a missing or soft-deleted target record', async () => {
    const fixture = harness({ recordExists: false });

    const error = await rejection(fixture.run());

    expect(error.code).toBe('RECORD_NOT_FOUND');
    expect(error.getStatus()).toBe(404);
    expect(fixture.createArgs).toHaveLength(0);
    expect(fixture.append).not.toHaveBeenCalled();
  });

  it('passes the record id through without lower-casing it', async () => {
    const fixture = harness();
    const upper = RECORD_ID.toUpperCase();

    // The ordinary service builds the scope from the same unmodified id.
    await fixture.run(
      { ...INPUT, recordId: upper },
      { ...SCOPE, recordId: upper },
    );

    // Unlike the relation path, the follow-up path never normalises the id.
    expect(fixture.createArgs[0].data.recordId).toBe(upper);
    expect(fixture.sqlCalls[1].values).toContain(upper);
  });

  it('hard-codes the assignee to the acting member', async () => {
    const fixture = harness();

    await fixture.run({
      ...INPUT,
      // A caller-supplied assignee is deliberately ignored on this path.
      assigneeMemberId: 'member-other',
    } as typeof INPUT);

    expect(fixture.createArgs[0].data.assigneeMemberId).toBe('member-actor');
  });

  it('generates the id server-side and leaves status and version to the defaults', async () => {
    const fixture = harness();

    await fixture.run();

    const data = fixture.createArgs[0].data;
    expect(data.id).toMatch(UUID_V4);
    expect(Object.keys(data).sort()).toEqual([
      'assigneeMemberId',
      'dueAt',
      'id',
      'recordId',
      'tenantId',
      'title',
    ]);
  });

  it('passes the title and dueAt through without adding its own policy', async () => {
    const fixture = harness();
    const longTitle = 'x'.repeat(201);

    await fixture.run({ ...INPUT, title: longTitle });
    await fixture.run({ ...INPUT, title: '  前后有空格  ' });

    // The HTTP DTO owns `@MaxLength(200)` and the service owns `trim()`; this
    // command must not grow a second title policy (Task 5 regression class).
    expect(fixture.createArgs[0].data.title).toBe(longTitle);
    expect(fixture.createArgs[1].data.title).toBe('  前后有空格  ');
  });

  it('audits follow_up.created on the caller transaction', async () => {
    const fixture = harness();

    const created = await fixture.run();

    expect(fixture.append).toHaveBeenCalledTimes(1);
    expect(fixture.append).toHaveBeenCalledWith(fixture.tx, {
      tenantId: 'tenant-a',
      actorType: 'USER',
      actorId: 'user-actor',
      resourceType: 'record_follow_up',
      resourceId: created.id,
      action: 'follow_up.created',
      after: {
        title: '回访客户',
        dueAt: '2026-09-20T00:00:00.000Z',
        recordId: RECORD_ID,
      },
      before: undefined,
      requestId: 'req-1',
      ip: '127.0.0.1',
    });
  });

  it('reports an overdue open follow-up with a past due date', async () => {
    const fixture = harness();

    const created = await fixture.run({
      ...INPUT,
      dueAt: '2020-01-01T00:00:00Z',
    });

    expect(created.overdue).toBe(true);
    expect(created.canManage).toBe(true);
  });
});

describe('lockFollowUpActor and lockFollowUpRecord', () => {
  it('keeps the exact actor lock statement and error code', async () => {
    const fixture = harness();
    await expect(
      lockFollowUpActor(fixture.tx as never, context),
    ).resolves.toBeUndefined();
    expect(fixture.sqlCalls[0].sql).toContain(
      'SELECT id, role FROM tenant_members',
    );
    expect(fixture.sqlCalls[0].sql).toContain("status='ACTIVE'");
    expect(fixture.sqlCalls[0].sql).toContain('FOR UPDATE');
    expect(fixture.sqlCalls[0].values).toEqual(['tenant-a', 'member-actor']);

    for (const rows of [[], [{ id: 'member-actor', role: 'TENANT_ADMIN' }]]) {
      await expect(
        lockFollowUpActor(
          { $queryRaw: jest.fn().mockResolvedValue(rows) } as never,
          context,
        ),
      ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
    }
  });

  it('keeps the exact record lock statement and error code', async () => {
    const fixture = harness();
    await expect(
      lockFollowUpRecord(fixture.tx as never, context, SCOPE),
    ).resolves.toBeUndefined();
    await expect(
      lockFollowUpRecord(
        { $queryRaw: jest.fn().mockResolvedValue([]) } as never,
        context,
        SCOPE,
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
});

describe('appendFollowUpAudit and presentFollowUp', () => {
  it('appends the audit event with the requesting meta spread last', async () => {
    const append = jest.fn().mockResolvedValue(undefined);

    await appendFollowUpAudit(
      {} as never,
      { append } as never,
      context,
      'task-1',
      'follow_up.created',
      meta,
      { title: '回访客户' },
    );

    expect(append).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        tenantId: 'tenant-a',
        actorId: 'user-actor',
        resourceType: 'record_follow_up',
        resourceId: 'task-1',
        requestId: 'req-1',
        ip: '127.0.0.1',
      }),
    );
  });

  it('falls back to the employee number when no display name exists', () => {
    const presented = presentFollowUp({
      id: 'task-1',
      assigneeMemberId: 'member-actor',
      assignee: { employeeNo: 'E-001', user: { displayName: null } },
      recordId: RECORD_ID,
      record: { title: '张三', object: { code: 'leads', name: '销售线索' } },
      title: '回访客户',
      dueAt: new Date('2026-09-20T00:00:00.000Z'),
      status: 'OPEN',
      version: 1,
    } as never);

    expect(presented.assigneeName).toBe('E-001');
  });
});
