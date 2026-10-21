import { CompanyAuditService } from './company-audit.service';
import type { TenantContext } from '../../common/tenancy/tenant-context';

type Where = Record<string, unknown>;

const context: TenantContext = {
  userId: 'u',
  tenantId: 'a',
  tenantCode: 'a',
  memberId: 'm',
  role: 'TENANT_ADMIN',
};

const LIU = '11111111-1111-4111-8111-111111111111';
const WANG_MEMBER = '22222222-2222-4222-8222-222222222222';
const PLATFORM_USER = '33333333-3333-4333-8333-333333333333';
const RECORD = '44444444-4444-4444-8444-444444444444';
const OBJECT = '55555555-5555-4555-8555-555555555555';
const TASK = '66666666-6666-4666-8666-666666666666';
const INVITE = '77777777-7777-4777-8777-777777777777';

function auditRow(overrides: Record<string, unknown>) {
  return {
    id: 'row',
    tenantId: 'a',
    actorType: 'USER',
    actorId: LIU,
    action: 'record.updated',
    resourceType: 'record',
    resourceId: RECORD,
    before: null,
    after: null,
    reason: null,
    requestId: 'req',
    ip: '::1',
    createdAt: new Date('2026-10-20T06:30:00.000Z'),
    ...overrides,
  };
}

/** A transaction double whose lookups record their calls and answer by id. */
function fakeTransaction(rows: Array<Record<string, unknown>>) {
  const calls: Record<string, Where[]> = {};
  const track =
    <T>(name: string, answer: (where: Where) => T) =>
    ({ where }: { where: Where }) => {
      (calls[name] ??= []).push(where);
      return Promise.resolve(answer(where));
    };
  const inIds = (where: Where, key = 'id') =>
    (where[key] as { in?: string[] } | undefined)?.in ?? [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        name: '星云科技',
        timezone: 'Asia/Shanghai',
        fromAt: new Date('2026-10-13T16:00:00.000Z'),
        toAt: new Date('2026-10-20T16:00:00.000Z'),
      },
    ]),
    auditLog: {
      findMany: track('auditLog.findMany', (where) =>
        rows.filter((row) => row.tenantId === where.tenantId),
      ),
      count: track(
        'auditLog.count',
        (where) => rows.filter((row) => row.tenantId === where.tenantId).length,
      ),
    },
    recordFollowUp: {
      findMany: track('recordFollowUp', (where) =>
        inIds(where).includes(TASK)
          ? [{ id: TASK, title: '回访报价', recordId: RECORD }]
          : [],
      ),
    },
    record: {
      findMany: track('record', (where) =>
        inIds(where).includes(RECORD)
          ? [{ id: RECORD, title: '钱宇-1', objectId: OBJECT }]
          : [],
      ),
    },
    tenantMember: {
      findMany: track('tenantMember', () => [
        {
          id: 'member-liu',
          userId: LIU,
          displayName: null,
          user: { displayName: '刘洋' },
        },
        {
          id: WANG_MEMBER,
          userId: 'user-wang',
          displayName: '王芳',
          user: { displayName: 'wang' },
        },
      ]),
    },
    user: {
      findMany: track('user', (where) =>
        inIds(where).map((id) => ({
          id,
          displayName: id === PLATFORM_USER ? '平台管理员' : '账号名',
        })),
      ),
    },
    tenantDashboardConfiguration: {
      findMany: track('dashboard', () => []),
    },
    tenantDashboardPublication: { findMany: track('publication', () => []) },
    tenantInvitation: {
      findMany: track('invitation', () => [
        { id: INVITE, displayName: null, targetPhone: '+8613922225555' },
      ]),
    },
    objectDefinition: {
      findMany: track('objectDefinition', (where) =>
        inIds(where).includes(OBJECT) ? [{ id: OBJECT, name: '客户' }] : [],
      ),
    },
    fieldDefinition: {
      findMany: track('fieldDefinition', () => [
        {
          objectId: OBJECT,
          fieldKey: 'status',
          label: '跟进状态',
          type: 'SINGLE_SELECT',
          config: {
            options: [
              { key: 'new', label: '待联系' },
              { key: 'contacted', label: '已联系' },
            ],
          },
        },
        {
          objectId: OBJECT,
          fieldKey: 'phone',
          label: '联系电话',
          type: 'PHONE',
          config: {},
        },
      ]),
    },
  };
  return { tx, calls };
}

function serviceFor(tx: unknown) {
  return new CompanyAuditService({
    withTenant: (_: unknown, work: (tx: unknown) => unknown) => work(tx),
  } as never);
}

