import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type { DashboardEngine } from './dashboard-engine';
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
  it('lets an administrator save a structurally valid incomplete draft', async () => {
    const { service, repository } = setup();

    await expect(
      serviceAsV2(service).saveDraft(adminContext(), {
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

  it('rejects an employee attempting to save a draft', async () => {
    const { service } = setup();

    await expect(
      serviceAsV2(service).saveDraft(employeeContext(), {
        expectedVersion: 1,
        configuration: completeDraft(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('reports the dashboard draft conflict without overwriting it', async () => {
    const { service, repository } = setup();
    repository.saveDraft.mockResolvedValue(null);

    await expect(
      serviceAsV2(service).saveDraft(adminContext(), {
        expectedVersion: 4,
        configuration: completeDraft(),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'DASHBOARD_DRAFT_VERSION_CONFLICT',
    });
  });

  it('publishes only the matching saved draft after compiling current candidates', async () => {
    const { service, repository } = setup();

    await expect(
      serviceAsV2(service).publish(adminContext(), { expectedVersion: 1 }),
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
      serviceAsV2(service).publish(adminContext(), { expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 400 });

    expect(repository.publishDraft).not.toHaveBeenCalled();
    expect(repository.getActivePublication).not.toHaveBeenCalled();
  });

  it('evaluates the saved draft in administrator preview mode with diagnostics', async () => {
    const { service, engine } = setup();
    const preview = runtimeResult('UNAVAILABLE');
    engine.evaluate.mockResolvedValue(preview);

    await expect(
      serviceAsV2(service).preview(adminContext(), {
        expectedVersion: 1,
        period,
      }),
    ).resolves.toEqual(preview);

    expect(engine.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        context: adminContext(),
        preview: true,
        publication: expect.objectContaining({ schemaVersion: 2 }),
      }),
    );
  });

  it('returns an unconfigured overview when no active publication exists', async () => {
    const { service, repository, engine } = setup();
    repository.getActivePublication.mockResolvedValue(null);

    await expect(
      serviceAsV2(service).getOverview(adminContext(), period),
    ).resolves.toEqual(
      expect.objectContaining({ state: 'UNCONFIGURED', widgets: [] }),
    );
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('evaluates the active publication rather than the current draft', async () => {
    const { service, repository, engine } = setup();
    const active = publication('published-3');
    repository.getActivePublication.mockResolvedValue(active);
    engine.evaluate.mockResolvedValue(runtimeResult('READY'));

    await serviceAsV2(service).getOverview(adminContext(), period);

    expect(engine.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        publication: active.configuration,
        context: adminContext(),
        preview: false,
      }),
    );
  });

  it('delegates employee scope enforcement to the engine', async () => {
    const { service, engine } = setup();
    engine.evaluate.mockResolvedValue(runtimeResult('READY'));

    await serviceAsV2(service).getOverview(employeeContext(), period);

    expect(engine.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ context: employeeContext(), preview: false }),
    );
  });
});

interface DashboardV2Service {
  getOverview(context: TenantContext, query: typeof period): Promise<unknown>;
  saveDraft(
    context: TenantContext,
    input: { expectedVersion: number; configuration: DashboardDefinitionV2 },
  ): Promise<unknown>;
  preview(
    context: TenantContext,
    input: { expectedVersion: number; period: typeof period },
  ): Promise<DashboardRuntimeResult>;
  publish(
    context: TenantContext,
    input: { expectedVersion: number },
  ): Promise<unknown>;
}

function serviceAsV2(service: DashboardsService): DashboardV2Service {
  return service as unknown as DashboardV2Service;
}

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
    publishDraft: jest.fn().mockResolvedValue(publication('published-3')),
    getActivePublication: jest
      .fn()
      .mockResolvedValue(publication('published-2')),
    listPublishedObjects: jest.fn().mockResolvedValue([publishedOpportunity()]),
  };
  const engine = {
    evaluate: jest.fn(),
  } as unknown as jest.Mocked<DashboardEngine>;
  return {
    repository,
    engine,
    service: new DashboardsService(repository as never, engine),
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
