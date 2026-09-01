import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type {
  DashboardEngine,
  DashboardEvaluationInput,
} from './dashboard-engine';
import type {
  DashboardDefinitionV2,
  DashboardRuntimeResult,
  StoredDashboardPublicationConfiguration,
} from './dashboard.types';
import { DashboardsService } from './dashboards.service';

const period = {
  from: new Date('2026-08-01T00:00:00.000Z'),
  to: new Date('2026-09-01T00:00:00.000Z'),
  timezone: 'Asia/Shanghai',
};

describe('DashboardsService', () => {
  it('includes the persisted tenant timezone in the configuration envelope', async () => {
    const { service, repository } = setup();
    repository.getTenantTimezone.mockResolvedValue('America/New_York');

    await expect(service.getConfiguration(adminContext())).resolves.toEqual(
      expect.objectContaining({ timezone: 'America/New_York' }),
    );
  });

  it('lets an administrator save a structurally valid incomplete draft', async () => {
    const { service, repository } = setup();

    await expect(
      service.saveDraft(adminContext(), {
        expectedVersion: 1,
        configuration: incompleteDraft(),
      }),
    ).resolves.toMatchObject({ draftVersion: 2 });

    expect(repository.saveDraft).toHaveBeenCalledWith(
      adminContext(),
      1,
      expect.objectContaining({
        widgets: [expect.objectContaining({ sortOrder: 0, objectCode: '' })],
      }),
      { requestId: 'req_unknown' },
    );
  });

  it('saves a record-list draft before display fields are selected', async () => {
    const draft: DashboardDefinitionV2 = {
      schemaVersion: 2,
      title: '销售工作台',
      widgets: [
        {
          id: 'records',
          type: 'RECORD_LIST',
          title: '最近更新',
          audience: 'ALL',
          objectCode: 'opportunities',
          width: 'FULL',
          sortOrder: 0,
          filters: [],
          fieldKeys: [],
          sort: { field: 'updatedAt', direction: 'DESC' },
          limit: 8,
        },
      ],
    };
    const { service, repository } = setup({ draft });

    await expect(
      service.saveDraft(adminContext(), {
        expectedVersion: 1,
        configuration: draft,
      }),
    ).resolves.toMatchObject({ draftVersion: 2 });

    expect(repository.saveDraft).toHaveBeenCalledWith(
      adminContext(),
      1,
      expect.objectContaining({
        widgets: [expect.objectContaining({ fieldKeys: [] })],
      }),
      { requestId: 'req_unknown' },
    );
  });

  it('rejects an employee attempting to save a draft', async () => {
    const { service } = setup();

    await expect(
      service.saveDraft(employeeContext(), {
        expectedVersion: 1,
        configuration: completeDraft(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('reports the dashboard draft conflict without overwriting it', async () => {
    const { service, repository } = setup();
    repository.saveDraft.mockResolvedValue(null);
    repository.getDefinition.mockResolvedValue({
      ...(await repository.getDefinition()),
      draftVersion: 5,
    });

    await expect(
      service.saveDraft(adminContext(), {
        expectedVersion: 4,
        configuration: completeDraft(),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'DASHBOARD_DRAFT_VERSION_CONFLICT',
      fieldErrors: { currentVersion: ['5'] },
    });
  });

  it('publishes only the matching saved draft after compiling current candidates', async () => {
    const { service, repository } = setup();

    await expect(
      service.publish(adminContext(), { expectedVersion: 1 }),
    ).resolves.toMatchObject({ number: 3, sourceDraftVersion: 1 });

    expect(repository.publishDraft).toHaveBeenCalledWith(
      adminContext(),
      1,
      expect.objectContaining({
        schemaVersion: 2,
        widgets: [expect.anything()],
      }),
      'member-admin',
      { requestId: 'req_unknown' },
    );
  });

  it('rejects semantic publication errors without replacing the active publication', async () => {
    const { service, repository } = setup({ draft: incompleteDraft() });

    await expect(
      service.publish(adminContext(), { expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 400 });

    expect(repository.publishDraft).not.toHaveBeenCalled();
    expect(repository.getActivePublication).not.toHaveBeenCalled();
  });

  it('reports a catalog change separately from a dashboard draft conflict', async () => {
    const { service, repository } = setup();
    repository.publishDraft.mockResolvedValue({ kind: 'CATALOG_CHANGED' });

    await expect(
      service.publish(adminContext(), { expectedVersion: 1 }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'DASHBOARD_CATALOG_CHANGED',
    });
  });

  it('evaluates the saved draft in administrator preview mode with diagnostics', async () => {
    const { service, engine } = setup();
    const preview = runtimeResult('UNAVAILABLE');
    engine.evaluate.mockResolvedValue(preview);

    await expect(
      service.preview(adminContext(), {
        expectedVersion: 1,
        period,
      }),
    ).resolves.toEqual(preview);

    const [evaluation] = engine.evaluate.mock.calls[0] ?? [];
    expect(evaluation).toMatchObject({
      context: adminContext(),
      preview: true,
    });
    expect(evaluation?.publication).toMatchObject({ schemaVersion: 2 });
  });

  it('uses the persisted tenant timezone for preview instead of a browser-supplied zone', async () => {
    const { service, repository, engine } = setup();
    repository.getTenantTimezone.mockResolvedValue('America/New_York');
    engine.evaluate.mockResolvedValue(runtimeResult('READY'));
    const browserPeriod = { ...period, timezone: 'Europe/London' };

    await service.preview(adminContext(), {
      expectedVersion: 1,
      period: browserPeriod,
    });

    const evaluation = engine.evaluate.mock.calls[0]?.[0];
    expect(evaluation?.period.timezone).toBe('America/New_York');
  });

  it('rejects an invalid field-aware filter value with its configuration path before query execution', async () => {
    const draft = completeDraft();
    draft.widgets[0] = {
      ...draft.widgets[0],
      filters: [{ fieldKey: 'name', operator: 'CONTAINS', value: '   ' }],
    };
    const { service, engine } = setup({ draft });

    await expect(
      service.preview(adminContext(), {
        expectedVersion: 1,
        period,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: {
        'widgets[0].filters[0].value': [expect.any(String)],
      },
    });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('returns an unconfigured overview when no active publication exists', async () => {
    const { service, repository, engine } = setup();
    repository.getActivePublication.mockResolvedValue(null);

    await expect(service.getOverview(adminContext(), period)).resolves.toEqual(
      expect.objectContaining({
        state: 'UNCONFIGURED',
        title: '工作台',
        widgets: [],
      }),
    );
    expect(engine.evaluate.mock.calls).toHaveLength(0);
  });

  it('reports the persisted tenant timezone in an unconfigured overview', async () => {
    const { service, repository } = setup();
    repository.getActivePublication.mockResolvedValue(null);
    repository.getTenantTimezone.mockResolvedValue('America/New_York');
    const browserPeriod = { ...period, timezone: 'Europe/London' };

    await expect(
      service.getOverview(adminContext(), browserPeriod),
    ).resolves.toMatchObject({
      period: { timezone: 'America/New_York' },
    });
  });

  it('fails visibly when the persisted tenant timezone is invalid', async () => {
    const { service, repository, engine } = setup();
    repository.getTenantTimezone.mockResolvedValue('Mars/Olympus');

    await expect(
      service.getOverview(adminContext(), period),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '租户时区配置无效，请联系平台管理员。',
    });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('evaluates the active publication rather than the current draft', async () => {
    const { service, repository, engine } = setup();
    const active = publication('published-3');
    repository.getActivePublication.mockResolvedValue(active);
    engine.evaluate.mockResolvedValue(runtimeResult('READY'));

    await service.getOverview(adminContext(), period);

    expect(engine.evaluate.mock.calls).toContainEqual([
      expect.objectContaining({
        publication: active.configuration,
        context: adminContext(),
        preview: false,
      }),
    ]);
  });

  it('delegates employee scope enforcement to the engine', async () => {
    const { service, engine } = setup();
    engine.evaluate.mockResolvedValue(runtimeResult('READY'));

    await service.getOverview(employeeContext(), period);

    expect(engine.evaluate.mock.calls).toContainEqual([
      expect.objectContaining({ context: employeeContext(), preview: false }),
    ]);
  });
});

function setup(input: { draft?: DashboardDefinitionV2 } = {}) {
  const draft = input.draft ?? completeDraft();
  const repository = {
    getDefinition: jest.fn().mockResolvedValue({
      draftVersion: 1,
      draftConfiguration: draft,
      activePublicationId: 'published-2',
      sourceTemplateVersionId: null,
      updatedAt: '2026-08-31T00:00:00.000Z',
    }),
    saveDraft: jest.fn().mockResolvedValue({
      draftVersion: 2,
      draftConfiguration: draft,
      activePublicationId: 'published-2',
      sourceTemplateVersionId: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
    }),
    publishDraft: jest.fn().mockResolvedValue({
      kind: 'PUBLISHED',
      publication: publication('published-3'),
    }),
    getActivePublication: jest
      .fn()
      .mockResolvedValue(publication('published-2')),
    listPublishedObjects: jest.fn().mockResolvedValue([publishedOpportunity()]),
    getTenantTimezone: jest.fn().mockResolvedValue('Asia/Shanghai'),
  };
  const engine = {
    evaluate: jest.fn<
      Promise<DashboardRuntimeResult>,
      [DashboardEvaluationInput]
    >(),
  };
  return {
    repository,
    engine,
    service: new DashboardsService(
      repository,
      engine as unknown as DashboardEngine,
    ),
  };
}

function completeDraft(): DashboardDefinitionV2 {
  return {
    schemaVersion: 2,
    title: '销售工作台',
    widgets: [
      {
        id: 'total',
        type: 'METRIC',
        title: '商机总数',
        audience: 'ALL',
        objectCode: 'opportunities',
        width: 'QUARTER',
        sortOrder: 4,
        filters: [],
        aggregation: 'COUNT',
      },
    ],
  };
}

function incompleteDraft(): DashboardDefinitionV2 {
  return {
    ...completeDraft(),
    widgets: [{ ...completeDraft().widgets[0], objectCode: '' }],
  };
}

function publication(id: string) {
  return {
    id,
    number: Number(id.at(-1)),
    sourceDraftVersion: 1,
    configuration: {
      kind: 'COMPILED_V2',
      raw: { schemaVersion: 2, title: '销售工作台', widgets: [] },
    } satisfies StoredDashboardPublicationConfiguration,
    publishedByMemberId: 'member-admin',
    publishedAt: '2026-09-01T00:00:00.000Z',
  };
}

function runtimeResult(state: 'READY' | 'UNAVAILABLE'): DashboardRuntimeResult {
  return {
    title: '销售工作台',
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      timezone: period.timezone,
    },
    widgets:
      state === 'READY'
        ? []
        : [
            {
              id: 'total',
              type: 'METRIC',
              title: '商机总数',
              width: 'QUARTER',
              sortOrder: 0,
              state: 'UNAVAILABLE',
              reason: 'FIELD_HIDDEN',
            },
          ],
  };
}

function adminContext(): TenantContext {
  return {
    userId: 'user-admin',
    tenantId: 'tenant-1',
    tenantCode: 'northwind',
    memberId: 'member-admin',
    role: 'TENANT_ADMIN',
  };
}

function employeeContext(): TenantContext {
  return {
    userId: 'user-employee',
    tenantId: 'tenant-1',
    tenantCode: 'northwind',
    memberId: 'member-employee',
    role: 'EMPLOYEE',
  };
}

function publishedOpportunity(): PublishedObjectSchema {
  return {
    publication: {
      id: 'object-publication-1',
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: '2026-08-31T00:00:00.000Z',
    },
    object: {
      id: 'object-1',
      code: 'opportunities',
      name: '商机',
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 1,
    },
    fields: [
      {
        id: 'field-name',
        fieldKey: 'name',
        label: '名称',
        type: 'TEXT',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 1,
        isSystem: false,
      },
    ],
    defaultView: {
      code: 'default',
      name: '默认列表',
      columnFieldKeys: ['name'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: { name: 'EDIT' },
    },
  };
}