describe('CompanyAuditService', () => {
  it('rejects employees before opening a database context', async () => {
    const service = new CompanyAuditService({
      withTenant: () => {
        throw new Error('must not query');
      },
    } as never);
    await expect(
      service.list({ ...context, role: 'EMPLOYEE' }, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });

  it('never accepts an arbitrary tenant filter', async () => {
    const { tx } = fakeTransaction([
      auditRow({ id: 'own', tenantId: 'a', actorId: null }),
      auditRow({ id: 'other', tenantId: 'b', actorId: null }),
    ]);
    const result = await serviceFor(tx).list(context, {
      page: 1,
      limit: 20,
      tenantId: 'b',
    });
    expect(result.items.map((row) => row.id)).toEqual(['own']);
    expect(result.total).toBe(1);
  });

  it('filters by actor, exact resource types and company calendar days', async () => {
    const { tx, calls } = fakeTransaction([]);
    const result = await serviceFor(tx).list(context, {
      page: 2,
      limit: 20,
      action: 'object.published',
      resourceType: 'object_definition, object',
      actorId: LIU,
      from: '2026-10-14',
      to: '2026-10-20',
    });

    const [where] = calls['auditLog.findMany'];
    expect(where).toEqual({
      tenantId: 'a',
      action: { contains: 'object.published', mode: 'insensitive' },
      resourceType: { in: ['object_definition', 'object'] },
      actorId: LIU,
      createdAt: {
        gte: new Date('2026-10-13T16:00:00.000Z'),
        lt: new Date('2026-10-20T16:00:00.000Z'),
      },
    });
    expect(calls['auditLog.count']).toEqual([where]);
    expect(result.timezone).toBe('Asia/Shanghai');
    // The day boundaries are resolved against this company's own timezone.
    const [, ...values] = tx.$queryRaw.mock.calls[0] as unknown[];
    expect(values).toEqual(['2026-10-14', '2026-10-20', 'a']);
  });

  it('leaves the date range open when no day is given', async () => {
    const { tx, calls } = fakeTransaction([]);
    tx.$queryRaw.mockResolvedValue([
      { name: '星云科技', timezone: 'Asia/Shanghai', fromAt: null, toAt: null },
    ]);
    await serviceFor(tx).list(context, { page: 1, limit: 20 });
    expect(calls['auditLog.findMany'][0]).toEqual({ tenantId: 'a' });
  });

  it('names actors and resources and diffs record fields with labels', async () => {
    const { tx, calls } = fakeTransaction([
      auditRow({
        id: 'updated',
        before: {
          title: '钱宇-1',
          objectId: OBJECT,
          version: 1,
          ownerMemberId: null,
          values: { name: '钱宇-1', status: 'new', phone: '139' },
        },
        after: {
          title: '钱宇-1',
          objectId: OBJECT,
          version: 2,
          ownerMemberId: WANG_MEMBER,
          values: { name: '钱宇-1', status: 'contacted', phone: '138' },
        },
      }),
      auditRow({
        id: 'task',
        action: 'follow_up.completed',
        resourceType: 'record_follow_up',
        resourceId: TASK,
        before: { status: 'OPEN', version: 2 },
        after: { status: 'DONE', version: 3 },
      }),
      auditRow({
        id: 'invite',
        actorId: PLATFORM_USER,
        action: 'invitation.created',
        resourceType: 'tenant_invitation',
        resourceId: INVITE,
        after: { role: 'EMPLOYEE' },
      }),
      auditRow({
        id: 'system',
        actorType: 'SYSTEM',
        actorId: null,
        action: 'record.ownership_reclaimed',
        resourceId: 'missing-record',
        after: { objectId: OBJECT, title: '已删除的线索' },
      }),
    ]);

    const result = await serviceFor(tx).list(context, { page: 1, limit: 20 });
    const byId = Object.fromEntries(
      result.items.map((item) => [item.id, item]),
    );

    expect(byId.updated).toMatchObject({
      actorName: '刘洋',
      tenantName: '星云科技',
      resourceName: '钱宇-1',
      objectName: '客户',
      recordTitle: null,
      changes: [
        { key: 'status', label: '跟进状态', before: '待联系', after: '已联系' },
        { key: 'phone', label: '联系电话', before: '139', after: '138' },
        { key: 'ownerMemberId', label: null, before: null, after: '王芳' },
      ],
    });
    expect(byId.task).toMatchObject({
      resourceName: '回访报价',
      recordTitle: '钱宇-1',
      objectName: '客户',
      changes: [{ key: 'status', label: null, before: 'OPEN', after: 'DONE' }],
    });
    // A platform administrator is not a member: fall back to the account name.
    expect(byId.invite).toMatchObject({
      actorName: '平台管理员',
      resourceName: '尾号 5555',
      changes: null,
    });
    // A record that is gone still reads by the title captured in the payload.
    expect(byId.system).toMatchObject({
      actorName: null,
      resourceName: '已删除的线索',
      objectName: '客户',
    });

    // One batched query per resource kind for the whole page, always scoped
    // to the caller's company.
    for (const name of [
      'recordFollowUp',
      'record',
      'tenantMember',
      'objectDefinition',
      'fieldDefinition',
      'invitation',
    ]) {
      expect(calls[name]).toHaveLength(1);
      expect(calls[name][0]).toMatchObject({ tenantId: 'a' });
    }
    expect(calls.record[0]).toEqual({
      tenantId: 'a',
      id: { in: [RECORD, 'missing-record'] },
    });
    expect(calls.dashboard).toBeUndefined();
    expect(calls.publication).toBeUndefined();
  });

  it('skips every lookup for a page without resources to name', async () => {
    const { tx, calls } = fakeTransaction([
      auditRow({
        actorType: 'SYSTEM',
        actorId: null,
        action: 'dashboard.order_updated',
        resourceType: 'dashboard_definition',
        resourceId: null,
      }),
    ]);
    await serviceFor(tx).list(context, { page: 1, limit: 20 });
    expect(Object.keys(calls).sort()).toEqual([
      'auditLog.count',
      'auditLog.findMany',
    ]);
  });
});
