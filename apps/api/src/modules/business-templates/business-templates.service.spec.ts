import { ApiException } from '../../common/errors/api.exception';
import type { AuthenticatedUser } from '../../common/tenancy/tenant-context';
import type { BusinessTemplateConfiguration } from './business-template.schema';
import type {
  BusinessTemplateRecord,
  BusinessTemplateRepository,
  BusinessTemplateStore,
  BusinessTemplateVersion,
  CreateBusinessTemplateRecord,
  CreateBusinessTemplateVersion,
  SaveBusinessTemplateRecord,
  TemplatePageQuery,
} from './business-templates.repository';
import { BusinessTemplatesService } from './business-templates.service';

const platformAdmin: AuthenticatedUser = {
  id: 'user-platform-admin',
  phone: '+8613800138000',
  isPlatformAdmin: true,
};
const meta = { requestId: 'req-template', ip: '127.0.0.1' };

describe('BusinessTemplatesService', () => {
  it('saves the whole draft with optimistic locking', async () => {
    const { service } = fixture();
    const created = await service.create(
      platformAdmin,
      { code: 'sales', name: '销售模板', description: null },
      meta,
    );

    const saved = await service.saveDraft(
      platformAdmin,
      created.id,
      {
        expectedVersion: 1,
        name: '销售模板',
        description: '标准销售对象',
        configuration: validTemplateConfiguration(),
      },
      meta,
    );

    expect(saved).toMatchObject({
      draftVersion: 2,
      hasUnpublishedChanges: true,
    });
    expect(saved.configuration.objects).toHaveLength(2);
  });

  it('publishes without consuming the draft version', async () => {
    const { service } = publishedFixture();

    const version = await service.publish(
      platformAdmin,
      'template-1',
      2,
      meta,
    );

    expect(version).toMatchObject({ versionNo: 1, sourceDraftVersion: 2 });
    await expect(
      service.detail(platformAdmin, 'template-1'),
    ).resolves.toMatchObject({
      draftVersion: 2,
      activeVersion: { versionNo: 1, sourceDraftVersion: 2 },
      hasUnpublishedChanges: false,
    });
  });

  it('maps duplicate template codes to validation', async () => {
    const { service } = fixture();
    await service.create(
      platformAdmin,
      { code: 'sales', name: '销售模板', description: null },
      meta,
    );

    await expect(
      service.create(
        platformAdmin,
        { code: 'sales', name: '另一个模板', description: null },
        meta,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: { code: ['模板代码已被使用。'] },
    });
  });

  it('returns TEMPLATE_VERSION_CONFLICT for a stale draft save', async () => {
    const { service } = fixture();
    const created = await service.create(
      platformAdmin,
      { code: 'sales', name: '销售模板', description: null },
      meta,
    );
    await service.saveDraft(
      platformAdmin,
      created.id,
      {
        expectedVersion: 1,
        name: created.name,
        description: null,
        configuration: validTemplateConfiguration(),
      },
      meta,
    );

    await expect(
      service.saveDraft(
        platformAdmin,
        created.id,
        {
          expectedVersion: 1,
          name: created.name,
          description: null,
          configuration: validTemplateConfiguration(),
        },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_VERSION_CONFLICT' });
  });

  it('returns grouped publication blockers', async () => {
    const { service } = publishedFixture((configuration) => {
      configuration.objects[0].titleFieldKey = 'missing';
      configuration.objects[1].fields = [];
    });

    const error = await rejected(
      service.publish(platformAdmin, 'template-1', 2, meta),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({ code: 'TEMPLATE_PUBLICATION_BLOCKED' });
    expect(Object.keys((error as ApiException).fieldErrors)).toEqual(
      expect.arrayContaining([
        'configuration.objects.template-object-lead',
        'configuration.objects.template-object-company',
      ]),
    );
  });

  it('derives published object and field identities in detail', async () => {
    const { service } = publishedFixture();
    await service.publish(platformAdmin, 'template-1', 2, meta);
    const saved = await service.saveDraft(
      platformAdmin,
      'template-1',
      {
        expectedVersion: 2,
        name: '销售模板',
        description: null,
        configuration: validTemplateConfiguration(),
      },
      meta,
    );

    expect(saved.configuration.objects[0]).toMatchObject({
      publishedCode: 'leads',
      fields: [
        {
          publishedFieldKey: 'name',
          publishedType: 'TEXT',
        },
      ],
    });
  });
});

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

function fixture(seed: BusinessTemplateRecord[] = []) {
  const repository = new MemoryBusinessTemplateRepository(seed);
  return {
    repository,
    service: new BusinessTemplatesService(repository),
  };
}

function publishedFixture(
  mutate?: (configuration: BusinessTemplateConfiguration) => void,
) {
  const configuration = validTemplateConfiguration();
  mutate?.(configuration);
  return fixture([
    {
      id: 'template-1',
      code: 'sales',
      name: '销售模板',
      description: null,
      draftVersion: 2,
      configuration,
      activeVersionId: null,
      publishedAt: null,
      archivedAt: null,
      createdByUserId: platformAdmin.id,
      createdAt: new Date('2026-08-26T00:00:00.000Z'),
      updatedAt: new Date('2026-08-26T00:00:00.000Z'),
      activeVersion: null,
      applicationCount: 0,
    },
  ]);
}

class MemoryBusinessTemplateRepository implements BusinessTemplateRepository {
  private sequence = 1;
  private readonly rows = new Map<string, BusinessTemplateRecord>();
  private readonly versions = new Map<string, BusinessTemplateVersion[]>();

  constructor(seed: BusinessTemplateRecord[]) {
    for (const row of seed) this.rows.set(row.id, structuredClone(row));
  }

  withActor<T>(
    _actorId: string,
    work: (store: BusinessTemplateStore) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }

  async listTemplates(query: TemplatePageQuery) {
    const rows = [...this.rows.values()].filter(
      (row) => query.hasActiveVersion === undefined ||
        Boolean(row.activeVersionId) === query.hasActiveVersion,
    );
    return {
      items: structuredClone(
        rows.slice((query.page - 1) * query.limit, query.page * query.limit),
      ),
      total: rows.length,
    };
  }

  async findTemplate(templateId: string) {
    const row = this.rows.get(templateId);
    return row ? structuredClone(row) : null;
  }

  async createTemplate(input: CreateBusinessTemplateRecord) {
    if ([...this.rows.values()].some((row) => row.code === input.code)) {
      throw { code: 'P2002' };
    }
    const now = new Date('2026-08-26T00:00:00.000Z');
    const row: BusinessTemplateRecord = {
      ...input,
      id: `template-${this.sequence++}`,
      draftVersion: 1,
      activeVersionId: null,
      publishedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      activeVersion: null,
      applicationCount: 0,
    };
    this.rows.set(row.id, structuredClone(row));
    return structuredClone(row);
  }

  async saveDraft(
    templateId: string,
    input: SaveBusinessTemplateRecord,
    expectedVersion: number,
  ) {
    const row = this.rows.get(templateId);
    if (!row || row.draftVersion !== expectedVersion) return null;
    const saved = {
      ...row,
      ...input,
      draftVersion: row.draftVersion + 1,
      updatedAt: new Date('2026-08-26T00:01:00.000Z'),
    };
    this.rows.set(templateId, structuredClone(saved));
    return structuredClone(saved);
  }

  async lockTemplate(_templateId: string) {}

  async nextVersionNumber(templateId: string) {
    return (this.versions.get(templateId)?.length ?? 0) + 1;
  }

  async createVersion(input: CreateBusinessTemplateVersion) {
    const version: BusinessTemplateVersion = {
      ...input,
      id: `version-${this.sequence++}`,
      publishedAt: new Date('2026-08-26T00:02:00.000Z'),
    };
    this.versions.set(input.templateId, [
      ...(this.versions.get(input.templateId) ?? []),
      structuredClone(version),
    ]);
    return structuredClone(version);
  }

  async activateVersion(templateId: string, version: BusinessTemplateVersion) {
    const row = this.rows.get(templateId);
    if (!row) return null;
    const activated = {
      ...row,
      activeVersionId: version.id,
      activeVersion: version,
      publishedAt: version.publishedAt,
      updatedAt: version.publishedAt,
    };
    this.rows.set(templateId, structuredClone(activated));
    return structuredClone(activated);
  }

  async listVersions(templateId: string) {
    return structuredClone(this.versions.get(templateId) ?? []);
  }
}

function validTemplateConfiguration(): BusinessTemplateConfiguration {
  return {
    schemaVersion: 1,
    objects: [
      validObject('template-object-lead', 'leads', '销售线索', 10),
      validObject(
        'template-object-company',
        'companies',
        '客户公司',
        20,
      ),
    ],
  };
}

function validObject(id: string, code: string, name: string, sortOrder: number) {
  const fieldId = `${id}-name`;
  return {
    id,
    code,
    name,
    description: null,
    icon: null,
    titleFieldKey: 'name',
    sortOrder,
    status: 'ACTIVE' as const,
    fields: [
      {
        id: fieldId,
        fieldKey: 'name',
        label: name,
        type: 'TEXT' as const,
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 10,
        isSystem: false,
        status: 'ACTIVE' as const,
      },
    ],
    defaultView: {
      code: 'default' as const,
      name: '全部',
      columnFieldKeys: ['name'],
      sort: { field: 'updatedAt' as const, direction: 'desc' as const },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false as const,
      readScope: 'ALL' as const,
      updateScope: 'OWN' as const,
      fields: { name: 'EDIT' as const },
    },
  };
}
