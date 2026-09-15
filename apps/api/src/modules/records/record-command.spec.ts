import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import type {
  PublishedField,
  PublishedObjectSchema,
} from '../objects/object-schema';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import {
  applySourceRecordPatch,
  createRecordCommand,
  prepareSourceRecordPatch,
} from './record-command';
import type { DynamicRecord, RecordsStore } from './records.repository';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-a',
  tenantCode: 'baijie',
  memberId: '018f47a2-4b5c-7d8e-9f01-111111111111',
  role: 'TENANT_ADMIN',
};

const employee: TenantContext = {
  ...admin,
  userId: 'user-employee',
  memberId: '018f47a2-4b5c-7d8e-9f01-222222222222',
  role: 'EMPLOYEE',
};

const activeMemberId = '018f47a2-4b5c-7d8e-9f01-333333333333';
const meta = { requestId: 'req-command', ip: '127.0.0.1' };
const createdAt = new Date('2026-09-16T10:00:00.000Z');

function field(
  type: PublishedField['type'],
  overrides: Partial<PublishedField> = {},
): PublishedField {
  return {
    id: `field-${type.toLowerCase()}`,
    fieldKey: 'value',
    label: '测试字段',
    type,
    required: false,
    defaultValue: null,
    validation: {},
    config: {},
    sortOrder: 20,
    isSystem: false,
    ...overrides,
  };
}

function publishableSchema(): PublishedObjectSchema {
  return {
    publication: {
      id: 'publication-leads',
      number: 3,
      sourceDraftVersion: 7,
      publishedAt: '2026-09-01T00:00:00.000Z',
    },
    object: {
      id: 'object-leads',
      code: 'leads',
      name: '销售线索',
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 10,
    },
    fields: [
      field('TEXT', {
        id: 'field-name',
        fieldKey: 'name',
        label: '姓名',
        required: true,
        sortOrder: 10,
      }),
      field('TEXT', {
        id: 'field-source',
        fieldKey: 'source',
        label: '来源',
        defaultValue: '官网',
        sortOrder: 20,
      }),
      field('TEXT', {
        id: 'field-secret',
        fieldKey: 'secret',
        label: '内部备注',
        sortOrder: 30,
      }),
      field('MEMBER', {
        id: 'field-owner-ref',
        fieldKey: 'owner_ref',
        label: '协作人',
        sortOrder: 40,
      }),
    ],
    defaultView: {
      code: 'default',
      name: '全部线索',
      columnFieldKeys: ['name', 'source'],
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
        source: 'EDIT',
        secret: 'HIDDEN',
        owner_ref: 'EDIT',
      },
    },
  };
}

function access(
  overrides: Partial<EffectiveObjectAccess> = {},
): EffectiveObjectAccess {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    readScope: 'ALL',
    updateScope: 'ALL',
    fields: { name: 'EDIT', source: 'EDIT', secret: 'EDIT', owner_ref: 'EDIT' },
    ...overrides,
  };
}

function resolved(
  readiness: {
    schema?: Partial<PublishedObjectSchema>;
    access?: EffectiveObjectAccess;
  } = {},
): ResolvedObjectSchema {
  const schema = { ...publishableSchema(), ...readiness.schema };
  const effectiveAccess = readiness.access ?? access();
  return {
    schema,
    access: effectiveAccess,
    visibleSchema: {
      publication: {
        number: schema.publication.number,
        publishedAt: schema.publication.publishedAt,
      },
      object: {
        code: schema.object.code,
        name: schema.object.name,
        description: schema.object.description,
        titleFieldKey: schema.object.titleFieldKey,
        icon: schema.object.icon,
        sortOrder: schema.object.sortOrder,
      },
      fields: schema.fields.map((candidate) => ({
        ...candidate,
        access: schema.employeeAccess.fields[candidate.fieldKey] ?? 'HIDDEN',
      })),
      defaultView: { ...schema.defaultView, columnFieldKeys: [] },
      actions: {
        canCreate: effectiveAccess.canCreate,
        canRead: effectiveAccess.canRead,
        canUpdate: effectiveAccess.canUpdate,
        canDelete: effectiveAccess.canDelete,
      },
      scopes: {
        read: effectiveAccess.readScope,
        update: effectiveAccess.updateScope,
      },
    },
  };
}

