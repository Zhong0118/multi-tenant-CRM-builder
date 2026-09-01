import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import type { PublishedObjectSchema } from '../objects/object-schema';
import { compileDashboardPublication } from './dashboard-definition';
import {
  DashboardEngine,
  type DashboardAccessResolver,
  type DashboardQueryExecutor,
  type DashboardQueryPlan,
  type DashboardWidgetResult,
} from './dashboard-engine';
import type {
  DashboardCatalog,
  DashboardDefinitionV2,
  DashboardPeriod,
  StoredDashboardPublicationConfiguration,
} from './dashboard.types';

const period: DashboardPeriod = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-09-01T00:00:00.000Z',
  timezone: 'Asia/Shanghai',
};

describe('DashboardEngine', () => {
  it('omits widgets outside the employee audience before executing queries', async () => {
    const fixture = setup([
      metric('all-metric', 'ALL'),
      metric('admin-metric', 'TENANT_ADMIN'),
    ]);

    const result = await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    expect(fixture.executor.plans.map((plan) => plan.widget.id)).toEqual([
      'all-metric',
    ]);
    expect(result.widgets.map((widget) => widget.id)).toEqual(['all-metric']);
  });

  it('forces OWN plans to the current employee and collapses leaderboard scope', async () => {
    const fixture = setup([
      metric('owned-total', 'ALL'),
      {
        ...widgetBase('owned-leaderboard', 'ALL'),
        type: 'LEADERBOARD',
        memberSource: 'RECORD_OWNER',
        aggregation: 'COUNT',
        limit: 10,
      },
    ]);

    await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    expect(fixture.executor.plans).toHaveLength(2);
    expect(
      fixture.executor.plans.map((plan) => ({
        id: plan.widget.id,
        ownerMemberId: plan.ownerMemberId,
      })),
    ).toEqual([
      { id: 'owned-total', ownerMemberId: 'member-employee' },
      { id: 'owned-leaderboard', ownerMemberId: 'member-employee' },
    ]);
  });

  it('collapses an OWN FIELD leaderboard to the current record owner', async () => {
    const fixture = setup([
      {
        ...widgetBase('credited-leaderboard', 'ALL'),
        type: 'LEADERBOARD',
        memberSource: 'FIELD',
        memberFieldKey: 'owner',
        aggregation: 'COUNT',
        limit: 10,
      },
    ]);

    await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    const plan = fixture.executor.plans[0];
    expect(plan?.ownerMemberId).toBe('member-employee');
    expect(plan?.widget.type).toBe('LEADERBOARD');
    if (plan?.widget.type !== 'LEADERBOARD') {
      throw new Error('Expected leaderboard plan');
    }
    expect(plan.widget.memberSource).toBe('RECORD_OWNER');
  });

  it('omits widgets when current object access is NONE', async () => {
    const fixture = setup([metric('forbidden', 'ALL')], {
      canRead: false,
      readScope: 'NONE',
    });

    const result = await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    expect(fixture.executor.plans).toEqual([]);
    expect(result.widgets).toEqual([]);
  });

  it('omits a widget whose required aggregation field is hidden', async () => {
    const fixture = setup(
      [
        {
          ...widgetBase('hidden-sum', 'ALL'),
          type: 'METRIC',
          aggregation: 'SUM',
          valueFieldKey: 'amount',
          displayFormat: 'MONEY',
        },
      ],
      { fields: { amount: 'HIDDEN' } },
    );

    const result = await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    expect(fixture.executor.plans).toEqual([]);
    expect(result.widgets).toEqual([]);
  });

  it('fails closed when a compiled field no longer has current access metadata', async () => {
    const fixture = setup(
      [
        {
          ...widgetBase('removed-sum', 'ALL'),
          type: 'METRIC',
          aggregation: 'SUM',
          valueFieldKey: 'amount',
          displayFormat: 'MONEY',
        },
      ],
      { fields: { amount: undefined as never } },
    );

    const result = await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    expect(fixture.executor.plans).toEqual([]);
    expect(result.widgets).toEqual([]);
  });

  it('projects hidden record-list fields while keeping visible columns', async () => {
    const fixture = setup(
      [
        {
          ...widgetBase('records', 'ALL'),
          type: 'RECORD_LIST',
          fieldKeys: ['name', 'amount'],
          sort: { field: 'updatedAt', direction: 'DESC' },
          limit: 8,
        },
      ],
      { fields: { amount: 'HIDDEN' } },
    );

    await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    expect(fixture.executor.plans[0]).toEqual(
      expect.objectContaining({ visibleFieldKeys: ['name'] }),
    );
  });

  it('marks a record-list title as unreadable when the bound title field is hidden', async () => {
    const fixture = setup(
      [
        {
          ...widgetBase('records', 'ALL'),
          type: 'RECORD_LIST',
          fieldKeys: ['stage'],
          sort: { field: 'updatedAt', direction: 'DESC' },
          limit: 8,
        },
      ],
      { fields: { name: 'HIDDEN' } },
    );

    await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    expect(fixture.executor.plans[0]).toEqual(
      expect.objectContaining({ canReadTitle: false }),
    );
  });

  it('keeps administrator plans tenant-wide and resolves an object only once', async () => {
    const fixture = setup([metric('first', 'ALL'), metric('second', 'ALL')], {
      readScope: 'OWN',
    });

    await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: adminContext(),
      period,
    });

    expect(fixture.resolver.resolveRuntimeSchema).toHaveBeenCalledTimes(1);
    expect(fixture.executor.plans).toHaveLength(2);
    expect(fixture.executor.plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerMemberId: undefined }),
      ]),
    );
  });

  it('keeps ready siblings when the executor marks one widget unavailable', async () => {
    const fixture = setup([metric('ready', 'ALL'), metric('broken', 'ALL')]);
    fixture.executor.resultFor = (plan) =>
      plan.widget.id === 'broken'
        ? unavailable(plan, 'QUERY_FAILED')
        : ready(plan);

    const result = await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: employeeContext(),
      period,
    });

    expect(result.widgets).toEqual([
      expect.objectContaining({ id: 'ready', state: 'READY' }),
      expect.objectContaining({ id: 'broken', state: 'UNAVAILABLE' }),
    ]);
    expect(result.widgets[1]).not.toHaveProperty('reason');
  });

  it('returns omission reasons only to administrator preview', async () => {
    const fixture = setup(
      [
        {
          ...widgetBase('hidden-sum', 'ALL'),
          type: 'METRIC',
          aggregation: 'SUM',
          valueFieldKey: 'amount',
          displayFormat: 'MONEY',
        },
      ],
      { fields: { amount: 'HIDDEN' } },
    );

    const result = await fixture.engine.evaluate({
      publication: fixture.publication,
      catalog: fixture.catalog,
      context: adminContext(),
      period,
      preview: true,
    });

    expect(result.widgets).toEqual([
      expect.objectContaining({
        id: 'hidden-sum',
        state: 'UNAVAILABLE',
        reason: 'FIELD_HIDDEN',
      }),
    ]);
  });

  it('normalizes a discriminated legacy publication against the current catalog', async () => {
    const fixture = setup([]);
    const legacy = {
      kind: 'LEGACY',
      raw: {
        opportunity: {
          objectCode: 'opportunities',
          stageFieldKey: 'stage',
          amountFieldKey: 'amount',
          dateFieldKey: 'close_at',
          activeOptionKeys: ['new'],
          wonOptionKeys: ['won'],
          lostOptionKeys: ['lost'],
        },
      },
    } satisfies StoredDashboardPublicationConfiguration;

    const result = await fixture.engine.evaluate({
      publication: legacy,
      catalog: fixture.catalog,
      context: adminContext(),
      period,
    });

    expect(result.widgets).toHaveLength(5);
    expect(fixture.executor.plans[0]?.widget).toEqual(
      expect.objectContaining({
        objectPublicationId: 'publication-opportunities-v1',
      }),
    );
  });
});

