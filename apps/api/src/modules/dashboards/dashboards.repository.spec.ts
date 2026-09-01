import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { DashboardQueryPlan } from './dashboard-engine';
import type { PublishedDashboardDefinitionV2 } from './dashboard.types';
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
  it('does not silently save when its required audit dependency is absent', async () => {
    const transaction = draftTransaction();
    const repository = new PrismaDashboardRepository(
      runner(transaction),
      undefined as never,
    );

    await expect(
      repository.saveDraft(context, 0, {
        schemaVersion: 2,
        title: '工作台',
        widgets: [],
      }),
    ).rejects.toThrow();
  });

  it('takes a tenant-scoped advisory lock with a Prisma-supported scalar before checking an optional definition', async () => {
    const queries: string[] = [];
    const transaction = draftTransaction(queries);
    const audit = auditFake();
    const repository = fixture(transaction, audit);

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
    expect(queries[0]).toMatch(/IS NULL\s*\) AS "acquired"/);
    expect(queries[1]).toMatch(
      /FROM tenant_dashboard_configurations[\s\S]*FOR UPDATE/,
    );
    expect(audit.append.mock.calls).toContainEqual([
      transaction,
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorId: 'user-1',
        action: 'dashboard.draft_saved',
        after: { draftVersion: 1, widgetCount: 0 },
        requestId: 'req_unknown',
      }),
    ]);
  });

  it('records publication audit metadata in the publication transaction', async () => {
    const transaction = publicationTransaction();
    const audit = auditFake();
    const repository = fixture(transaction, audit);

    await expect(
      repository.publishDraft(context, 1, compiledPublication(), 'member-1', {
        requestId: 'req-dashboard',
        ip: '127.0.0.1',
      }),
    ).resolves.toMatchObject({ number: 2, sourceDraftVersion: 1 });

    expect(audit.append.mock.calls).toContainEqual([
      transaction,
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorId: 'user-1',
        action: 'dashboard.published',
        after: { draftVersion: 1, publicationNumber: 2, widgetCount: 1 },
        requestId: 'req-dashboard',
        ip: '127.0.0.1',
      }),
    ]);
  });

  it('propagates audit rejection instead of reporting a saved draft', async () => {
    const audit = {
      append: jest.fn().mockRejectedValue(new Error('audit unavailable')),
    };
    const repository = fixture(draftTransaction(), audit);

    await expect(
      repository.saveDraft(context, 0, {
        schemaVersion: 2,
        title: '工作台',
        widgets: [],
      }),
    ).rejects.toThrow('audit unavailable');
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
  it('runs every widget in its own tenant transaction before isolating failures', async () => {
    let transactionNumber = 0;
    const withTenant = jest.fn(
      <T>(
        _context: TenantContext,
        work: (transaction: never) => Promise<T>,
      ) => {
        const current = transactionNumber++;
        const transaction = {
          $queryRaw: jest.fn(() =>
            current === 0
              ? Promise.resolve([{ value: 7 }])
              : Promise.reject(new Error('statement aborted transaction')),
          ),
        };
        return work(transaction as never);
      },
    );
    const executor = new PrismaDashboardQueryExecutor({
      withTenant,
    } as unknown as DatabaseContextRunner);

    const results = await executor.execute(context, [
      metricPlan('ready'),
      metricPlan('broken'),
    ]);

    expect(withTenant).toHaveBeenCalledTimes(2);
    expect([...results.values()]).toEqual([
      expect.objectContaining({ id: 'ready', state: 'READY' }),
      expect.objectContaining({
        id: 'broken',
        state: 'UNAVAILABLE',
        reason: 'QUERY_FAILED',
      }),
    ]);
  });

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

  it('binds a FIELD leaderboard member key once and groups by selected columns', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRaw: jest.fn((query: { sql: string; values: unknown[] }) => {
        queries.push(query);
        return Promise.resolve([]);
      }),
    };
    const executor = new PrismaDashboardQueryExecutor(runner(transaction));
    const base = metricPlan('field-leaderboard');
    const plan: DashboardQueryPlan = {
      ...base,
      widget: {
        id: 'field-leaderboard',
        type: 'LEADERBOARD',
        title: 'field-leaderboard',
        audience: 'ALL',
        objectCode: 'opportunities',
        width: 'HALF',
        sortOrder: 0,
        filters: [],
        memberSource: 'FIELD',
        memberFieldKey: 'credited_member',
        memberField: {
          fieldKey: 'credited_member',
          label: '归属成员',
          type: 'MEMBER',
        },
        aggregation: 'COUNT',
        limit: 10,
        objectPublicationId: base.object.publication.id,
        objectPublicationNumber: base.object.publication.number,
        objectName: base.object.object.name,
        filterFields: [],
      },
    };

    await executor.execute(context, [plan]);

    expect(
      queries[0]?.values.filter((value) => value === 'credited_member'),
    ).toHaveLength(1);
    expect(queries[0]?.sql).toMatch(/GROUP BY 1, 2/);
  });

  it('guards standard ISO DATE and DATETIME values without PostgreSQL 16-only functions', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRaw: jest.fn((query: { sql: string; values: unknown[] }) => {
        queries.push(query);
        return Promise.resolve([]);
      }),
    };
    const executor = new PrismaDashboardQueryExecutor(runner(transaction));

    await executor.execute(context, [
      trendPlan('calendar-trend', 'close_date', 'DATE'),
      trendPlan('instant-trend', 'closed_at', 'DATETIME'),
    ]);

    expect(queries[0]?.sql).not.toContain('pg_input_is_valid');
    expect(queries[0]?.sql).toContain("~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(queries[0]?.sql).toMatch(/BETWEEN 1 AND 9999/);
    expect(queries[0]?.sql).toMatch(/BETWEEN 1 AND 12/);
    expect(queries[0]?.sql).toMatch(/BETWEEN 1 AND 31/);
    expect(queries[0]?.sql).not.toContain('to_date(');
    expect(queries[0]?.sql).toMatch(
      /to_char\([\s\S]*make_date\([\s\S]*,[\s\S]*,[\s\S]*1\)[\s\S]*\+ \([\s\S]*- 1\)[\s\S]*'YYYY-MM-DD'\s*\)[\s\S]*=/,
    );
    expect(queries[0]?.sql).toMatch(/THEN \(r\.data ->> \?\)::date/);
    expect(queries[0]?.sql).toMatch(
      />= \(\?::timestamptz AT TIME ZONE \?\)::date/,
    );
    expect(queries[0]?.sql).toMatch(/END\s*::timestamp/);
    expect(queries[1]?.sql).not.toContain('pg_input_is_valid');
    expect(queries[1]?.sql).toContain(
      "~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'",
    );
    expect(queries[1]?.sql).toMatch(/BETWEEN 0 AND 23/);
    expect(queries[1]?.sql).toMatch(/BETWEEN 0 AND 59/);
    expect(queries[1]?.sql).not.toContain('to_date(');
    expect(queries[1]?.sql).toMatch(
      /to_char\([\s\S]*make_date\([\s\S]*,[\s\S]*,[\s\S]*1\)[\s\S]*\+ \([\s\S]*- 1\)[\s\S]*'YYYY-MM-DD'\s*\)[\s\S]*=/,
    );
    expect(queries[1]?.sql).toMatch(/THEN \(r\.data ->> \?\)::timestamptz/);
    expect(queries[1]?.sql).toMatch(/>= \?::timestamptz/);
    expect(queries[1]?.sql).toMatch(/END\s*AT TIME ZONE \?/);
  });

  it('uses local calendar bounds for DATE filters and instant bounds for DATETIME filters', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRaw: jest.fn((query: { sql: string; values: unknown[] }) => {
        queries.push(query);
        return Promise.resolve([{ value: 0 }]);
      }),
    };
    const executor = new PrismaDashboardQueryExecutor(runner(transaction));

    await executor.execute(context, [
      dateFilterPlan('calendar-filter', 'close_date', 'DATE'),
      dateFilterPlan('instant-filter', 'closed_at', 'DATETIME'),
    ]);

    expect(queries[0]?.sql).toMatch(/= \(NOW\(\) AT TIME ZONE \?\)::date/);
    expect(queries[1]?.sql).toMatch(
      />= date_trunc\('day', NOW\(\) AT TIME ZONE \?\) AT TIME ZONE \?/,
    );
    expect(queries[1]?.sql).toMatch(/< [\s\S]*INTERVAL '1 day'/);
  });

  it('formats record-list updatedAt as an explicit UTC ISO timestamp', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRaw: jest.fn((query: { sql: string; values: unknown[] }) => {
        queries.push(query);
        return Promise.resolve([]);
      }),
    };
    const executor = new PrismaDashboardQueryExecutor(runner(transaction));
    const recordPlan = fiveWidgetPlans().find(
      (plan) => plan.widget.type === 'RECORD_LIST',
    );
    if (!recordPlan) throw new Error('Record plan missing');

    await executor.execute(context, [recordPlan]);

    expect(queries[0]?.sql).toMatch(
      /to_char\(\s*r\.updated_at AT TIME ZONE 'UTC',\s*'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\s*\) AS "updatedAt"/,
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

function fixture(
  transaction: object,
  audit: { append: jest.Mock } = auditFake(),
) {
  return new PrismaDashboardRepository(runner(transaction), audit as never);
}

function auditFake(): { append: jest.Mock } {
  return { append: jest.fn().mockResolvedValue(undefined) };
}

function draftTransaction(queries: string[] = []) {
  return {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const query = strings.join('?');
      queries.push(query);
      return Promise.resolve([]);
    }),
    tenantDashboardConfiguration: {
      create: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        draftVersion: 1,
        draftConfiguration: { schemaVersion: 2, title: '工作台', widgets: [] },
        activePublicationId: null,
        sourceTemplateVersionId: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    },
  };
}

