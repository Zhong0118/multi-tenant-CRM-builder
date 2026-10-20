import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { CreateObjectDefinitionDto } from './dto/object.dto';
import type { ActionPublicationTarget } from '../actions/action-publication.policy';
import type { WorkflowDraft } from '../workflows/workflow.types';
import type { PublishedObjectSchema } from './object-schema';
import type {
  ObjectDraft,
  ObjectPublicationSummary,
  ObjectsRepository,
  ObjectsStore,
} from './objects.repository';
import { ObjectsService } from './objects.service';
import type { LifecycleBlocker } from './object-lifecycle.policy';
import { toObjectDraftResponse } from './object-draft.presenter';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-1',
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

const meta = { requestId: 'req-1', ip: '127.0.0.1' };

class MemoryObjectsStore implements ObjectsStore {
  objects: ObjectDraft[] = [];
  publications = new Map<string, ObjectPublicationSummary[]>();
  audits: Array<{ action: string; after?: Record<string, unknown> }> = [];
  onLock?: (objectId: string) => void;
  lifecycleBlockers: LifecycleBlocker[] = [];
  expiredCount = 0;

  lockLifecycleConfiguration(): Promise<void> {
    return Promise.resolve();
  }
  findLifecycleBlockers(): Promise<typeof this.lifecycleBlockers> {
    return Promise.resolve(this.lifecycleBlockers);
  }
  countExpiredRecords(): Promise<number> {
    return Promise.resolve(this.expiredCount);
  }
  async changeLifecycle(
    draft: ObjectDraft,
    expectedVersion: number,
    now: Date,
  ): Promise<ObjectDraft | null> {
    const changed = structuredClone(draft);
    changed.object.archivedAt =
      changed.object.status === 'ARCHIVED' ? now.toISOString() : null;
    Object.assign(changed.object, {
      lifecycleVersionOffset:
        ((changed.object as { lifecycleVersionOffset?: number })
          .lifecycleVersionOffset ?? 0) + 1,
    });
    return this.saveObject(changed, expectedVersion);
  }

  workflow: WorkflowDraft | null = null;
  actionTargets = new Map<string, ActionPublicationTarget>();
  actionTargetLookups: string[][] = [];

  lockObject(objectId: string): Promise<void> {
    this.onLock?.(objectId);
    return Promise.resolve();
  }

  listObjects(): Promise<ObjectDraft[]> {
    return Promise.resolve(
      [...this.objects].sort(
        (left, right) =>
          left.object.sortOrder - right.object.sortOrder ||
          left.object.code.localeCompare(right.object.code),
      ),
    );
  }

  findObject(objectId: string): Promise<ObjectDraft | null> {
    const draft = this.objects.find((item) => item.object.id === objectId);
    if (!draft) return Promise.resolve(null);
    const historical = (this.publications.get(objectId) ?? []).flatMap(
      (item) => item.configuration.fields,
    );
    return Promise.resolve({
      ...structuredClone(draft),
      fields: draft.fields.map((field) => ({
        ...structuredClone(field),
        publishedType:
          historical.find((item) => item.id === field.id)?.type ?? null,
      })),
    });
  }

  createObject(draft: ObjectDraft): Promise<ObjectDraft> {
    if (this.objects.some((item) => item.object.code === draft.object.code)) {
      return Promise.reject(
        Object.assign(new Error('duplicate'), { code: 'P2002' }),
      );
    }
    // Match the repository: createObject inserts only object metadata.
    const created = {
      ...structuredClone(draft),
      fields: [],
      defaultView: null,
      employeeAccess: null,
    };
    this.objects.push(created);
    return Promise.resolve(structuredClone(created));
  }

  deleteObject(objectId: string, expectedVersion: number): Promise<boolean> {
    const index = this.objects.findIndex((item) => item.object.id === objectId);
    if (index < 0) return Promise.resolve(false);
    if (this.objects[index].object.version !== expectedVersion) {
      return Promise.resolve(false);
    }
    this.objects.splice(index, 1);
    this.publications.delete(objectId);
    return Promise.resolve(true);
  }

  saveObject(
    draft: ObjectDraft,
    expectedVersion: number,
    options: { bumpVersion?: boolean } = {},
  ): Promise<ObjectDraft | null> {
    const index = this.objects.findIndex(
      (item) => item.object.id === draft.object.id,
    );
    if (index < 0 || this.objects[index].object.version !== expectedVersion) {
      return Promise.resolve(null);
    }
    const saved = structuredClone(draft);
    saved.object.version =
      options.bumpVersion === false ? expectedVersion : expectedVersion + 1;
    this.objects[index] = saved;
    return Promise.resolve(structuredClone(saved));
  }

