import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { DashboardQueryPlan } from './dashboard-engine';
import {
  PrismaDashboardQueryExecutor,
  PrismaDashboardRepository,
} from './dashboards.repository';

jest.mock('@crm/database', () => {
  type Sql = { sql: string; values: unknown[] };
  const fragment = (sql: string, values: unknown[] = []): Sql => ({
    sql,
    values,
  });
  const isSql = (value: unknown): value is Sql =>
    value !== null &&
    typeof value === 'object' &&
    'sql' in value &&
    'values' in value;
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] ?? '';
    const bound: unknown[] = [];
    values.forEach((value, index) => {
      if (isSql(value)) {
        text += value.sql;
        bound.push(...value.values);
      } else {
        text += '?';
        bound.push(value);
      }
      text += strings[index + 1] ?? '';
    });
    return fragment(text, bound);
  };
  const join = (values: unknown[]) => {
    const parts = values.map((value) =>
      isSql(value) ? value : fragment('?', [value]),
    );
    return fragment(
      parts.map((part) => part.sql).join(', '),
      parts.flatMap((part) => part.values),
    );
  };
  return { Prisma: { sql, join, empty: fragment('') } };
});

const context: TenantContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  tenantCode: 'acme',
  memberId: 'member-1',
  role: 'TENANT_ADMIN',
};

describe('PrismaDashboardRepository persistence boundaries', () => {
  it('takes a tenant-scoped advisory lock before checking an optional definition', async () => {
    const queries: string[] = [];
    const transaction = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const query = strings.join('?');
        queries.push(query);
        return Promise.resolve([]);
      }),
      tenantDashboardConfiguration: {
        create: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          draftVersion: 1,
          draftConfiguration: {
            schemaVersion: 2,
            title: '工作台',
            widgets: [],
          },
          activePublicationId: null,
          sourceTemplateVersionId: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      },
    };
    const repository = fixture(transaction);

    await expect(
      repository.saveDraft(context, 0, {
        schemaVersion: 2,
        title: '工作台',
        widgets: [],
      }),
    ).resolves.toEqual(expect.objectContaining({ draftVersion: 1 }));

    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatch(
      /pg_advisory_xact_lock\([\s\S]*hashtext\('tenant_dashboard_configurations'\)[\s\S]*hashtext\(\?::text\)[\s\S]*\)/,
    );
    expect(queries[1]).toMatch(
      /FROM tenant_dashboard_configurations[\s\S]*FOR UPDATE/,
    );
  });

  it('returns legacy publication JSON behind a truthful discriminator', async () => {
    const legacy = {
      opportunity: {
        objectCode: 'opportunities',
        stageFieldKey: 'stage',
        amountFieldKey: 'amount',
        dateFieldKey: 'close_at',
        activeOptionKeys: ['new'],
        wonOptionKeys: ['won'],
        lostOptionKeys: ['lost'],
      },
      lead: {},
      activity: {},
    };
    const transaction = {
      tenantDashboardConfiguration: {
        findUnique: jest.fn().mockResolvedValue({
          activePublication: {
            id: 'publication-1',
            tenantId: 'tenant-1',
            publicationNo: 1,
            sourceDraftVersion: 3,
            configuration: legacy,
            publishedByMemberId: null,
            publishedAt: new Date('2026-09-01T00:00:00.000Z'),
          },
        }),
      },
    };
    const repository = fixture(transaction);

    await expect(repository.getActivePublication(context)).resolves.toEqual(
      expect.objectContaining({
        configuration: { kind: 'LEGACY', raw: legacy },
      }),
    );
  });
});

describe('PrismaDashboardQueryExecutor', () => {
  it('binds JSON keys and hostile filter values while enforcing every scope predicate', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRaw: jest.fn((query: { sql: string; values: unknown[] }) => {
        queries.push({ sql: query.sql, values: query.values });
        return Promise.resolve([{ value: 3 }]);
      }),
    };
    const executor = new PrismaDashboardQueryExecutor(runner(transaction));
    const plan = metricPlan('safe-metric', {
      ownerMemberId: 'member-1',
      widget: {
        ...metricPlan('safe-metric').widget,
        filters: [
          {
            fieldKey: 'name',
            operator: 'CONTAINS',
            value: "x%' OR TRUE --",
          },
        ],
        filterFields: [{ fieldKey: 'name', label: '名称', type: 'TEXT' }],
      },
    });

    const results = await executor.execute(context, [plan]);

    const result = results.get('safe-metric');
    expect(result).toMatchObject({ state: 'READY', type: 'METRIC' });
    if (!result || result.state !== 'READY' || result.type !== 'METRIC') {
      throw new Error('Expected ready metric result');
    }
    expect(result.data.value).toBe(3);
    expect(queries[0]?.sql).toMatch(/r\.tenant_id = .*::uuid/);
    expect(queries[0]?.sql).toMatch(/r\.object_id = .*::uuid/);
    expect(queries[0]?.sql).toMatch(/r\.deleted_at IS NULL/);
    expect(queries[0]?.sql).toMatch(/r\.owner_member_id = .*::uuid/);
    expect(queries[0]?.sql).not.toContain("x%' OR TRUE --");
    expect(queries[0]?.values).toEqual(
      expect.arrayContaining([
        'tenant-1',
        'object-opportunities',
        'member-1',
        'name',
        "%x%' OR TRUE --%",
      ]),
    );
  });

  it('normalizes all five widget results and isolates one rejected query', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ value: 12 }])
        .mockResolvedValueOnce([{ optionKey: 'new', value: 8 }])
        .mockResolvedValueOnce([
          { date: '2026-08-01', value: 4 },
          { date: '2026-08-02', value: 5 },
        ])
        .mockRejectedValueOnce(new Error('leaderboard timeout'))
        .mockResolvedValueOnce([
          {
            id: 'record-1',
            recordNo: '42',
            title: 'Acme',
            ownerMemberId: 'member-1',
            ownerName: 'Ada',
            updatedAt: '2026-08-20T00:00:00.000Z',
            values: { name: 'Acme' },
          },
        ]),
    };
    const executor = new PrismaDashboardQueryExecutor(runner(transaction));
    const plans = fiveWidgetPlans();

    const results = await executor.execute(context, plans);

    expect([...results.values()]).toEqual([
      expect.objectContaining({ type: 'METRIC', state: 'READY' }),
      expect.objectContaining({
        type: 'STATUS_DISTRIBUTION',
        state: 'READY',
      }),
      expect.objectContaining({ type: 'TREND', state: 'READY' }),
      expect.objectContaining({
        type: 'LEADERBOARD',
        state: 'UNAVAILABLE',
        reason: 'QUERY_FAILED',
      }),
      expect.objectContaining({ type: 'RECORD_LIST', state: 'READY' }),
    ]);
  });
});