const INITIAL_STATE = 'new';
const NEXT_STATE = 'converted';

/** The shared write input of both store intents. */
interface PatchIntentInput {
  recordId: string;
  expectedVersion: number;
  patch: {
    values: Record<string, unknown>;
    title: string;
    ownerMemberId: string | null;
    workflowStateKey?: string;
  };
  history?: { transitionKey: string };
}

/**
 * Mirrors the real `PrismaRecordsStore`: an insert for create, and one shared
 * write body behind `applyRecordPatch` / `applyTransition` (which differ only
 * by the ACTIVE-owner lock in the real store) that writes values, title, owner,
 * workflow state and `version + 1` for the final source patch.
 */
class MemoryStore implements RecordsStore {
  records: DynamicRecord[] = [];
  audits: AuditEvent[] = [];
  history: Array<{ recordId: string; transitionKey: string }> = [];
  activeMembers = new Set([admin.memberId, employee.memberId, activeMemberId]);
  nextRecordNo = 7n;
  /**
   * Per-intent call logs: rewiring a command to the other intent must be
   * visible to a test, because only `applyRecordPatch` locks the ACTIVE owner
   * rows in the real store.
   */
  recordPatchCalls: PatchIntentInput[] = [];
  transitionCalls: PatchIntentInput[] = [];
  /** Every write of either intent, for "nothing was written" assertions. */
  get writeCount(): number {
    return this.recordPatchCalls.length + this.transitionCalls.length;
  }

  lockImportBatch(): Promise<void> {
    return Promise.resolve();
  }
  findImportedRecordId(): Promise<string | null> {
    return Promise.resolve(null);
  }
  saveImportedRecordId(): Promise<void> {
    return Promise.resolve();
  }
  memberExists(memberId: string): Promise<boolean> {
    return Promise.resolve(this.activeMembers.has(memberId));
  }
  allocateRecordNo(): Promise<bigint> {
    const allocated = this.nextRecordNo;
    this.nextRecordNo += 1n;
    return Promise.resolve(allocated);
  }
  createRecord(record: DynamicRecord): Promise<DynamicRecord> {
    this.records.push(structuredClone(record));
    return Promise.resolve(structuredClone(record));
  }
  listRecords(): Promise<{ items: DynamicRecord[]; total: number }> {
    return Promise.resolve({ items: [], total: 0 });
  }
  findRecord(
    _objectId: string,
    recordId: string,
  ): Promise<DynamicRecord | null> {
    return Promise.resolve(
      structuredClone(
        this.records.find((record) => record.id === recordId) ?? null,
      ),
    );
  }
  updateRecord(
    recordId: string,
    expectedVersion: number,
    input: {
      values: Record<string, unknown>;
      title: string;
      ownerMemberId: string | null;
    },
  ): Promise<DynamicRecord | null> {
    const record = this.records.find((item) => item.id === recordId);
    if (!record || record.version !== expectedVersion)
      return Promise.resolve(null);
    record.values = structuredClone(input.values);
    record.title = input.title;
    record.ownerMemberId = input.ownerMemberId;
    record.version += 1;
    return Promise.resolve(structuredClone(record));
  }
  softDeleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }
  listActivities() {
    return Promise.resolve({ items: [], total: 0 });
  }
  createActivity(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }
  listMemberNames() {
    return Promise.resolve(new Map<string, string>());
  }
  appendAudit(event: AuditEvent): Promise<void> {
    this.audits.push(structuredClone(event));
    return Promise.resolve();
  }
  /**
   * The ordinary-update intent. The real store takes the ACTIVE-owner lock
   * here and only here, so which intent a command uses is observable behaviour
   * rather than an in-memory detail.
   */
  applyRecordPatch(input: PatchIntentInput): Promise<DynamicRecord | null> {
    this.recordPatchCalls.push(structuredClone(input));
    return this.applyWrite(input);
  }
  /**
   * The Transition intent: the same in-memory write body, deliberately without
   * that lock (`records.repository.spec.ts` pins the split), logged separately.
   */
  applyTransition(input: PatchIntentInput): Promise<DynamicRecord | null> {
    this.transitionCalls.push(structuredClone(input));
    return this.applyWrite(input);
  }
  private applyWrite(input: PatchIntentInput): Promise<DynamicRecord | null> {
    const record = this.records.find(
      (item) => item.id === input.recordId && item.deletedAt === null,
    );
    if (!record || record.version !== input.expectedVersion)
      return Promise.resolve(null);
    record.values = structuredClone(input.patch.values);
    record.title = input.patch.title;
    record.ownerMemberId = input.patch.ownerMemberId;
    if (input.patch.workflowStateKey !== undefined) {
      record.workflowStateKey = input.patch.workflowStateKey;
    }
    record.version += 1;
    record.updatedAt = createdAt.toISOString();
    if (input.history) {
      this.history.push({
        recordId: input.recordId,
        transitionKey: input.history.transitionKey,
      });
    }
    return Promise.resolve(structuredClone(record));
  }
  listTransitionHistory() {
    return Promise.resolve({ items: [], page: 1, limit: 20, total: 0 });
  }
}