function publicationTransaction() {
  let queryCount = 0;
  return {
    $queryRaw: jest.fn(() => {
      queryCount += 1;
      if (queryCount === 1) return Promise.resolve([]);
      if (queryCount === 2) return Promise.resolve([{ draftVersion: 1 }]);
      return Promise.resolve([{ number: 2 }]);
    }),
    tenantDashboardPublication: {
      create: jest.fn().mockResolvedValue({
        id: 'publication-2',
        publicationNo: 2,
        sourceDraftVersion: 1,
        configuration: {
          kind: 'COMPILED_V2',
          raw: { schemaVersion: 2, title: '工作台', widgets: [] },
        },
        publishedByMemberId: 'member-1',
        publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    },
    tenantDashboardConfiguration: { update: jest.fn().mockResolvedValue({}) },
  };
}

function compiledPublication(): PublishedDashboardDefinitionV2 {
  return {
    schemaVersion: 2,
    title: '工作台',
    widgets: [
      { id: 'metric' },
    ] as unknown as PublishedDashboardDefinitionV2['widgets'],
  };
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

function trendPlan(
  id: string,
  fieldKey: string,
  type: 'DATE' | 'DATETIME',
): DashboardQueryPlan {
  const base = metricPlan(id);
  return {
    ...base,
    widget: {
      id,
      type: 'TREND',
      title: id,
      audience: 'ALL',
      objectCode: 'opportunities',
      width: 'HALF',
      sortOrder: 0,
      filters: [],
      dateFieldKey: fieldKey,
      dateField: { fieldKey, label: fieldKey, type },
      granularity: 'DAY',
      aggregation: 'COUNT',
      objectPublicationId: base.object.publication.id,
      objectPublicationNumber: base.object.publication.number,
      objectName: base.object.object.name,
      filterFields: [],
    },
  };
}

function dateFilterPlan(
  id: string,
  fieldKey: string,
  type: 'DATE' | 'DATETIME',
): DashboardQueryPlan {
  const base = metricPlan(id);
  return {
    ...base,
    widget: {
      ...base.widget,
      filters: [{ fieldKey, operator: 'TODAY' }],
      filterFields: [{ fieldKey, label: fieldKey, type }],
    },
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