function fixture(transaction: object) {
  return new PrismaDashboardRepository(runner(transaction));
}

function runner(transaction: object) {
  return {
    withTenant: async <T>(
      _context: TenantContext,
      work: (value: never) => Promise<T>,
    ) => work(transaction as never),
  } as unknown as DatabaseContextRunner;
}

function metricPlan(
  id: string,
  overrides: Partial<DashboardQueryPlan> = {},
): DashboardQueryPlan {
  const object = queryObject();
  return {
    widget: {
      id,
      type: 'METRIC',
      title: id,
      audience: 'ALL',
      objectCode: 'opportunities',
      width: 'QUARTER',
      sortOrder: 0,
      filters: [],
      aggregation: 'COUNT',
      displayFormat: 'NUMBER',
      objectPublicationId: object.publication.id,
      objectPublicationNumber: object.publication.number,
      objectName: object.object.name,
      filterFields: [],
    },
    object,
    period: {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
    },
    visibleFieldKeys: [],
    ...overrides,
  };
}

function fiveWidgetPlans(): DashboardQueryPlan[] {
  const base = metricPlan('metric');
  const common = {
    objectPublicationId: base.object.publication.id,
    objectPublicationNumber: base.object.publication.number,
    objectName: base.object.object.name,
    audience: 'ALL' as const,
    objectCode: 'opportunities',
    width: 'HALF' as const,
    filters: [],
    filterFields: [],
  };
  return [
    base,
    {
      ...base,
      widget: {
        ...common,
        id: 'distribution',
        type: 'STATUS_DISTRIBUTION',
        title: 'distribution',
        sortOrder: 1,
        groupByFieldKey: 'stage',
        groupByField: {
          fieldKey: 'stage',
          label: '阶段',
          type: 'SINGLE_SELECT',
        },
        optionKeys: ['new', 'won'],
        options: [
          { key: 'new', label: '新建', color: 'BLUE' },
          { key: 'won', label: '成交', color: 'GREEN' },
        ],
        display: 'FUNNEL',
        aggregation: 'COUNT',
      },
    },
    {
      ...base,
      widget: {
        ...common,
        id: 'trend',
        type: 'TREND',
        title: 'trend',
        sortOrder: 2,
        dateFieldKey: 'close_at',
        dateField: { fieldKey: 'close_at', label: '日期', type: 'DATE' },
        granularity: 'DAY',
        aggregation: 'COUNT',
      },
    },
    {
      ...base,
      widget: {
        ...common,
        id: 'leaderboard',
        type: 'LEADERBOARD',
        title: 'leaderboard',
        sortOrder: 3,
        memberSource: 'RECORD_OWNER',
        aggregation: 'COUNT',
        limit: 10,
      },
    },
    {
      ...base,
      visibleFieldKeys: ['name'],
      widget: {
        ...common,
        id: 'records',
        type: 'RECORD_LIST',
        title: 'records',
        sortOrder: 4,
        fieldKeys: ['name'],
        displayFields: [{ fieldKey: 'name', label: '名称', type: 'TEXT' }],
        sort: { field: 'updatedAt', direction: 'DESC' },
        limit: 8,
      },
    },
  ];
}

function queryObject() {
  return {
    publication: {
      id: 'publication-opportunities-v1',
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: '2026-09-01T00:00:00.000Z',
    },
    object: {
      id: 'object-opportunities',
      code: 'opportunities',
      name: '商机',
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 1,
    },
    fields: [
      queryField('name', 'TEXT'),
      queryField('stage', 'SINGLE_SELECT'),
      queryField('amount', 'MONEY'),
      queryField('close_at', 'DATE'),
    ],
    defaultView: {
      code: 'default' as const,
      name: '默认列表',
      columnFieldKeys: ['name'],
      sort: { field: 'updatedAt' as const, direction: 'desc' as const },
    },
    employeeAccess: {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false as const,
      readScope: 'OWN' as const,
      updateScope: 'NONE' as const,
      fields: { name: 'READ_ONLY' as const },
    },
  };
}

function queryField(
  fieldKey: string,
  type: 'TEXT' | 'SINGLE_SELECT' | 'MONEY' | 'DATE',
) {
  return {
    id: `field-${fieldKey}`,
    fieldKey,
    label: fieldKey,
    type,
    required: false,
    defaultValue: null,
    validation: {},
    config: {},
    sortOrder: 1,
    isSystem: false,
  };
}
