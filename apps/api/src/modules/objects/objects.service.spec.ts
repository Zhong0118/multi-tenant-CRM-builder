import type { TenantContext } from '../../common/tenancy/tenant-context';
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
    return Promise.resolve(
      this.objects.find((draft) => draft.object.id === objectId) ?? null,
    );
  }

  createObject(draft: ObjectDraft): Promise<ObjectDraft> {
    if (this.objects.some((item) => item.object.code === draft.object.code)) {
      return Promise.reject(
        Object.assign(new Error('duplicate'), { code: 'P2002' }),
      );
    }
    this.objects.push(structuredClone(draft));
    return Promise.resolve(structuredClone(draft));
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
  const service = new ObjectsService(
    repository,
    () => new Date('2026-08-21T10:00:00.000Z'),
    () => `generated-${++id}`,
  );
  return { service, store, repository };
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

    const inactivated = await service.updateField(
      admin,
      draft.object.id,
      titleField.id,
      { expectedVersion: draft.object.version, status: 'INACTIVE' },
      meta,
    );
    expect(inactivated.fields).toContainEqual(
      expect.objectContaining({ id: titleField.id, status: 'INACTIVE' }),
    );
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