function setup(
  widgets: DashboardDefinitionV2['widgets'],
  accessOverrides: Partial<EffectiveObjectAccess> = {},
) {
  const object = publishedObject();
  const catalog: DashboardCatalog = [object];
  const publication = compileDashboardPublication(
    { schemaVersion: 2, title: '工作台', widgets },
    catalog,
  );
  const baseFields = Object.fromEntries(
    object.fields.map((field) => [field.fieldKey, 'READ_ONLY' as const]),
  );
  const access: EffectiveObjectAccess = {
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    readScope: 'OWN',
    updateScope: 'NONE',
    ...accessOverrides,
    fields: {
      ...baseFields,
      ...accessOverrides.fields,
    },
  };
  const resolver = {
    resolveRuntimeSchema: jest.fn().mockResolvedValue({
      schema: object,
      access,
      visibleSchema: {} as never,
    }),
  } satisfies DashboardAccessResolver;
  const executor = new FakeQueryExecutor();
  return {
    catalog,
    publication,
    resolver,
    executor,
    engine: new DashboardEngine(resolver, executor),
  };
}

class FakeQueryExecutor implements DashboardQueryExecutor {
  plans: DashboardQueryPlan[] = [];
  resultFor: (plan: DashboardQueryPlan) => DashboardWidgetResult = ready;

