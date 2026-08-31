import { ParseUUIDPipe } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuditEvent } from '../audit/audit-event';
import { checksumTemplateConfiguration } from './business-template-publication.policy';
import type { BusinessTemplateConfiguration } from './business-template.schema';
import type { DashboardDefinitionV2 } from '../dashboards/dashboard.types';
import { TemplateApplicationController } from './template-application.controller';
import type {
  CreateTemplateApplication,
  HydratedTenantConfiguration,
  TemplateApplicationEligibility,
  TemplateApplicationInput,
  TemplateApplicationRepository,
  TemplateApplicationResult,
  TemplateApplicationStore,
  TemplateApplicationTarget,
} from './template-application.repository';
import { TemplateApplicationService } from './template-application.service';

const platformAdmin = {
  id: 'platform-user-1',
  phone: '+8613900000301',
  isPlatformAdmin: true,
};

const meta = { requestId: 'req-application-1', ip: '127.0.0.1' };
const appliedAt = new Date('2026-08-26T04:00:00.000Z');

describe('TemplateApplicationService', () => {
  it('creates a complete tenant draft graph with fresh identities and source facts', async () => {
    const { service, state, transactionEvents } = applicationFixture();

    const result = await service.apply(platformAdmin, applicationInput(), meta);

    expect(result).toMatchObject({
      templateId: 'template-1',
      templateCode: 'sales',
      templateName: '销售模板',
      templateVersionId: 'version-1',
      templateVersionNo: 1,
      tenantId: 'tenant-1',
      tenantCode: 'acme',
      tenantName: 'Acme',
      configurationChecksum: checksumTemplateConfiguration(configuration()),
      appliedAt,
      objects: [
        {
          templateObjectId: 'template-object-1',
          code: 'customers',
          name: '客户',
        },
      ],
    });
    expect(state.objects).toEqual([
      expect.objectContaining({
        id: result.objects[0].objectId,
        tenantId: 'tenant-1',
        code: 'customers',
        status: 'DRAFT',
        sourceTemplateVersionId: 'version-1',
        activePublicationId: null,
        publishedAt: null,
        version: 1,
      }),
    ]);
    expect(state.fields).toHaveLength(2);
    expect(state.views).toHaveLength(1);
    expect(state.objectPermissions).toHaveLength(1);
    expect(state.fieldPermissions).toHaveLength(2);
    expect(state.publications).toEqual([]);
    expect(state.recordCounters).toEqual([]);

    const generatedIds = [
      ...state.objects,
      ...state.fields,
      ...state.views,
      ...state.objectPermissions,
      ...state.fieldPermissions,
    ].map((row) => row.id);
    expect(new Set(generatedIds).size).toBe(generatedIds.length);
    expect(generatedIds).not.toContain('template-object-1');
    expect(generatedIds).not.toContain('template-field-name');
    expect(generatedIds).not.toContain('template-field-phone');
    expect(state.fieldPermissions.map((row) => row.fieldId).sort()).toEqual(
      state.fields.map((row) => row.id).sort(),
    );

    expect(state.applications).toEqual([result]);
    expect(state.audits).toEqual([
      {
        tenantId: 'tenant-1',
        actorType: 'USER',
        actorId: 'platform-user-1',
        action: 'platform.template.applied',
        resourceType: 'business_template_application',
        resourceId: result.id,
        after: {
          templateId: 'template-1',
          templateVersionId: 'version-1',
          templateVersionNo: 1,
          objectCount: 1,
          objectIdMap: {
            'template-object-1': result.objects[0].objectId,
          },
        },
        requestId: 'req-application-1',
        ip: '127.0.0.1',
      },
    ]);
    expect(transactionEvents).toEqual([
      'findApplication',
      'lockTemplate',
      'lockTenant',
      'findApplication',
      'requireApplicableVersion',
      'enterTenant',
      'assertTenantEmpty',
      'insertTenantConfiguration',
      'createApplication',
      'appendAudit',
    ]);
  });

  it('copies a dashboard preset into an unpublished tenant draft', async () => {
    const { service, state } = applicationFixture({
      configuration: configurationWithDashboard(),
    });

    await service.apply(platformAdmin, applicationInput(), meta);

    expect(state.dashboard).toEqual({
      tenantId: 'tenant-1',
      draftVersion: 1,
      draftConfiguration: dashboardPreset(),
      sourceTemplateVersionId: 'version-1',
      activePublicationId: null,
    });
  });

  it('returns the first application before acquiring locks on an exact retry', async () => {
    const { service, state, transactionEvents } = applicationFixture();
    const input = applicationInput();

    const first = await service.apply(platformAdmin, input, meta);
    transactionEvents.length = 0;
    const second = await service.apply(platformAdmin, input, meta);

    expect(second).toEqual(first);
    expect(state.objects).toHaveLength(1);
    expect(state.applications).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(transactionEvents).toEqual(['findApplication']);
  });

  it('does not return an application when the route template differs', async () => {
    const { service, state } = applicationFixture();
    await service.apply(platformAdmin, applicationInput(), meta);
    if (!state.template?.version) throw new Error('fixture template missing');
    state.template.id = 'template-2';
    state.template.code = 'service';
    state.template.name = '服务模板';
    state.template.activeVersionId = 'version-2';
    state.template.version = {
      ...state.template.version,
      id: 'version-2',
      templateId: 'template-2',
    };

    await expect(
      service.apply(
        platformAdmin,
        { ...applicationInput(), templateId: 'template-2' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_APPLICATION_NOT_ALLOWED' });

    expect(state.applications).toHaveLength(1);
    expect(state.applications[0].templateId).toBe('template-1');
  });

  it('returns a concurrent winner found after both row locks', async () => {
    const winner = existingApplication();
    const { service, state, transactionEvents } = applicationFixture({
      applicationAfterLocks: winner,
    });

    await expect(
      service.apply(platformAdmin, applicationInput(), meta),
    ).resolves.toEqual(winner);

    expect(state.applications).toEqual([winner]);
    expect(state.objects).toEqual([]);
    expect(state.audits).toEqual([]);
    expect(transactionEvents).toEqual([
      'findApplication',
      'lockTemplate',
      'lockTenant',
      'findApplication',
    ]);
  });

  it('safely re-reads the exact concurrent winner after a create uniqueness race', async () => {
    const winner = existingApplication();
    const { service, state } = applicationFixture({
      winnerOnCreateConflict: winner,
    });

    await expect(
      service.apply(platformAdmin, applicationInput(), meta),
    ).resolves.toEqual(winner);

    expect(state.applications).toEqual([winner]);
    expect(state.objects).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('rolls back every normalized row and the application when hydration fails', async () => {
    const { service, state } = applicationFixture({
      configuration: configuration(2),
      failAfterObject: 1,
    });

    await expect(
      service.apply(platformAdmin, applicationInput(), meta),
    ).rejects.toThrow('hydration failed');

    expect(state.objects).toEqual([]);
    expect(state.fields).toEqual([]);
    expect(state.views).toEqual([]);
    expect(state.objectPermissions).toEqual([]);
    expect(state.fieldPermissions).toEqual([]);
    expect(state.applications).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it.each<[string, FixtureOptions]>([
    ['a non-DRAFT tenant', { tenantStatus: 'ACTIVE' as const }],
    ['an existing object row of any status', { existingObject: true }],
    ['a stale requested active version', { activeVersionId: 'version-2' }],
    ['an archived template', { archived: true }],
    ['a checksum mismatch', { checksum: '0'.repeat(64) }],
  ])('rejects %s with the stable application error', async (_name, options) => {
    const { service, state } = applicationFixture(options);

    await expect(
      service.apply(platformAdmin, applicationInput(), meta),
    ).rejects.toMatchObject({ code: 'TEMPLATE_APPLICATION_NOT_ALLOWED' });

    expect(state.applications).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it.each([
    {
      name: 'duplicate template object ids',
      configuration: () => {
        const input = configuration(2);
        input.objects[1].id = input.objects[0].id;
        return input;
      },
    },
    {
      name: 'duplicate field ids',
      configuration: () => {
        const input = configuration();
        input.objects[0].fields[1].id = input.objects[0].fields[0].id;
        return input;
      },
    },
    {
      name: 'duplicate field keys',
      configuration: () => {
        const input = configuration();
        input.objects[0].fields[1].fieldKey =
          input.objects[0].fields[0].fieldKey;
        return input;
      },
    },
  ])('rejects $name before hydration', async ({ configuration: invalid }) => {
    const { service, state } = applicationFixture({
      configuration: invalid(),
    });

    await expect(
      service.apply(platformAdmin, applicationInput(), meta),
    ).rejects.toMatchObject({ code: 'TEMPLATE_APPLICATION_NOT_ALLOWED' });

    expect(state.objects).toEqual([]);
    expect(state.applications).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('preserves not-found error codes for missing templates and tenants', async () => {
    const missingTemplate = applicationFixture({ missingTemplate: true });
    await expect(
      missingTemplate.service.apply(platformAdmin, applicationInput(), meta),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });

    const missingTenant = applicationFixture({ missingTenant: true });
    await expect(
      missingTenant.service.apply(platformAdmin, applicationInput(), meta),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('summarizes server-owned eligibility without treating archived rows as empty', async () => {
    const empty = applicationFixture();
    await expect(
      empty.service.summarizeTarget(platformAdmin, 'tenant-1'),
    ).resolves.toEqual({
      objectCount: 0,
      canApplyTemplate: true,
      blockingReason: null,
      application: null,
    });

    const nonDraft = applicationFixture({ tenantStatus: 'ACTIVE' });
    await expect(
      nonDraft.service.summarizeTarget(platformAdmin, 'tenant-1'),
    ).resolves.toMatchObject({
      objectCount: 0,
      canApplyTemplate: false,
      blockingReason: 'TENANT_NOT_DRAFT',
    });

    const nonEmpty = applicationFixture({ existingObject: true });
    await expect(
      nonEmpty.service.summarizeTarget(platformAdmin, 'tenant-1'),
    ).resolves.toMatchObject({
      objectCount: 1,
      canApplyTemplate: false,
      blockingReason: 'TARGET_NOT_EMPTY',
    });
  });

  it('guards both platform application routes with session and platform authorization', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TemplateApplicationController),
    ).toEqual([SessionAuthGuard, PlatformAdminGuard]);
  });

  it('validates both platform route identifiers as UUIDs', () => {
    expect(routePipes('summarizeTarget')).toEqual([expect.any(ParseUUIDPipe)]);
    expect(routePipes('apply')).toEqual([expect.any(ParseUUIDPipe)]);
  });
});

type MemoryObjectRow = HydratedTenantConfiguration['objects'][number];

interface MemoryState {
  template: {
    id: string;
    code: string;
    name: string;
    archivedAt: Date | null;
    activeVersionId: string | null;
    version: {
      id: string;
      templateId: string;
      versionNo: number;
      configuration: BusinessTemplateConfiguration;
      configurationChecksum: string;
    } | null;
  } | null;
  tenant: TemplateApplicationTarget | null;
  objects: MemoryObjectRow[];
  fields: HydratedTenantConfiguration['fields'];
  views: HydratedTenantConfiguration['views'];
  objectPermissions: HydratedTenantConfiguration['objectPermissions'];
  fieldPermissions: HydratedTenantConfiguration['fieldPermissions'];
  publications: object[];
  recordCounters: object[];
  dashboard: {
    tenantId: string;
    draftVersion: 1;
    draftConfiguration: DashboardDefinitionV2;
    sourceTemplateVersionId: string;
    activePublicationId: null;
  } | null;
  applications: TemplateApplicationResult[];
  audits: AuditEvent[];
}

class MemoryApplicationRepository implements TemplateApplicationRepository {
  readonly transactionEvents: string[] = [];

  constructor(
    readonly state: MemoryState,
    private readonly failAfterObject?: number,
    private readonly applicationAfterLocks?: TemplateApplicationResult,
    private readonly winnerOnCreateConflict?: TemplateApplicationResult,
  ) {}

  async transaction<T>(
    actorId: string,
    work: (store: TemplateApplicationStore) => Promise<T>,
  ): Promise<T> {
    const draft = structuredClone(this.state);
    try {
      const result = await work(
        new MemoryApplicationStore(
          draft,
          actorId,
          this.transactionEvents,
          this.failAfterObject,
          this.applicationAfterLocks,
          Boolean(this.winnerOnCreateConflict),
        ),
      );
      Object.assign(this.state, draft);
      return result;
    } catch (error) {
      if (
        hasErrorCode(error, 'P2002') &&
        this.winnerOnCreateConflict &&
        !this.state.applications.some(
          (application) => application.id === this.winnerOnCreateConflict?.id,
        )
      ) {
        this.state.applications.push(
          structuredClone(this.winnerOnCreateConflict),
        );
      }
      throw error;
    }
  }
}

/* eslint-disable @typescript-eslint/require-await -- in-memory test store mirrors the async production contract */
class MemoryApplicationStore implements TemplateApplicationStore {
  private tenantId: string | null = null;

  constructor(
    private readonly state: MemoryState,
    private readonly actorId: string,
    private readonly events: string[],
    private readonly failAfterObject?: number,
    private readonly applicationAfterLocks?: TemplateApplicationResult,
    private readonly createApplicationConflict = false,
  ) {}

  async findApplication(
    tenantId: string,
    templateVersionId: string,
    templateId?: string,
  ) {
    this.events.push('findApplication');
    return (
      this.state.applications.find(
        (application) =>
          application.tenantId === tenantId &&
          application.templateVersionId === templateVersionId &&
          (templateId === undefined || application.templateId === templateId),
      ) ?? null
    );
  }

  async findLatestApplication(tenantId: string) {
    return (
      [...this.state.applications]
        .filter((application) => application.tenantId === tenantId)
        .sort(
          (left, right) => right.appliedAt.getTime() - left.appliedAt.getTime(),
        )[0] ?? null
    );
  }

  async findTarget(tenantId: string) {
    return this.state.tenant?.id === tenantId ? this.state.tenant : null;
  }

  async lockTemplate() {
    this.events.push('lockTemplate');
  }

  async lockTenant() {
    this.events.push('lockTenant');
    if (
      this.applicationAfterLocks &&
      !this.state.applications.some(
        (application) => application.id === this.applicationAfterLocks?.id,
      )
    ) {
      this.state.applications.push(structuredClone(this.applicationAfterLocks));
    }
  }

  async requireApplicableVersion(
    input: TemplateApplicationInput,
  ): Promise<TemplateApplicationEligibility> {
    this.events.push('requireApplicableVersion');
    if (!this.state.template || this.state.template.id !== input.templateId) {
      return { kind: 'TEMPLATE_NOT_FOUND' };
    }
    if (!this.state.tenant || this.state.tenant.id !== input.tenantId) {
      return { kind: 'TENANT_NOT_FOUND' };
    }
    const template = this.state.template;
    if (
      template.archivedAt ||
      template.activeVersionId !== input.templateVersionId ||
      !template.version ||
      template.version.id !== input.templateVersionId ||
      template.version.templateId !== input.templateId ||
      this.state.tenant.status !== 'DRAFT'
    ) {
      return { kind: 'NOT_ALLOWED' };
    }
    return {
      kind: 'APPLICABLE',
      source: {
        templateId: template.id,
        templateCode: template.code,
        templateName: template.name,
        id: template.version.id,
        versionNo: template.version.versionNo,
        configuration: structuredClone(template.version.configuration),
        configurationChecksum: template.version.configurationChecksum,
      },
      target: structuredClone(this.state.tenant),
    };
  }

  async enterTenant(tenantId: string) {
    this.events.push('enterTenant');
    this.tenantId = tenantId;
  }

  async countTenantObjects(tenantId: string) {
    return this.state.objects.filter((object) => object.tenantId === tenantId)
      .length;
  }

  async assertTenantEmpty(tenantId: string) {
    this.events.push('assertTenantEmpty');
    return (await this.countTenantObjects(tenantId)) === 0;
  }

  async insertTenantConfiguration(hydrated: HydratedTenantConfiguration) {
    this.events.push('insertTenantConfiguration');
    if (this.tenantId !== hydrated.tenantId)
      throw new Error('tenant context missing');
    for (const [index, object] of hydrated.objects.entries()) {
      this.state.objects.push(structuredClone(object));
      this.state.fields.push(
        ...structuredClone(
          hydrated.fields.filter((field) => field.objectId === object.id),
        ),
      );
      this.state.views.push(
        ...structuredClone(
          hydrated.views.filter((view) => view.objectId === object.id),
        ),
      );
      this.state.objectPermissions.push(
        ...structuredClone(
          hydrated.objectPermissions.filter(
            (permission) => permission.objectId === object.id,
          ),
        ),
      );
      this.state.fieldPermissions.push(
        ...structuredClone(
          hydrated.fieldPermissions.filter(
            (permission) => permission.objectId === object.id,
          ),
        ),
      );
      if (this.failAfterObject === index + 1) {
        throw new Error('hydration failed');
      }
    }
    if (hydrated.dashboard) {
      this.state.dashboard = structuredClone(hydrated.dashboard);
    }
  }

  async createApplication(application: CreateTemplateApplication) {
    this.events.push('createApplication');
    if (this.createApplicationConflict) {
      throw Object.assign(new Error('duplicate template application'), {
        code: 'P2002',
      });
    }
    const saved = { ...structuredClone(application), appliedAt };
    this.state.applications.push(saved);
    return saved;
  }

  async appendAudit(event: AuditEvent) {
    this.events.push('appendAudit');
    if (event.actorId !== this.actorId) throw new Error('wrong audit actor');
    this.state.audits.push(structuredClone(event));
  }
}
/* eslint-enable @typescript-eslint/require-await */

interface FixtureOptions {
  configuration?: BusinessTemplateConfiguration;
  failAfterObject?: number;
  tenantStatus?: 'DRAFT' | 'ACTIVE';
  existingObject?: boolean;
  activeVersionId?: string;
  archived?: boolean;
  checksum?: string;
  missingTemplate?: boolean;
  missingTenant?: boolean;
  applicationAfterLocks?: TemplateApplicationResult;
  winnerOnCreateConflict?: TemplateApplicationResult;
}

function applicationFixture(options: FixtureOptions = {}) {
  const sourceConfiguration = options.configuration ?? configuration();
  const state: MemoryState = {
    template: options.missingTemplate
      ? null
      : {
          id: 'template-1',
          code: 'sales',
          name: '销售模板',
          archivedAt: options.archived
            ? new Date('2026-08-25T00:00:00Z')
            : null,
          activeVersionId: options.activeVersionId ?? 'version-1',
          version: {
            id: 'version-1',
            templateId: 'template-1',
            versionNo: 1,
            configuration: sourceConfiguration,
            configurationChecksum:
              options.checksum ??
              checksumTemplateConfiguration(sourceConfiguration),
          },
        },
    tenant: options.missingTenant
      ? null
      : {
          id: 'tenant-1',
          code: 'acme',
          name: 'Acme',
          status: options.tenantStatus ?? 'DRAFT',
        },
    objects: options.existingObject
      ? [
          {
            id: 'archived-object-1',
            tenantId: 'tenant-1',
            code: 'old',
            name: '旧对象',
            description: null,
            icon: null,
            titleFieldKey: 'name',
            sortOrder: 0,
            status: 'ARCHIVED',
            settings: { description: null },
            sourceTemplateVersionId: null,
            activePublicationId: null,
            publishedAt: null,
            version: 1,
          },
        ]
      : [],
    fields: [],
    views: [],
    objectPermissions: [],
    fieldPermissions: [],
    publications: [],
    recordCounters: [],
    dashboard: null,
    applications: [],
    audits: [],
  };
  const ids = Array.from(
    { length: 40 },
    (_value, index) => `fresh-id-${index + 1}`,
  );
  const repository = new MemoryApplicationRepository(
    state,
    options.failAfterObject,
    options.applicationAfterLocks,
    options.winnerOnCreateConflict,
  );
  const service = new TemplateApplicationService(repository, () => {
    const id = ids.shift();
    if (!id) throw new Error('fixture exhausted ids');
    return id;
  });
  return {
    service,
    state,
    transactionEvents: repository.transactionEvents,
  };
}

function existingApplication(): TemplateApplicationResult {
  return {
    id: 'application-concurrent-1',
    templateId: 'template-1',
    templateCode: 'sales',
    templateName: '销售模板',
    templateVersionId: 'version-1',
    templateVersionNo: 1,
    tenantId: 'tenant-1',
    tenantCode: 'acme',
    tenantName: 'Acme',
    appliedByUserId: 'platform-user-1',
    configurationChecksum: checksumTemplateConfiguration(configuration()),
    objects: [
      {
        templateObjectId: 'template-object-1',
        objectId: 'tenant-object-concurrent-1',
        code: 'customers',
        name: '客户',
      },
    ],
    appliedAt,
  };
}

function routePipes(methodName: 'summarizeTarget' | 'apply'): unknown[] {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TemplateApplicationController,
    methodName,
  ) as Record<string, { pipes?: unknown[] }> | undefined;
  return Object.values(metadata ?? {}).flatMap((argument) =>
    argument.pipes ? [...argument.pipes] : [],
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function applicationInput(): TemplateApplicationInput {
  return {
    templateId: 'template-1',
    templateVersionId: 'version-1',
    tenantId: 'tenant-1',
  };
}

function configuration(objectCount = 1): BusinessTemplateConfiguration {
  return {
    schemaVersion: 1,
    objects: Array.from(
      { length: objectCount },
      (_value, index): BusinessTemplateConfiguration['objects'][number] => ({
        id: `template-object-${index + 1}`,
        code: index === 0 ? 'customers' : `customers-${index + 1}`,
        name: index === 0 ? '客户' : `客户 ${index + 1}`,
        description: '客户资料',
        icon: 'contacts',
        titleFieldKey: 'name',
        sortOrder: index,
        status: 'ACTIVE',
        fields: [
          {
            id: `template-field-name-${index + 1}`,
            fieldKey: 'name',
            label: '客户名称',
            type: 'TEXT',
            required: true,
            defaultValue: null,
            validation: { maxLength: 100 },
            config: {},
            sortOrder: 0,
            isSystem: false,
            status: 'ACTIVE',
          },
          {
            id: `template-field-phone-${index + 1}`,
            fieldKey: 'phone',
            label: '联系电话',
            type: 'PHONE',
            required: false,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 1,
            isSystem: false,
            status: 'ACTIVE',
          },
        ],
        defaultView: {
          code: 'default',
          name: '默认列表',
          columnFieldKeys: ['name', 'phone'],
          sort: { field: 'updatedAt', direction: 'desc' },
        },
        employeeAccess: {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: false,
          readScope: 'ALL',
          updateScope: 'OWN',
          fields: { name: 'EDIT', phone: 'READ_ONLY' },
        },
      }),
    ),
  };
}

function configurationWithDashboard(): BusinessTemplateConfiguration {
  return {
    ...configuration(),
    dashboard: dashboardPreset(),
  } as BusinessTemplateConfiguration;
}

function dashboardPreset(): DashboardDefinitionV2 {
  return {
    schemaVersion: 2,
    title: '客户总览',
    widgets: [
      {
        id: 'customer-list',
        type: 'RECORD_LIST',
        title: '最新客户',
        audience: 'ALL',
        objectCode: 'customers',
        width: 'FULL',
        sortOrder: 0,
        filters: [],
        fieldKeys: ['name', 'phone'],
        sort: { field: 'updatedAt', direction: 'DESC' },
        limit: 8,
      },
    ],
  };
}