function fixture(readiness: Parameters<typeof resolved>[0] = {}) {
  const store = new MemoryStore();
  let sequence = 0;
  const command = (overrides: {
    context?: TenantContext;
    values?: Record<string, unknown>;
    ownerMemberId?: string | null;
    resolution?: Parameters<typeof resolved>[0];
  }) =>
    createRecordCommand({
      store,
      resolved: resolved({ ...readiness, ...overrides.resolution }),
      context: overrides.context ?? admin,
      values: overrides.values ?? { name: '张三' },
      ownerMemberId: overrides.ownerMemberId,
      meta,
      clock: () => createdAt,
      idGenerator: () => `record-${++sequence}`,
    });
  return { store, command };
}

async function seed(
  store: MemoryStore,
  overrides: Partial<DynamicRecord> = {},
): Promise<DynamicRecord> {
  const created = await store.createRecord({
    id: 'record-seed',
    objectId: 'object-leads',
    recordNo: 1n,
    ownerMemberId: admin.memberId,
    workflowStateKey: INITIAL_STATE,
    title: '原始线索',
    values: { name: '原始线索', source: '官网' },
    version: 4,
    createdByMemberId: admin.memberId,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    deletedAt: null,
    ...overrides,
  });
  store.audits = [];
  return created;
}