  execute(_context: TenantContext, plans: DashboardQueryPlan[]) {
    this.plans = plans;
    return Promise.resolve(
      new Map(plans.map((plan) => [plan.widget.id, this.resultFor(plan)])),
    );
  }
}

function ready(plan: DashboardQueryPlan): DashboardWidgetResult {
  return {
    ...presentation(plan),
    state: 'READY',
    data: plan.widget.type === 'METRIC' ? { value: 1 } : { items: [] },
  } as DashboardWidgetResult;
}

function unavailable(
  plan: DashboardQueryPlan,
  reason: 'QUERY_FAILED',
): DashboardWidgetResult {
  return { ...presentation(plan), state: 'UNAVAILABLE', reason };
}

function presentation(plan: DashboardQueryPlan) {
  return {
    id: plan.widget.id,
    type: plan.widget.type,
    title: plan.widget.title,
    description: plan.widget.description,
    width: plan.widget.width,
    sortOrder: plan.widget.sortOrder,
  };
}

function metric(
  id: string,
  audience: DashboardDefinitionV2['widgets'][number]['audience'],
): DashboardDefinitionV2['widgets'][number] {
  return {
    ...widgetBase(id, audience),
    type: 'METRIC',
    aggregation: 'COUNT',
    displayFormat: 'NUMBER',
  };
}

function widgetBase(
  id: string,
  audience: DashboardDefinitionV2['widgets'][number]['audience'],
) {
  return {
    id,
    title: id,
    audience,
    objectCode: 'opportunities',
    width: 'HALF' as const,
    sortOrder: Number(id.length),
    filters: [],
  };
}

function publishedObject(): PublishedObjectSchema {
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
      field('name', 'TEXT'),
      field('stage', 'SINGLE_SELECT', {
        options: [
          { key: 'new', label: '新商机', color: 'BLUE', status: 'ACTIVE' },
          { key: 'won', label: '已成交', color: 'GREEN', status: 'ACTIVE' },
          { key: 'lost', label: '失败', color: 'RED', status: 'ACTIVE' },
        ],
      }),
      field('amount', 'MONEY'),
      field('close_at', 'DATE'),
      field('owner', 'MEMBER'),
    ],
    defaultView: {
      code: 'default',
      name: '默认列表',
      columnFieldKeys: ['name', 'stage', 'amount'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'NONE',
      fields: {
        name: 'READ_ONLY',
        stage: 'READ_ONLY',
        amount: 'READ_ONLY',
        close_at: 'READ_ONLY',
        owner: 'READ_ONLY',
      },
    },
  };
}

function field(
  fieldKey: string,
  type: PublishedObjectSchema['fields'][number]['type'],
  config: PublishedObjectSchema['fields'][number]['config'] = {},
): PublishedObjectSchema['fields'][number] {
  return {
    id: `field-${fieldKey}`,
    fieldKey,
    label: fieldKey,
    type,
    required: false,
    defaultValue: null,
    validation: {},
    config,
    sortOrder: 1,
    isSystem: false,
  };
}

function adminContext(): TenantContext {
  return {
    userId: 'user-admin',
    tenantId: 'tenant-1',
    tenantCode: 'acme',
    memberId: 'member-admin',
    role: 'TENANT_ADMIN',
  };
}

function employeeContext(): TenantContext {
  return {
    userId: 'user-employee',
    tenantId: 'tenant-1',
    tenantCode: 'acme',
    memberId: 'member-employee',
    role: 'EMPLOYEE',
  };
}
