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
      repository.saveDraft(context, 'home', 0, {
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
      repository.saveDraft(context, 'home', 0, {
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
        after: { dashboardCode: 'home', draftVersion: 1, widgetCount: 0 },
        requestId: 'req_unknown',
      }),
    ]);
  });

  it('records publication audit metadata in the publication transaction', async () => {
    const transaction = publicationTransaction();
    const audit = auditFake();
    const repository = fixture(transaction, audit);

    await expect(
      repository.publishDraft(context, 'home', 1, compiledPublication(), 'member-1', {
        requestId: 'req-dashboard',
        ip: '127.0.0.1',
      }),
    ).resolves.toMatchObject({
      kind: 'PUBLISHED',
      publication: { number: 2, sourceDraftVersion: 1 },
    });

    expect(audit.append.mock.calls).toContainEqual([
      transaction,
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorId: 'user-1',
        action: 'dashboard.published',
        after: {
          dashboardCode: 'home',
          draftVersion: 1,
          publicationNumber: 2,
          widgetCount: 1,
        },
        requestId: 'req-dashboard',
        ip: '127.0.0.1',
      }),
    ]);
  });

  it('returns catalog changed without creating, switching, or auditing when an object binding moved', async () => {
    const transaction = publicationTransaction();
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'dashboard-home', draftVersion: 1 }])
      .mockResolvedValueOnce([
        {
          code: 'opportunities',
          status: 'ACTIVE',
          activePublicationId: 'publication-opportunities-v2',
        },
      ]);
    const audit = auditFake();
    const repository = fixture(transaction, audit);

    await expect(
      repository.publishDraft(context, 'home', 1, compiledPublication(), 'member-1'),
    ).resolves.toEqual({ kind: 'CATALOG_CHANGED' });

    expect(
      transaction.tenantDashboardPublication.create,
    ).not.toHaveBeenCalled();
    expect(
      transaction.tenantDashboardConfiguration.update,
    ).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('locks current tenant object bindings for share before inserting a publication', async () => {
    const transaction = publicationTransaction();
    const repository = fixture(transaction);

    await repository.publishDraft(
      context,
      'home',
      1,
      compiledPublication(),
      'member-1',
    );

    const queryCalls = transaction.$queryRaw.mock.calls as unknown as Array<
      unknown[]
    >;
    const bindingQuery = queryCalls[2]?.[0] as
      { sql: string; values: unknown[] } | undefined;
    expect(bindingQuery?.sql).toMatch(
      /FROM object_definitions[\s\S]*tenant_id = .*::uuid[\s\S]*code IN \([\s\S]*FOR SHARE/,
    );
    expect(bindingQuery?.values).toEqual(
      expect.arrayContaining(['tenant-1', 'opportunities']),
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      transaction.tenantDashboardPublication.create.mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('propagates audit rejection instead of reporting a saved draft', async () => {
    const audit = {
      append: jest.fn().mockRejectedValue(new Error('audit unavailable')),
    };
    const repository = fixture(draftTransaction(), audit);

    await expect(
      repository.saveDraft(context, 'home', 0, {
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

    await expect(repository.getActivePublication(context, 'home')).resolves.toEqual(
      expect.objectContaining({
        configuration: { kind: 'LEGACY', raw: legacy },
      }),
    );
  });

  it('loads the persisted tenant timezone inside tenant context', async () => {
    const transaction = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/New_York' }),
      },
    };
    const repository = fixture(transaction);

    await expect(repository.getTenantTimezone(context)).resolves.toBe(
      'America/New_York',
    );
    expect(transaction.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      select: { timezone: true },
    });
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

  it('clips a trend bucket label to the selected period instead of naming a date outside it', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRaw: jest.fn((query: { sql: string; values: unknown[] }) => {
        queries.push(query);
        return Promise.resolve([]);
      }),
    };
    const executor = new PrismaDashboardQueryExecutor(runner(transaction));
    const period = {
      from: '2026-08-15T17:06:41.809Z',
      to: '2026-09-14T17:06:41.809Z',
      timezone: 'Asia/Shanghai',
    };

    await executor.execute(context, [
      {
        ...trendPlan('calendar-trend', 'close_date', 'DATE'),
        period,
        widget: {
          ...trendPlan('calendar-trend', 'close_date', 'DATE').widget,
          granularity: 'MONTH' as const,
        },
      },
      {
        ...trendPlan('instant-trend', 'closed_at', 'DATETIME'),
        period,
        widget: {
          ...trendPlan('instant-trend', 'closed_at', 'DATETIME').widget,
          granularity: 'MONTH' as const,
        },
      },
    ]);

    // A MONTH bucket starts on the 1st, which for a rolling window is a date the
    // user never selected. Both timelines pull the label forward to the period.
    expect(queries[0]?.sql).toMatch(
      /GREATEST\([\s\S]*\)::date::timestamp[\s\S]*'YYYY-MM-DD'/,
    );
    expect(queries[1]?.sql).toMatch(
      /GREATEST\([\s\S]*AT TIME ZONE \?[\s\S]*'YYYY-MM-DD'/,
    );
    expect(queries[1]?.sql).not.toMatch(/GREATEST\([\s\S]*\)::date::timestamp/);
    expect(queries[0]?.values).toContain(period.from);
    expect(queries[1]?.values).toContain(period.from);
    // Prisma binds one parameter per placeholder, so restating the bucket in
    // GROUP BY produces an ungrouped-column error (42803) at runtime.
    expect(queries[0]?.sql).toMatch(/GROUP BY 1\b/);
    expect(queries[1]?.sql).toMatch(/GROUP BY 1\b/);
    expect(queries[0]?.sql).not.toMatch(/GROUP BY date_trunc/);
    expect(queries[1]?.sql).not.toMatch(/GROUP BY date_trunc/);
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

  it('substitutes recordNo without selecting the hidden bound title', async () => {
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

    await executor.execute(context, [{ ...recordPlan, canReadTitle: false }]);

    expect(queries[0]?.sql).toMatch(/r\.record_no::text AS title/);
    expect(queries[0]?.sql).not.toMatch(/\br\.title\b/);
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
        id: 'dashboard-home',
        tenantId: 'tenant-1',
        code: 'home',
        name: '工作台',
        status: 'ACTIVE',
        audience: 'ALL',
        sortOrder: 0,
        draftVersion: 1,
        draftConfiguration: { schemaVersion: 2, title: '工作台', widgets: [] },
        activePublicationId: null,
        sourceTemplateVersionId: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        defaultAdminDashboardId: null,
        defaultEmployeeDashboardId: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function publicationTransaction() {
  let queryCount = 0;
  return {
    $queryRaw: jest.fn(() => {
      queryCount += 1;
      if (queryCount === 1) return Promise.resolve([]);
      if (queryCount === 2)
        return Promise.resolve([{ id: 'dashboard-home', draftVersion: 1 }]);
      if (queryCount === 3)
        return Promise.resolve([
          {
            code: 'opportunities',
            status: 'ACTIVE',
            activePublicationId: 'publication-opportunities-v1',
          },
        ]);
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
    tenantDashboardConfiguration: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function compiledPublication(): PublishedDashboardDefinitionV2 {
  return {
    schemaVersion: 2,
    title: '工作台',
    widgets: [
      {
        id: 'metric',
        objectCode: 'opportunities',
        objectPublicationId: 'publication-opportunities-v1',
      },
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
    canReadTitle: true,
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