  countActiveRecords(objectId: string): Promise<number> {
    return Promise.resolve(
      this.objects.find((item) => item.object.id === objectId)
        ?.activeRecordCount ?? 0,
    );
  }

  countRecordsByWorkflowState(): Promise<Record<string, number>> {
    return Promise.resolve({});
  }

  findWorkflowDraft(): Promise<WorkflowDraft | null> {
    return Promise.resolve(this.workflow);
  }

  findActionTargetObjects(
    codes: readonly string[],
  ): Promise<Map<string, ActionPublicationTarget>> {
    this.actionTargetLookups.push([...codes]);
    return Promise.resolve(
      new Map(
        [...this.actionTargets]
          .filter(([code]) => codes.includes(code))
          .map(([code, target]) => [code, structuredClone(target)]),
      ),
    );
  }
  nextPublicationNumber(objectId: string): Promise<number> {
    const publications = this.publications.get(objectId) ?? [];
    return Promise.resolve(
      publications.reduce(
        (maximum, publication) => Math.max(maximum, publication.number),
        0,
      ) + 1,
    );
  }

  createPublication(input: {
    objectId: string;
    schema: PublishedObjectSchema;
    changes: ObjectPublicationSummary['changes'];
    publishedByMemberId: string;
  }): Promise<ObjectPublicationSummary> {
    const publication: ObjectPublicationSummary = {
      ...input.schema.publication,
      changes: structuredClone(input.changes),
      configuration: structuredClone(input.schema),
    };
    const current = this.publications.get(input.objectId) ?? [];
    current.push(publication);
    this.publications.set(input.objectId, current);
    return Promise.resolve(structuredClone(publication));
  }

  listPublications(objectId: string): Promise<ObjectPublicationSummary[]> {
    return Promise.resolve(
      structuredClone(this.publications.get(objectId) ?? []).reverse(),
    );
  }

  appendAudit(event: {
    action: string;
    after?: Record<string, unknown>;
  }): Promise<void> {
    this.audits.push(structuredClone(event));
    return Promise.resolve();
  }
}

class MemoryObjectsRepository implements ObjectsRepository {
  transactions = 0;
  constructor(readonly store: MemoryObjectsStore) {}

  withTenant<T>(
    _context: TenantContext,
    work: (store: ObjectsStore) => Promise<T>,
  ): Promise<T> {
    this.transactions += 1;
    return work(this.store);
  }
}

function fixture() {
  const store = new MemoryObjectsStore();
  const repository = new MemoryObjectsRepository(store);
  let id = 0;
  const clock = jest.fn(() => new Date('2026-08-21T10:00:00.000Z'));
  const service = new ObjectsService(
    repository,
    clock,
    () => `generated-${++id}`,
  );
  return { service, store, repository, clock };
}

async function createObject(service: ObjectsService) {
  return service.create(admin, { name: '销售线索', code: '  Leads  ' }, meta);
}

