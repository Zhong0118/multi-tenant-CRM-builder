import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { ObjectAccessPolicy } from './effective-access';
import type { PublishedObjectSchema } from './object-schema';
import type {
  PublishedObjectRecord,
  PublishedObjectRepository,
} from './published-object.repository';
import { PublishedObjectService } from './published-object.service';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-a',
  tenantCode: 'baijie',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
};

const employee: TenantContext = {
  ...admin,
  userId: 'user-employee',
  memberId: 'member-employee',
  role: 'EMPLOYEE',
};

function schema(input: {
  code: string;
  name: string;
  sortOrder: number;
  canRead?: boolean;
  hiddenPhone?: boolean;
}): PublishedObjectSchema {
  return {
    publication: {
      id: `publication-${input.code}`,
      number: 3,
      sourceDraftVersion: 9,
      publishedAt: '2026-08-21T10:00:00.000Z',
    },
    object: {
      id: `object-${input.code}`,
      code: input.code,
      name: input.name,
      description: null,
      titleFieldKey: 'name',
      icon: 'contacts',
      sortOrder: input.sortOrder,
    },
    fields: [
      {
        id: `field-${input.code}-name`,
        fieldKey: 'name',
        label: '姓名',
        type: 'TEXT',
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 10,
        isSystem: false,
      },
      {
        id: `field-${input.code}-phone`,
        fieldKey: 'phone',
        label: '手机号',
        type: 'PHONE',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 20,
        isSystem: false,
      },
    ],
    defaultView: {
      code: 'default',
      name: `全部${input.name}`,
      columnFieldKeys: ['name', 'phone'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: input.canRead ?? true,
      canUpdate: true,
      canDelete: false,
      readScope: input.canRead === false ? 'NONE' : 'OWN',
      updateScope: 'OWN',
      fields: {
        name: 'EDIT',
        phone: input.hiddenPhone ? 'HIDDEN' : 'READ_ONLY',
      },
    },
  };
}

class MemoryPublishedObjectRepository implements PublishedObjectRepository {
  rows: PublishedObjectRecord[] = [];

  list(): Promise<PublishedObjectRecord[]> {
    return Promise.resolve(structuredClone(this.rows));
  }

  findByCode(_context: TenantContext, code: string) {
    return Promise.resolve(
      structuredClone(this.rows.find((row) => row.code === code) ?? null),
    );
  }
}

function row(
  configuration: PublishedObjectSchema | null,
  overrides: Partial<PublishedObjectRecord> = {},
): PublishedObjectRecord {
  return {
    id: configuration?.object.id ?? 'object-unpublished',
    code: configuration?.object.code ?? 'unpublished',
    status: 'ACTIVE',
    sortOrder: configuration?.object.sortOrder ?? 99,
    configuration,
    memberOverride: undefined,
    ...overrides,
  };
}

function fixture() {
  const repository = new MemoryPublishedObjectRepository();
  return {
    repository,
    service: new PublishedObjectService(repository),
  };
}

describe('PublishedObjectService', () => {
  it('omits unpublished and archived objects from navigation', async () => {
    const { service, repository } = fixture();
    repository.rows = [
      row(null, { code: 'draft', status: 'DRAFT' }),
      row(schema({ code: 'archived', name: '归档对象', sortOrder: 20 }), {
        status: 'ARCHIVED',
      }),
      row(schema({ code: 'leads', name: '线索', sortOrder: 10 })),
    ];

    await expect(service.listAccessible(admin)).resolves.toEqual([
      {
        code: 'leads',
        name: '线索',
        icon: 'contacts',
        sortOrder: 10,
        canCreate: true,
        canRead: true,
        canUpdate: true,
      },
    ]);
  });

  it('omits employee objects whose effective permission cannot read', async () => {
    const { service, repository } = fixture();
    repository.rows = [
      row(
        schema({ code: 'leads', name: '线索', sortOrder: 10, canRead: false }),
      ),
    ];

    await expect(service.listAccessible(employee)).resolves.toEqual([]);
  });

  it('shows every active published object to admins in configured order', async () => {
    const { service, repository } = fixture();
    repository.rows = [
      row(
        schema({
          code: 'customers',
          name: '客户',
          sortOrder: 20,
          canRead: false,
        }),
      ),
      row(
        schema({ code: 'leads', name: '线索', sortOrder: 10, canRead: false }),
      ),
    ];

    const navigation = await service.listAccessible(admin);
    expect(navigation.map((item) => item.code)).toEqual(['leads', 'customers']);
  });

  it('applies a changed live member override without republishing', async () => {
    const { service, repository } = fixture();
    const published = row(
      schema({ code: 'leads', name: '线索', sortOrder: 10 }),
    );
    repository.rows = [published];

    const inherited = await service.resolveRuntimeSchema(employee, 'leads');
    expect(inherited.access).toMatchObject({
      readScope: 'OWN',
      updateScope: 'OWN',
    });

    published.memberOverride = {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'NONE',
    } satisfies ObjectAccessPolicy;
    const overridden = await service.resolveRuntimeSchema(employee, 'leads');
    expect(overridden.access).toMatchObject({
      canCreate: false,
      canUpdate: false,
      readScope: 'ALL',
      updateScope: 'NONE',
    });
  });

  it('removes hidden fields and stale default-view columns from Web schema', async () => {
    const { service, repository } = fixture();
    repository.rows = [
      row(
        schema({
          code: 'leads',
          name: '线索',
          sortOrder: 10,
          hiddenPhone: true,
        }),
      ),
    ];

    const resolved = await service.resolveRuntimeSchema(employee, 'leads');
    expect(resolved.schema.fields.map((field) => field.fieldKey)).toEqual([
      'name',
      'phone',
    ]);
    expect(
      resolved.visibleSchema.fields.map((field) => field.fieldKey),
    ).toEqual(['name']);
    expect(resolved.visibleSchema.defaultView.columnFieldKeys).toEqual([
      'name',
    ]);
    expect(resolved.visibleSchema).not.toHaveProperty(
      'publication.sourceDraftVersion',
    );
    expect(resolved.visibleSchema).not.toHaveProperty('memberOverride');
  });

  it('maps missing, cross-tenant, unpublished, and archived codes to OBJECT_NOT_FOUND', async () => {
    const { service, repository } = fixture();
    repository.rows = [
      row(null, { code: 'draft', status: 'DRAFT' }),
      row(schema({ code: 'archived', name: '归档对象', sortOrder: 20 }), {
        status: 'ARCHIVED',
      }),
    ];

    for (const code of ['missing', 'draft', 'archived']) {
      await expect(
        service.resolveRuntimeSchema(employee, code),
      ).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    }
  });

  it('rejects malformed persisted snapshots as INTERNAL_ERROR', async () => {
    const { service, repository } = fixture();
    repository.rows = [
      row(null, {
        id: 'object-corrupt',
        code: 'corrupt',
        status: 'ACTIVE',
        configuration: {
          fields: [{ fieldKey: 'secret', value: 'do-not-log' }],
        },
      }),
    ];

    await expect(
      service.resolveRuntimeSchema(admin, 'corrupt'),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
