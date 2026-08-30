import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { PublishedObjectService } from '../objects/published-object.service';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type { DashboardConfiguration } from './dashboard.types';
import {
  type DashboardRepository,
  DashboardsService,
} from './dashboards.service';

const configuration = {
  opportunity: {
    objectCode: 'opportunities',
    stageFieldKey: 'stage',
    amountFieldKey: 'amount',
    dateFieldKey: 'close_at',
    activeOptionKeys: ['new'],
    wonOptionKeys: ['won'],
    lostOptionKeys: ['lost'],
  },
} satisfies DashboardConfiguration;

const opportunity = publishedOpportunity();
const period = {
  from: new Date('2026-08-01T00:00:00.000Z'),
  to: new Date('2026-09-01T00:00:00.000Z'),
  timezone: 'Asia/Shanghai',
};

describe('DashboardsService', () => {
  it('returns an honest unconfigured state', async () => {
    const { service, repository } = setup();
    repository.getConfiguration.mockResolvedValue(null);

    await expect(service.getOverview(adminContext(), period)).resolves.toEqual(
      expect.objectContaining({
        state: 'UNCONFIGURED',
        role: 'TENANT_ADMIN',
        metrics: [],
      }),
    );
    expect(repository.aggregateOverview).not.toHaveBeenCalled();
  });

  it('does not let an employee save company metric mappings', async () => {
    const { service } = setup();

    await expect(
      service.saveConfiguration(employeeContext(), {
        expectedVersion: 0,
        configuration,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('forces OWN aggregation to the current employee member', async () => {
    const { service, repository, publishedObjects } = setup();
    publishedObjects.resolveRuntimeSchema.mockResolvedValue({
      schema: opportunity,
      access: {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'OWN',
        updateScope: 'OWN',
        fields: Object.fromEntries(
          opportunity.fields.map((field) => [field.fieldKey, 'EDIT']),
        ),
      },
      visibleSchema: {} as never,
    });

    await service.getOverview(employeeContext(), period);

    expect(repository.aggregateOverview).toHaveBeenCalledWith(
      employeeContext(),
      expect.objectContaining({
        ownerMemberId: 'member-employee',
        includeLeaderboard: false,
      }),
    );
  });

  it('keeps admin aggregation tenant-wide unless an owner is requested', async () => {
    const { service, repository } = setup();

    await service.getOverview(adminContext(), period);

    expect(repository.aggregateOverview).toHaveBeenCalledWith(
      adminContext(),
      expect.objectContaining({
        ownerMemberId: undefined,
        includeLeaderboard: true,
      }),
    );
  });

  it('returns repair issues without running misleading aggregates', async () => {
    const { service, repository } = setup();
    repository.listPublishedObjects.mockResolvedValue([]);

    await expect(service.getOverview(adminContext(), period)).resolves.toEqual(
      expect.objectContaining({
        state: 'NEEDS_REPAIR',
        issues: [
          expect.objectContaining({ code: 'OPPORTUNITY_OBJECT_NOT_FOUND' }),
        ],
      }),
    );
    expect(repository.aggregateOverview).not.toHaveBeenCalled();
  });
});

function setup() {
  const repository = {
    getConfiguration: jest.fn().mockResolvedValue({
      version: 1,
      configuration,
      updatedAt: '2026-08-31T00:00:00.000Z',
    }),
    saveConfiguration: jest.fn(),
    listPublishedObjects: jest.fn().mockResolvedValue([opportunity]),
    aggregateOverview: jest.fn().mockResolvedValue({
      metrics: [],
      pipeline: [],
      trend: [],
      attention: [],
      leaderboard: [],
      records: [],
    }),
  } satisfies jest.Mocked<DashboardRepository>;
  const publishedObjects = {
    resolveRuntimeSchema: jest.fn(),
  } as unknown as jest.Mocked<PublishedObjectService>;
  return {
    repository,
    publishedObjects,
    service: new DashboardsService(repository, publishedObjects),
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
      id: 'publication-1',
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
      field('name', 'TEXT'),
      field('stage', 'SINGLE_SELECT', {
        options: [
          { key: 'new', label: '新商机', color: 'BLUE', status: 'ACTIVE' },
          { key: 'won', label: '已成交', color: 'GREEN', status: 'ACTIVE' },
          { key: 'lost', label: '已失败', color: 'RED', status: 'ACTIVE' },
        ],
      }),
      field('amount', 'MONEY'),
      field('close_at', 'DATE'),
    ],
    defaultView: {
      code: 'default',
      name: '默认列表',
      columnFieldKeys: ['name', 'stage', 'amount'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: {
        name: 'EDIT',
        stage: 'EDIT',
        amount: 'EDIT',
        close_at: 'EDIT',
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