describe('createRecordCommand', () => {
  it('enforces canCreate before touching the store', async () => {
    const { store, command } = fixture({
      access: access({ canCreate: false }),
    });

    await expect(command({ context: employee })).rejects.toMatchObject({
      code: 'OBJECT_ACTION_FORBIDDEN',
    });
    expect(store.records).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it('rejects HIDDEN and READ_ONLY fields and accepts EDIT fields', async () => {
    const hidden = fixture({
      access: access({
        fields: {
          name: 'EDIT',
          source: 'EDIT',
          secret: 'HIDDEN',
          owner_ref: 'EDIT',
        },
      }),
    });
    await expect(
      hidden.command({ values: { name: '张三', secret: '内部' } }),
    ).rejects.toMatchObject({
      code: 'FIELD_HIDDEN',
      fieldErrors: { secret: [expect.any(String)] },
    });

    const readOnly = fixture({
      access: access({
        fields: {
          name: 'EDIT',
          source: 'READ_ONLY',
          secret: 'EDIT',
          owner_ref: 'EDIT',
        },
      }),
    });
    await expect(
      readOnly.command({ values: { name: '张三', source: '广告' } }),
    ).rejects.toMatchObject({
      code: 'FIELD_READ_ONLY',
      fieldErrors: { source: [expect.any(String)] },
    });

    const editable = fixture();
    const created = await editable.command({
      values: { name: '张三', source: '广告' },
    });
    expect(created.values).toEqual({ name: '张三', source: '广告' });
  });

  it('applies required validation and field defaults', async () => {
    const { store, command } = fixture();

    await expect(command({ values: {} })).rejects.toMatchObject({
      code: 'FIELD_REQUIRED',
      fieldErrors: { name: [expect.any(String)] },
    });
    expect(store.records).toEqual([]);

    const created = await command({ values: { name: '张三' } });
    expect(created.values).toEqual({ name: '张三', source: '官网' });
  });

  it('validates MEMBER values against active members', async () => {
    const { store, command } = fixture();

    await expect(
      command({ values: { name: '张三', owner_ref: activeMemberId } }),
    ).resolves.toMatchObject({ values: { owner_ref: activeMemberId } });

    store.activeMembers.delete(activeMemberId);
    await expect(
      command({ values: { name: '李四', owner_ref: activeMemberId } }),
    ).rejects.toMatchObject({
      code: 'FIELD_INVALID',
      fieldErrors: { owner_ref: [expect.any(String)] },
    });
    expect(store.records).toHaveLength(1);
  });

  describe('owner rules', () => {
    it('forces employee ownership to self regardless of the request', async () => {
      const { command } = fixture();
      const created = await command({
        context: employee,
        ownerMemberId: activeMemberId,
      });
      expect(created.ownerMemberId).toBe(employee.memberId);
    });

    it('lets an admin name an active member or leave the record unowned', async () => {
      const { command } = fixture();
      const assigned = await command({ ownerMemberId: activeMemberId });
      expect(assigned.ownerMemberId).toBe(activeMemberId);

      const unowned = await command({ ownerMemberId: undefined });
      expect(unowned.ownerMemberId).toBeNull();
    });
  });

  it('derives the title from the published title field', async () => {
    const { command } = fixture({
      schema: {
        object: {
          ...publishableSchema().object,
          titleFieldKey: 'source',
        },
      },
    });
    const created = await command({ values: { name: '张三', source: '展会' } });
    expect(created.title).toBe('展会');
  });

  it('uses the target published workflow initial state and ignores client state', async () => {
    const withWorkflow = fixture({
      schema: {
        workflow: {
          initialStateKey: INITIAL_STATE,
          states: [
            {
              key: INITIAL_STATE,
              label: '新建',
              sortOrder: 10,
              isTerminal: false,
            },
          ],
          transitions: [],
        },
      },
    });
    await expect(
      withWorkflow.command({ values: { name: '张三' } }),
    ).resolves.toMatchObject({ workflowStateKey: INITIAL_STATE });

    const withoutWorkflow = fixture();
    await expect(
      withoutWorkflow.command({ values: { name: '张三' } }),
    ).resolves.toMatchObject({ workflowStateKey: null });

    await expect(
      withoutWorkflow.command({
        values: { name: '张三', workflowStateKey: NEXT_STATE },
      }),
    ).rejects.toMatchObject({ code: 'FIELD_UNKNOWN' });
  });

  it('allocates a record number and starts at version 1', async () => {
    const { command } = fixture();
    const first = await command({ values: { name: '张三' } });
    const second = await command({ values: { name: '李四' } });

    expect(first.recordNo).toBe(7n);
    expect(second.recordNo).toBe(8n);
    expect(first.version).toBe(1);
    expect(first.createdAt).toBe(createdAt.toISOString());
    expect(first.createdByMemberId).toBe(admin.memberId);
  });

  it('appends a record.created audit carrying the stored values', async () => {
    const { store, command } = fixture();
    const created = await command({ values: { name: '张三' } });

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: 'record.created',
      resourceType: 'record',
      resourceId: created.id,
      requestId: meta.requestId,
    });
    expect(store.audits[0].before).toBeUndefined();
    expect(store.audits[0].after).toMatchObject({
      title: '张三',
      values: { name: '张三', source: '官网' },
      version: 1,
    });
  });
});