async function createPublishableDraft(service: ObjectsService) {
  let draft = await createObject(service);
  draft = await service.createField(
    admin,
    draft.object.id,
    {
      expectedVersion: draft.object.version,
      fieldKey: 'name',
      label: '姓名',
      type: 'TEXT',
      required: true,
      defaultValue: null,
      validation: { maxLength: 100 },
      config: {},
      isSystem: false,
    },
    meta,
  );
  draft = await service.updateDefaultView(
    admin,
    draft.object.id,
    {
      expectedVersion: draft.object.version,
      name: '全部线索',
      columnFieldKeys: ['name'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    meta,
  );
  return service.updatePermissions(
    admin,
    draft.object.id,
    {
      expectedVersion: draft.object.version,
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'OWN',
      fields: { name: 'EDIT' },
    },
    meta,
  );
}

describe('ObjectsService', () => {
  describe('create with initial fields', () => {
    it('accepts fields transformed by the request DTO, including empty validation objects', async () => {
      const { service } = fixture();
      const dto = plainToInstance(CreateObjectDefinitionDto, {
        name: '客户',
        code: 'customers',
        titleFieldKey: 'col_1',
        initialFields: [
          'TEXT',
          'TEXT',
          'DATE',
          'NUMBER',
          'SINGLE_SELECT',
          'MULTI_SELECT',
        ].map((type, index) => ({
          fieldKey: `col_${index + 1}`,
          label: `列${index + 1}`,
          type,
          required: index === 0,
          validation: {},
          config: type.endsWith('SELECT')
            ? { options: [{ key: 'active', label: '有效' }] }
            : {},
        })),
      });
      expect(
        await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
      ).toEqual([]);
      const draft = await service.create(admin, dto, meta);
      expect(draft.fields).toHaveLength(6);
      expect(draft.fields.map((field) => field.validation)).toEqual([
        {},
        {},
        {},
        {},
        {},
        {},
      ]);
      expect(draft.fields[4].config).toEqual({
        options: [{ key: 'active', label: '有效' }],
      });
    });

    const nameField = {
      fieldKey: 'col_1',
      label: '客户名称',
      type: 'TEXT' as const,
      required: true,
    };
    const input = {
      name: '客户',
      code: 'customers',
      titleFieldKey: 'col_1',
      initialFields: [
        nameField,
        {
          fieldKey: 'col_2',
          label: '金额',
          type: 'NUMBER' as const,
          required: false,
          validation: { min: 0 },
        },
      ],
    };

    it('persists a complete version-one draft without publishing and denies employee access', async () => {
      const { service, store, repository } = fixture();
      const draft = await service.create(admin, input, meta);
      expect(draft.object).toMatchObject({
        titleFieldKey: 'col_1',
        version: 1,
        status: 'DRAFT',
        activePublicationId: null,
        publishedAt: null,
      });
      expect(draft.fields).toMatchObject([
        {
          ...nameField,
          defaultValue: null,
          validation: {},
          config: {},
          isSystem: false,
          sortOrder: 10,
          status: 'ACTIVE',
        },
        {
          fieldKey: 'col_2',
          type: 'NUMBER',
          validation: { min: 0 },
          isSystem: false,
          sortOrder: 20,
        },
      ]);
      expect(draft.defaultView).toMatchObject({
        columnFieldKeys: ['col_1', 'col_2'],
      });
      expect(draft.employeeAccess).toEqual({
        canCreate: false,
        canRead: false,
        canUpdate: false,
        canDelete: false,
        readScope: 'NONE',
        updateScope: 'NONE',
        fields: { col_1: 'HIDDEN', col_2: 'HIDDEN' },
      });
      expect(store.objects[0]).toEqual(draft);
      expect(draft.activeRecordCount).toBe(0);
      expect(store.publications.size).toBe(0);
      expect(store.audits.map((event) => event.action)).toEqual([
        'object.created',
      ]);
      expect(repository.transactions).toBe(1);
    });

    it.each([
      ['missing title', { titleFieldKey: undefined }],
      ['unknown title', { titleFieldKey: 'missing' }],
      ['unsupported title type', { titleFieldKey: 'col_2' }],
      [
        'optional title',
        { initialFields: [{ ...nameField, required: false }] },
      ],
      [
        'duplicate normalized keys',
        { initialFields: [nameField, { ...nameField, fieldKey: ' COL_1 ' }] },
      ],
      ['empty label', { initialFields: [{ ...nameField, label: '  ' }] }],
      ['empty fields', { initialFields: [] }],
      [
        'too many fields',
        {
          initialFields: Array.from({ length: 41 }, (_, index) => ({
            ...nameField,
            fieldKey: `col_${index + 1}`,
          })),
        },
      ],
      [
        'incompatible validation',
        { initialFields: [{ ...nameField, validation: { min: 1 } }] },
      ],
      [
        'invalid validation range',
        {
          initialFields: [
            { ...nameField, validation: { minLength: 10, maxLength: 2 } },
          ],
        },
      ],
      [
        'invalid config',
        {
          initialFields: [
            { ...nameField, config: { options: [{ key: 'x' }] } },
          ],
        },
      ],
      [
        'member field',
        {
          initialFields: [
            nameField,
            { ...nameField, fieldKey: 'col_2', type: 'MEMBER' as const },
          ],
        },
      ],
      [
        'too many options',
        {
          initialFields: [
            {
              ...nameField,
              type: 'SINGLE_SELECT' as const,
              config: {
                options: Array.from({ length: 101 }, (_, index) => ({
                  key: `option_${index}`,
                  label: `选项${index}`,
                })),
              },
            },
          ],
        },
      ],
    ])('rejects %s before creating anything', async (_reason, changes) => {
      const { service, store } = fixture();
      await expect(
        service.create(admin, { ...input, ...changes }, meta),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(store.objects).toEqual([]);
      expect(store.audits).toEqual([]);
    });

    it('rejects employees with initial fields before entering the transaction', async () => {
      const { service, repository } = fixture();
      await expect(service.create(employee, input, meta)).rejects.toMatchObject(
        { code: 'OBJECT_ACTION_FORBIDDEN' },
      );
      expect(repository.transactions).toBe(0);
    });

    it('accepts forty fields, repeated labels and one hundred valid select options', async () => {
      const { service } = fixture();
      const fields = Array.from({ length: 39 }, (_, index) => ({
        ...nameField,
        fieldKey: `col_${index + 1}`,
      }));
      const draft = await service.create(
        admin,
        {
          ...input,
          initialFields: [
            ...fields,
            {
              fieldKey: 'col_40',
              label: '状态',
              type: 'SINGLE_SELECT',
              required: false,
              config: {
                options: Array.from({ length: 100 }, (_, index) => ({
                  key: `option_${index}`,
                  label: `选项${index}`,
                })),
              },
            },
          ],
        },
        meta,
      );
      expect(draft.fields).toHaveLength(40);
      expect(draft.fields[39].config.options).toHaveLength(100);
    });

    it('preserves the empty manual creation flow', async () => {
      const { service } = fixture();
      const draft = await createObject(service);
      expect(draft.fields).toEqual([]);
      expect(draft.defaultView).toBeNull();
      expect(draft.employeeAccess).toBeNull();
      expect(draft.object.titleFieldKey).toBe('name');
    });
  });

  it('rejects employee configuration before opening a tenant transaction', async () => {
    const { service, repository } = fixture();

    await expect(
      service.create(employee, { name: '线索', code: 'leads' }, meta),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
    expect(repository.transactions).toBe(0);
  });

  it('normalizes lowercase object codes and rejects duplicates', async () => {
    const { service } = fixture();

    await expect(createObject(service)).resolves.toMatchObject({
      object: { code: 'leads', status: 'DRAFT', version: 1 },
    });
    await expect(
      service.create(admin, { name: '另一组线索', code: 'LEADS' }, meta),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: { code: ['对象代码已被使用。'] },
    });
  });

  it('uses optimistic versions and locks code after first publication', async () => {
    const { service } = fixture();
    let draft = await createPublishableDraft(service);

    await expect(
      service.update(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version - 1, name: '过期修改' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });

    await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    draft = await service.detail(admin, draft.object.id);
    await expect(
      service.update(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version, code: 'prospects' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('locks a published field type and inactivates fields without deleting them', async () => {
    const { service } = fixture();
    let draft = await createPublishableDraft(service);
    await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    draft = await service.detail(admin, draft.object.id);
    const titleField = draft.fields[0];

    await expect(
      service.updateField(
        admin,
        draft.object.id,
        titleField.id,
        { expectedVersion: draft.object.version, type: 'EMAIL' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      service.updateField(
        admin,
        draft.object.id,
        titleField.id,
        { expectedVersion: draft.object.version, status: 'INACTIVE' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('retires fields atomically with list/search cleanup and restores their original permission', async () => {
    const { service } = fixture();
    let draft = await createPublishableDraft(service);
    draft = await service.createField(
      admin,
      draft.object.id,
      {
        expectedVersion: draft.object.version,
        fieldKey: 'note',
        label: '备注',
        type: 'TEXT',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        isSystem: false,
      },
      meta,
    );
    draft = await service.updatePermissions(
      admin,
      draft.object.id,
      {
        ...draft.employeeAccess!,
        expectedVersion: draft.object.version,
        fields: { name: 'EDIT', note: 'READ_ONLY' },
      },
      meta,
    );
    draft = await service.updateDefaultView(
      admin,
      draft.object.id,
      {
        expectedVersion: draft.object.version,
        name: '列表',
        columnFieldKeys: ['name', 'note'],
        searchFieldKeys: ['name', 'note'],
        sort: { field: 'updatedAt', direction: 'desc' },
      },
      meta,
    );
    await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    const note = draft.fields.find((field) => field.fieldKey === 'note')!;
    draft = await service.updateField(
      admin,
      draft.object.id,
      note.id,
      { expectedVersion: draft.object.version, status: 'INACTIVE' },
      meta,
    );
    expect(draft.defaultView).toMatchObject({
      columnFieldKeys: ['name'],
      searchFieldKeys: ['name'],
    });
    expect(
      draft.activeSchema!.fields.some((field) => field.id === note.id),
    ).toBe(true);
    await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    draft = await service.detail(admin, draft.object.id);
    expect(
      draft.activeSchema!.fields.some((field) => field.id === note.id),
    ).toBe(false);
    expect(draft.fields.find((field) => field.id === note.id)?.status).toBe(
      'INACTIVE',
    );
    for (const patch of [
      { type: 'NUMBER' as const },
      { fieldKey: 'renamed_note' },
    ]) {
      await expect(
        service.updateField(
          admin,
          draft.object.id,
          note.id,
          { expectedVersion: draft.object.version, ...patch },
          meta,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    draft = await service.updateField(
      admin,
      draft.object.id,
      note.id,
      { expectedVersion: draft.object.version, status: 'ACTIVE' },
      meta,
    );
    expect(draft.employeeAccess!.fields.note).toBe('READ_ONLY');
    expect(draft.defaultView!.columnFieldKeys).toEqual(['name']);
    await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    expect(
      (await service.detail(admin, draft.object.id)).activeSchema!.fields.some(
        (field) => field.id === note.id,
      ),
    ).toBe(true);
  });

  it('persists deterministic object and field order', async () => {
    const { service } = fixture();
    let first = await createObject(service);
    const second = await service.create(
      admin,
      { name: '客户', code: 'customers' },
      meta,
    );
    first = await service.createField(
      admin,
      first.object.id,
      {
        expectedVersion: first.object.version,
        fieldKey: 'name',
        label: '姓名',
        type: 'TEXT',
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        isSystem: false,
      },
      meta,
    );
    first = await service.createField(
      admin,
      first.object.id,
      {
        expectedVersion: first.object.version,
        fieldKey: 'phone',
        label: '电话',
        type: 'PHONE',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        isSystem: false,
      },
      meta,
    );

    await service.reorderObjects(
      admin,
      {
        items: [
          {
            objectId: second.object.id,
            expectedVersion: second.object.version,
          },
          { objectId: first.object.id, expectedVersion: first.object.version },
        ],
      },
      meta,
    );
    first = await service.detail(admin, first.object.id);
    await service.reorderFields(
      admin,
      first.object.id,
      {
        expectedVersion: first.object.version,
        fieldIds: [first.fields[1].id, first.fields[0].id],
      },
      meta,
    );

    const orderedObjects = await service.list(admin);
    expect(
      orderedObjects.map((draft) => ({
        code: draft.object.code,
        sortOrder: draft.object.sortOrder,
      })),
    ).toEqual([
      { code: 'customers', sortOrder: 10 },
      { code: 'leads', sortOrder: 20 },
    ]);
    const reordered = await service.detail(admin, first.object.id);
    expect(
      reordered.fields.map((field) => ({
        fieldKey: field.fieldKey,
        sortOrder: field.sortOrder,
      })),
    ).toEqual([
      { fieldKey: 'phone', sortOrder: 10 },
      { fieldKey: 'name', sortOrder: 20 },
    ]);
  });

  it('stores explicit extra search fields on the default view', async () => {
    const { service } = fixture();
    let draft = await createPublishableDraft(service);
    draft = await service.createField(
      admin,
      draft.object.id,
      {
        expectedVersion: draft.object.version,
        fieldKey: 'phone',
        label: '手机号',
        type: 'PHONE',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        isSystem: false,
      },
      meta,
    );

    draft = await service.updateDefaultView(
      admin,
      draft.object.id,
      {
        expectedVersion: draft.object.version,
        name: '全部线索',
        columnFieldKeys: ['name'],
        searchFieldKeys: ['phone'],
        sort: { field: 'updatedAt', direction: 'desc' },
      },
      meta,
    );

    expect(draft.defaultView).toMatchObject({
      columnFieldKeys: ['name'],
      searchFieldKeys: ['phone'],
    });
  });

  it('rejects a non-text search field before publishing', async () => {
    const { service } = fixture();
    let draft = await createPublishableDraft(service);
    draft = await service.createField(
      admin,
      draft.object.id,
      {
        expectedVersion: draft.object.version,
        fieldKey: 'amount',
        label: '金额',
        type: 'MONEY',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        isSystem: false,
      },
      meta,
    );

    await expect(
      service.updateDefaultView(
        admin,
        draft.object.id,
        {
          expectedVersion: draft.object.version,
          name: '全部线索',
          columnFieldKeys: ['name'],
          searchFieldKeys: ['amount'],
          sort: { field: 'updatedAt', direction: 'desc' },
        },
        meta,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: {
        searchFieldKeys: ['搜索字段仅支持文本、长文本、电话和邮箱。'],
      },
    });
  });

  it('returns publication blockers without changing the active schema', async () => {
    const { service } = fixture();
    const draft = await createObject(service);

    const analysis = await service.analyzePublication(admin, draft.object.id, {
      expectedVersion: draft.object.version,
    });
    expect(analysis.blocking.map((issue) => issue.code)).toEqual([
      'TITLE_FIELD_REQUIRED',
      'DEFAULT_VIEW_REQUIRED',
      'EMPLOYEE_ACCESS_REQUIRED',
    ]);
    await expect(service.detail(admin, draft.object.id)).resolves.toMatchObject(
      {
        activeSchema: null,
        object: { status: 'DRAFT' },
      },
    );
  });

  it('publishes serial immutable snapshots and advances the active pointer', async () => {
    const { service, store } = fixture();
    let draft = await createPublishableDraft(service);

    const first = await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    expect(first).toMatchObject({ number: 1, sourceDraftVersion: 4 });
    draft = await service.detail(admin, draft.object.id);
    expect(draft).toMatchObject({
      object: { status: 'ACTIVE', activePublicationId: first.id },
      activeSchema: { publication: { id: first.id, number: 1 } },
    });
    // Publishing records bookkeeping, not a configuration change, so the draft
    // version the administrator holds stays valid and the freshly published
    // draft does not report itself as changed.
    expect(draft.object.version).toBe(4);

    draft = await service.update(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version, description: '第二版说明' },
      meta,
    );
    const second = await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );

    expect(second).toMatchObject({ number: 2, sourceDraftVersion: 5 });
    await expect(
      service.listPublications(admin, draft.object.id),
    ).resolves.toEqual([
      expect.objectContaining({ id: second.id, number: 2 }),
      expect.objectContaining({ id: first.id, number: 1 }),
    ]);
    expect(store.audits.map((event) => event.action)).toEqual(
      expect.arrayContaining(['object.created', 'object.published']),
    );
  });

  it('locks and reloads the draft before publication analysis', async () => {
    const { service, store } = fixture();
    const draft = await createPublishableDraft(service);
    store.onLock = (objectId) => {
      const concurrent = store.objects.find(
        (item) => item.object.id === objectId,
      )!;
      concurrent.object.version += 1;
      concurrent.object.name = '并发修改后的名称';
    };

    await expect(
      service.publish(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(store.publications.get(draft.object.id)).toBeUndefined();
  });

  it('rejects granting an employee action whose scope denies all access', async () => {
    const { service } = fixture();
    const draft = await createPublishableDraft(service);

    await expect(
      service.updatePermissions(
        admin,
        draft.object.id,
        {
          expectedVersion: draft.object.version,
          canCreate: false,
          canRead: true,
          canUpdate: false,
          canDelete: false,
          readScope: 'NONE',
          updateScope: 'NONE',
          fields: { name: 'EDIT' },
        },
        meta,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
      fieldErrors: { readScope: expect.any(Array) },
    });
  });

  it('deletes a draft that was never published', async () => {
    const { service, store } = fixture();
    const draft = await createObject(service);

    await expect(
      service.removeDraft(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).resolves.toEqual({ deleted: true });

    expect(store.objects).toHaveLength(0);
    await expect(service.detail(admin, draft.object.id)).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
  });

  it('refuses to delete an object that once published', async () => {
    const { service } = fixture();
    let draft = await createPublishableDraft(service);
    await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    draft = await service.detail(admin, draft.object.id);

    await expect(
      service.removeDraft(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_ALREADY_PUBLISHED', status: 409 });
  });

  it('blocks invalid publication and archives an active object', async () => {
    const { service } = fixture();
    const invalid = await createObject(service);
    await expect(
      service.publish(
        admin,
        invalid.object.id,
        { expectedVersion: invalid.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'PUBLICATION_BLOCKED', status: 422 });

    const { service: activeService } = fixture();
    let draft = await createPublishableDraft(activeService);
    await activeService.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    draft = await activeService.detail(admin, draft.object.id);
    await expect(
      activeService.archive(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).resolves.toMatchObject({ object: { status: 'ARCHIVED' } });
  });
});

/**
 * Task 8 — both publication flows must resolve the same Target Object context
 * before the pure analysis runs (§25, §26), inside the tenant transaction.
 */
function enabledWorkflow(
  actions: WorkflowDraft['transitions'][number]['actions'],
): WorkflowDraft {
  return {
    isEnabled: true,
    initialStateKey: 'new',
    states: [
      { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
      { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
    ],
    transitions: [
      {
        key: 'mark-won',
        label: '标记赢单',
        fromStateKey: 'new',
        toStateKey: 'won',
        allowedRoles: ['TENANT_ADMIN'],
        requiredFieldKeys: [],
        sortOrder: 10,
        actions,
      },
    ],
  };
}

function createContactAction(
  targetObjectCode: string,
): NonNullable<WorkflowDraft['transitions'][number]['actions']>[number] {
  return {
    key: 'create-contact',
    type: 'CREATE_RECORD',
    targetObjectCode,
    values: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
  };
}

function publishedContactTarget(): ActionPublicationTarget {
  return {
    code: 'contacts',
    status: 'ACTIVE',
    schema: {
      fields: [
        {
          fieldKey: 'name',
          type: 'TEXT',
          required: true,
          defaultValue: '未命名',
          config: {},
          isSystem: false,
        },
      ],
      employeeAccess: {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'ALL',
        updateScope: 'ALL',
        fields: { name: 'EDIT' },
      },
    },
  };
}

describe('ObjectsService workflow action publication', () => {
  it('loads the Target Object context before analyzing publication', async () => {
    const { service, store } = fixture();
    const draft = await createPublishableDraft(service);
    store.workflow = enabledWorkflow([createContactAction('contacts')]);

    const analysis = await service.analyzePublication(admin, draft.object.id, {
      expectedVersion: draft.object.version,
    });

    expect(store.actionTargetLookups).toEqual([['contacts']]);
    expect(analysis.blocking).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
      }),
    ]);
  });

  it('refuses to publish a workflow whose target object is missing', async () => {
    const { service, store } = fixture();
    const draft = await createPublishableDraft(service);
    store.workflow = enabledWorkflow([createContactAction('contacts')]);

    await expect(
      service.publish(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'PUBLICATION_BLOCKED', status: 422 });

    // The same context is loaded by the publish flow, and nothing was written.
    expect(store.actionTargetLookups).toEqual([['contacts']]);
    expect(store.publications.get(draft.object.id)).toBeUndefined();
    expect(store.objects[0].object).toMatchObject({
      status: 'DRAFT',
      activePublicationId: null,
    });
  });

  it('publishes an action whose current target publication is compatible', async () => {
    const { service, store } = fixture();
    const draft = await createPublishableDraft(service);
    store.workflow = enabledWorkflow([createContactAction('contacts')]);
    store.actionTargets.set('contacts', publishedContactTarget());

    await expect(
      service.publish(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).resolves.toMatchObject({ number: 1 });
    expect(store.publications.get(draft.object.id)).toHaveLength(1);
  });

  it('resolves no target schema when the workflow has no actions', async () => {
    const { service, store } = fixture();
    const draft = await createPublishableDraft(service);
    store.workflow = enabledWorkflow([]);

    await expect(
      service.publish(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).resolves.toMatchObject({ number: 1 });
    expect(store.actionTargetLookups).toEqual([[]]);
  });
});

describe('whole table lifecycle', () => {
  async function published(dirty = false) {
    const result = fixture();
    let draft = await createPublishableDraft(result.service);
    await result.service.publish(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    draft = await result.service.detail(admin, draft.object.id);
    if (dirty)
      draft = await result.service.update(
        admin,
        draft.object.id,
        {
          expectedVersion: draft.object.version,
          description: 'unpublished description',
        },
        meta,
      );
    return { ...result, draft };
  }

  it.each([false, true])(
    'restores the original publication and retains dirty state %s',
    async (dirty) => {
      const { service, store, draft } = await published(dirty);
      const before = structuredClone(draft);
      const archived = await service.archive(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      );
      expect(archived.object).toMatchObject({
        status: 'ARCHIVED',
        archivedAt: '2026-08-21T10:00:00.000Z',
      });
      const restored = await service.restore(
        admin,
        draft.object.id,
        { expectedVersion: archived.object.version },
        meta,
      );
      expect(restored.object).toMatchObject({
        status: 'ACTIVE',
        archivedAt: null,
        version: before.object.version + 2,
      });
      expect(restored.activeSchema).toEqual(before.activeSchema);
      expect(restored.fields).toEqual(before.fields);
      expect(restored.employeeAccess).toEqual(before.employeeAccess);
      expect(toObjectDraftResponse(restored).object.hasUnpublishedChanges).toBe(
        dirty,
      );
      expect(store.publications.get(draft.object.id)).toHaveLength(1);
      expect(store.audits.slice(-2).map((event) => event.action)).toEqual([
        'object.archived',
        'object.restored',
      ]);
    },
  );

  it('rejects stale and repeated lifecycle changes', async () => {
    const { service, draft } = await published();
    const archived = await service.archive(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    await expect(
      service.archive(
        admin,
        draft.object.id,
        { expectedVersion: archived.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_ARCHIVED', status: 409 });
    await expect(
      service.restore(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT', status: 409 });
    const restored = await service.restore(
      admin,
      draft.object.id,
      { expectedVersion: archived.object.version },
      meta,
    );
    await expect(
      service.restore(
        admin,
        draft.object.id,
        { expectedVersion: restored.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_LIFECYCLE_CONFLICT', status: 409 });
  });

  it('makes archived drafts and publication read only', async () => {
    const { service, draft } = await published();
    const archived = await service.archive(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    for (const operation of [
      () =>
        service.update(
          admin,
          draft.object.id,
          { expectedVersion: archived.object.version, name: 'bypass' },
          meta,
        ),
      () =>
        service.publish(
          admin,
          draft.object.id,
          { expectedVersion: archived.object.version },
          meta,
        ),
      () =>
        service.reorderObjects(
          admin,
          {
            items: [
              {
                objectId: draft.object.id,
                expectedVersion: archived.object.version,
              },
            ],
          },
          meta,
        ),
    ])
      await expect(operation()).rejects.toMatchObject({
        code: 'OBJECT_ARCHIVED',
        status: 409,
      });
  });

  it('previews dependency blockers without mutation and rechecks them on archive', async () => {
    const { service, store, draft } = await published();
    const before = structuredClone(store.objects);
    await expect(
      service.lifecycle(admin, draft.object.id),
    ).resolves.toMatchObject({ blockers: [] });
    expect(store.objects).toEqual(before);
    store.lifecycleBlockers = [
      {
        kind: 'WORKFLOW',
        objectCode: 'orders',
        objectName: '订单',
        description: '订单流程需要创建线索',
      },
    ];
    await expect(
      service.archive(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).rejects.toMatchObject({
      code: 'OBJECT_LIFECYCLE_BLOCKED',
      status: 409,
      fieldErrors: { blockers: ['订单流程需要创建线索'] },
    });
    expect(store.objects).toEqual(before);
  });

  it('revalidates outgoing dependencies before restore', async () => {
    const { service, store, draft } = await published();
    const archived = await service.archive(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    store.lifecycleBlockers = [
      {
        kind: 'WORKFLOW',
        objectCode: 'customers',
        objectName: '客户',
        description: '依赖的客户表已停用',
      },
    ];
    await expect(
      service.restore(
        admin,
        draft.object.id,
        { expectedVersion: archived.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_LIFECYCLE_BLOCKED', status: 409 });
    expect(store.objects[0].object.status).toBe('ARCHIVED');
  });

  it('requires explicit acknowledgement when legacy archive time is missing', async () => {
    const { service, store, draft } = await published();
    store.objects[0].object.status = 'ARCHIVED';
    store.expiredCount = 3;
    await expect(
      service.lifecycle(admin, draft.object.id),
    ).resolves.toMatchObject({
      requiresLegacyTimerAcknowledgement: true,
      expiredRecordCount: 3,
    });
    await expect(
      service.restore(
        admin,
        draft.object.id,
        { expectedVersion: draft.object.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_LIFECYCLE_CONFLICT', status: 409 });
    await expect(
      service.restore(
        admin,
        draft.object.id,
        {
          expectedVersion: draft.object.version,
          acknowledgeLegacyTimers: true,
        },
        meta,
      ),
    ).resolves.toMatchObject({ object: { status: 'ACTIVE' } });
  });

  it('rejects employee access and unknown objects', async () => {
    const { service, repository } = fixture();
    await expect(
      service.restore(employee, 'missing', { expectedVersion: 1 }, meta),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN', status: 403 });
    await expect(service.lifecycle(employee, 'missing')).rejects.toMatchObject({
      code: 'OBJECT_ACTION_FORBIDDEN',
      status: 403,
    });
    expect(repository.transactions).toBe(0);
    await expect(
      service.restore(admin, 'foreign-id', { expectedVersion: 1 }, meta),
    ).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404 });
  });

  it('resets lifecycle dirty offset when publishing after restore', async () => {
    const { service, draft } = await published();
    const archived = await service.archive(
      admin,
      draft.object.id,
      { expectedVersion: draft.object.version },
      meta,
    );
    let restored = await service.restore(
      admin,
      draft.object.id,
      { expectedVersion: archived.object.version },
      meta,
    );
    restored = await service.update(
      admin,
      draft.object.id,
      { expectedVersion: restored.object.version, description: 'new config' },
      meta,
    );
    expect(toObjectDraftResponse(restored).object.hasUnpublishedChanges).toBe(
      true,
    );
    await service.publish(
      admin,
      draft.object.id,
      { expectedVersion: restored.object.version },
      meta,
    );
    restored = await service.detail(admin, draft.object.id);
    expect(toObjectDraftResponse(restored).object.hasUnpublishedChanges).toBe(
      false,
    );
    restored = await service.update(
      admin,
      draft.object.id,
      { expectedVersion: restored.object.version, description: 'next config' },
      meta,
    );
    expect(toObjectDraftResponse(restored).object.hasUnpublishedChanges).toBe(
      true,
    );
  });
});