describe('prepareSourceRecordPatch / applySourceRecordPatch', () => {
  it('validates a patch against the immutable snapshot without writing', async () => {
    const store = new MemoryStore();
    const current = await seed(store);
    const schema = resolved();

    const patch = await prepareSourceRecordPatch({
      store,
      resolved: schema,
      context: admin,
      current,
      values: { name: '改名' },
    });

    expect(patch).toEqual({
      values: { name: '改名', source: '官网' },
      title: '改名',
      ownerMemberId: admin.memberId,
    });
    expect(store.records[0].version).toBe(4);
    expect(store.records[0].title).toBe('原始线索');
    expect(store.writeCount).toBe(0);
  });

  it('accumulates several patches against the same snapshot while applying only one', async () => {
    const store = new MemoryStore();
    const current = await seed(store);
    const schema = resolved();

    const updates = await prepareSourceRecordPatch({
      store,
      resolved: schema,
      context: admin,
      current,
      values: { name: '转化后' },
    });
    const assigned = await prepareSourceRecordPatch({
      store,
      resolved: schema,
      context: admin,
      current,
      ownerMemberId: activeMemberId,
    });

    // Both Actions were validated against the same `version: 4` snapshot and
    // neither one moved it.
    expect(store.records[0].version).toBe(4);
    expect(store.writeCount).toBe(0);

    const applied = await applySourceRecordPatch({
      store,
      recordId: current.id,
      expectedVersion: current.version,
      patch: { ...updates, ownerMemberId: assigned.ownerMemberId },
      workflowStateKey: NEXT_STATE,
      history: {
        objectDefinitionId: 'object-leads',
        objectPublicationId: 'publication-leads',
        transitionKey: 'convert',
        transitionLabel: '转化',
        fromStateKey: INITIAL_STATE,
        fromStateLabel: '新建',
        toStateKey: NEXT_STATE,
        toStateLabel: '已转化',
        actorMemberId: admin.memberId,
      },
    });

    // `applySourceRecordPatch` is the ORDINARY-update command, so it applies
    // through the locking intent even when the caller attaches Transition
    // history: rewiring it to `applyTransition` fails both counts below.
    expect(store.recordPatchCalls).toHaveLength(1);
    expect(store.transitionCalls).toHaveLength(0);
    expect(store.writeCount).toBe(1);
    expect(applied).toMatchObject({
      values: { name: '转化后', source: '官网' },
      title: '转化后',
      ownerMemberId: activeMemberId,
      workflowStateKey: NEXT_STATE,
      version: 5,
    });
    expect(store.history).toEqual([
      { recordId: current.id, transitionKey: 'convert' },
    ]);
  });

  it('leaves the workflow state untouched when no transition state is supplied', async () => {
    const store = new MemoryStore();
    const current = await seed(store);
    const schema = resolved();

    const patch = await prepareSourceRecordPatch({
      store,
      resolved: schema,
      context: admin,
      current,
      values: { name: '改名' },
    });
    const applied = await applySourceRecordPatch({
      store,
      recordId: current.id,
      expectedVersion: current.version,
      patch,
    });

    expect(applied.workflowStateKey).toBe(INITIAL_STATE);
    expect(store.history).toEqual([]);
  });

  it('applies the ordinary update through the locking intent, never the transition intent', async () => {
    const store = new MemoryStore();
    const current = await seed(store);
    const schema = resolved();
    const patch = await prepareSourceRecordPatch({
      store,
      resolved: schema,
      context: admin,
      current,
      values: { name: '普通更新' },
    });

    await applySourceRecordPatch({
      store,
      recordId: current.id,
      expectedVersion: current.version,
      patch,
    });

    // An ordinary update must take the ACTIVE-owner lock, and only
    // `applyRecordPatch` does. Rewiring this command to `store.applyTransition`
    // flips both counts, so this is the assertion that fails on that rewire.
    expect(store.recordPatchCalls).toHaveLength(1);
    expect(store.transitionCalls).toHaveLength(0);
    expect(store.recordPatchCalls[0]).toMatchObject({
      recordId: current.id,
      expectedVersion: current.version,
      patch: { title: '普通更新' },
    });
    expect(store.recordPatchCalls[0]?.history).toBeUndefined();
  });

  it('reports a version conflict instead of writing when the snapshot is stale', async () => {
    const store = new MemoryStore();
    const current = await seed(store);
    const schema = resolved();
    const patch = await prepareSourceRecordPatch({
      store,
      resolved: schema,
      context: admin,
      current,
      values: { name: '改名' },
    });

    await expect(
      applySourceRecordPatch({
        store,
        recordId: current.id,
        expectedVersion: current.version + 1,
        patch,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });
    expect(store.records[0].version).toBe(4);
  });

  it('keeps the employee owner and rejects employee reassignment', async () => {
    const store = new MemoryStore();
    const current = await seed(store, { ownerMemberId: admin.memberId });
    const schema = resolved();

    const patch = await prepareSourceRecordPatch({
      store,
      resolved: schema,
      context: employee,
      current,
      values: { name: '员工改的' },
      ownerMemberId: activeMemberId,
    });

    expect(patch.ownerMemberId).toBe(admin.memberId);
    await expect(
      prepareSourceRecordPatch({
        store,
        resolved: schema,
        context: admin,
        current,
        ownerMemberId: '018f47a2-4b5c-7d8e-9f01-999999999999',
      }),
    ).rejects.toMatchObject({ code: 'OWNER_INVALID' });
  });

  it('enforces canUpdate and field permission on the source patch', async () => {
    const store = new MemoryStore();
    const current = await seed(store);

    await expect(
      prepareSourceRecordPatch({
        store,
        resolved: resolved({ access: access({ canUpdate: false }) }),
        context: employee,
        current,
        values: { name: '改名' },
      }),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });

    await expect(
      prepareSourceRecordPatch({
        store,
        resolved: resolved({
          access: access({
            fields: {
              name: 'EDIT',
              source: 'EDIT',
              secret: 'HIDDEN',
              owner_ref: 'EDIT',
            },
          }),
        }),
        context: admin,
        current,
        values: { secret: '内部' },
      }),
    ).rejects.toMatchObject({
      code: 'FIELD_HIDDEN',
      fieldErrors: { secret: [expect.any(String)] },
    });
    expect(store.writeCount).toBe(0);
  });

  it('rejects an over-long derived title instead of truncating it', async () => {
    const store = new MemoryStore();
    const current = await seed(store);
    const domain = '@example.com';
    const overLong = `${'a'.repeat(320 - domain.length)}${domain}`;
    const base = publishableSchema();
    const schema = resolved({
      schema: {
        object: { ...base.object, titleFieldKey: 'source' },
        fields: base.fields.map((candidate) =>
          candidate.fieldKey === 'source'
            ? { ...candidate, type: 'EMAIL', defaultValue: null }
            : candidate,
        ),
      },
    });

    await expect(
      prepareSourceRecordPatch({
        store,
        resolved: schema,
        context: admin,
        current,
        values: { source: overLong },
      }),
    ).rejects.toMatchObject({
      code: 'FIELD_INVALID',
      fieldErrors: { source: [expect.any(String)] },
    });
    expect(store.writeCount).toBe(0);

    // The same field stays writable while the derived title fits the column.
    await expect(
      prepareSourceRecordPatch({
        store,
        resolved: schema,
        context: admin,
        current,
        values: { source: 'user@example.com' },
      }),
    ).resolves.toMatchObject({ title: 'user@example.com' });
  });
});
