import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import type {
  PublishedField,
  PublishedObjectSchema,
} from '../objects/object-schema';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import type {
  CreateFollowUpCommandDeps,
  CreateFollowUpCommandInput,
  FollowUpMeta,
  FollowUpRecordScope,
} from '../follow-ups/follow-up-command';
import {
  type CreateRecordRelationCommandDeps,
  type CreateRecordRelationCommandInput,
  type RecordRelationMeta,
} from '../record-relations/record-relation-command';
import type {
  DynamicRecord,
  RecordsStore,
} from '../records/records.repository';
import { ApiException } from '../../common/errors/api.exception';
import type { WorkflowActionDraft } from './action.types';
import { executeActions, type ActionEngineDeps } from './action-engine';

/**
 * §12–§32 engine tests. The record commands are the real Task 5 primitives over
 * an in-memory store; the relation and follow-up commands are injected fakes
 * (they need a real `Prisma.TransactionClient`), so the engine can be driven
 * through every Action type without a database.
 */

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

/** The Source Record's current owner, distinct from both actors. */
const OWNER = '018f47a2-4b5c-7d8e-9f01-333333333333';

const SOURCE_CODE = 'leads';
const TARGET_CODE = 'customers';
const CONTACT_CODE = 'contacts';

const SNAPSHOT_ID = '018f47a2-4b5c-7d8e-9f01-aaaaaaaaaaaa';

const createdAt = new Date('2026-09-16T10:00:00.000Z');
const meta = { requestId: 'req-engine', ip: '127.0.0.1' };
const execution = {
  workflowExecutionId: 'execution-1',
  transitionKey: 'convert',
  /** §32: the published Transition label the employee saw, not its key. */
  transitionLabel: '转化',
};

function field(
  fieldKey: string,
  overrides: Partial<PublishedField> = {},
): PublishedField {
  return {
    id: `field-${fieldKey}`,
    fieldKey,
    label: fieldKey,
    type: 'TEXT',
    required: false,
    defaultValue: null,
    validation: {},
    config: {},
    sortOrder: 10,
    isSystem: false,
    ...overrides,
  };
}

const SOURCE_FIELDS = [
  field('name', { required: true, sortOrder: 10 }),
  field('source', { defaultValue: '官网', sortOrder: 20 }),
  field('secret', { label: '内部备注', sortOrder: 30 }),
  field('companyName', { sortOrder: 40 }),
  field('signedOn', { type: 'DATE', sortOrder: 50 }),
  field('createdAt', { type: 'DATETIME', sortOrder: 60 }),
];

/** The Target Object: `name` is its title field, `phone` a writable field. */
const TARGET_FIELDS = [
  field('name', { required: true, sortOrder: 10 }),
  field('phone', { sortOrder: 20 }),
  field('source', { sortOrder: 30 }),
];

function schema(
  code: string,
  fields: PublishedField[],
  titleFieldKey = 'name',
): PublishedObjectSchema {
  return {
    publication: {
      id: `publication-${code}`,
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: '2026-09-01T00:00:00.000Z',
    },
    object: {
      id: `object-${code}`,
      code,
      name: `对象 ${code}`,
      description: null,
      titleFieldKey,
      icon: null,
      sortOrder: 10,
    },
    fields,
    defaultView: {
      code: 'default',
      name: `全部 ${code}`,
      columnFieldKeys: fields.map((item) => item.fieldKey),
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: Object.fromEntries(
        fields.map((item) => [
          item.fieldKey,
          item.fieldKey === 'secret' ? 'HIDDEN' : 'EDIT',
        ]),
      ),
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
    fields: {
      name: 'EDIT',
      phone: 'EDIT',
      source: 'EDIT',
      secret: 'EDIT',
      companyName: 'EDIT',
      signedOn: 'EDIT',
      createdAt: 'EDIT',
    },
    ...overrides,
  };
}

function resolved(
  code: string,
  fields: PublishedField[],
  overrides: Partial<EffectiveObjectAccess> = {},
  titleFieldKey = 'name',
): ResolvedObjectSchema {
  const published = schema(code, fields, titleFieldKey);
  const effective = access(overrides);
  return {
    schema: published,
    access: effective,
    visibleSchema: {
      publication: {
        number: published.publication.number,
        publishedAt: published.publication.publishedAt,
      },
      object: {
        code: published.object.code,
        name: published.object.name,
        description: published.object.description,
        titleFieldKey: published.object.titleFieldKey,
        icon: published.object.icon,
        sortOrder: published.object.sortOrder,
      },
      fields: published.fields.map((item) => ({
        ...item,
        access: effective.fields[item.fieldKey] ?? 'HIDDEN',
      })),
      defaultView: { ...published.defaultView, columnFieldKeys: [] },
      actions: {
        canCreate: effective.canCreate,
        canRead: effective.canRead,
        canUpdate: effective.canUpdate,
        canDelete: effective.canDelete,
      },
      scopes: {
        read: effective.readScope,
        update: effective.updateScope,
      },
    },
  };
}

/**
 * The Task 5 store, in memory. `records` holds the Source Record, so a test can
 * prove the engine never writes it (§14) and never moves `version`.
 */
class MemoryStore implements RecordsStore {
  records: DynamicRecord[] = [];
  audits: AuditEvent[] = [];
  history: Array<{ recordId: string; transitionKey: string }> = [];
  activeMembers = new Set([admin.memberId, employee.memberId, OWNER]);
  nextRecordNo = 11n;
  recordPatchCalls: unknown[] = [];
  transitionCalls: unknown[] = [];
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
  listRecords() {
    return Promise.resolve({ items: [], total: 0 });
  }
  findRecord(_objectId: string, recordId: string) {
    return Promise.resolve(
      structuredClone(
        this.records.find((record) => record.id === recordId) ?? null,
      ),
    );
  }
  /**
   * §23 step 7: the Workflow transition lock. This spec never drives the
   * execute path, so the in-memory store only mirrors the owner-scope filter of
   * the real `FOR UPDATE` statement — there is no row lock to model here.
   */
  async lockRecord(input: {
    objectId: string;
    recordId: string;
    ownerMemberId: string | null;
  }): Promise<DynamicRecord | null> {
    const record = await this.findRecord(input.objectId, input.recordId);
    if (!record) return null;
    if (
      input.ownerMemberId !== null &&
      record.ownerMemberId !== input.ownerMemberId
    ) {
      return null;
    }
    return record;
  }
  updateRecord(): Promise<never> {
    return Promise.reject(new Error('updateRecord is superseded'));
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
  aggregateRecords() {
    return Promise.resolve({ value: '0', groups: [] });
  }
  appendAudit(event: AuditEvent): Promise<void> {
    this.audits.push(structuredClone(event));
    return Promise.resolve();
  }
  applyRecordPatch(input: unknown): Promise<DynamicRecord | null> {
    this.recordPatchCalls.push(structuredClone(input));
    return Promise.resolve(null);
  }
  applyTransition(input: unknown): Promise<DynamicRecord | null> {
    this.transitionCalls.push(structuredClone(input));
    return Promise.resolve(null);
  }
  listTransitionHistory() {
    return Promise.resolve({ items: [], page: 1, limit: 20, total: 0 });
  }
}

function seedSource(
  store: MemoryStore,
  overrides: Partial<DynamicRecord> = {},
): DynamicRecord {
  const record: DynamicRecord = {
    id: SNAPSHOT_ID,
    objectId: 'object-leads',
    recordNo: 3n,
    ownerMemberId: OWNER,
    workflowStateKey: 'new',
    title: '原始线索',
    values: {
      name: '原始线索',
      source: '官网',
      secret: '内部',
      companyName: '白杰科技',
      signedOn: '2026-09-01',
      createdAt: '2026-09-01T08:00:00.000Z',
    },
    version: 4,
    createdByMemberId: OWNER,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    deletedAt: null,
    ...overrides,
  };
  store.records.push(record);
  return record;
}

/** The subset of the follow-up projection this engine actually consumed. */
interface FollowUpCommandFakeResult {
  id: string;
  assigneeMemberId: string | undefined;
  recordId: string;
  title: string;
  dueAt: string;
}

/** A target resolver keyed by object code, with per-code access overrides. */
function objectResolver(
  overrides: Record<string, Partial<EffectiveObjectAccess>> = {},
): ActionEngineDeps['resolveObject'] {
  return (objectCode: string) =>
    Promise.resolve(
      resolved(
        objectCode,
        objectCode === SOURCE_CODE ? SOURCE_FIELDS : TARGET_FIELDS,
        overrides[objectCode] ?? {},
      ),
    );
}

function fixture(
  options: { resolveObject?: ActionEngineDeps['resolveObject'] } = {},
) {
  const store = new MemoryStore();
  const source = {
    objectCode: SOURCE_CODE,
    resolved: resolved(SOURCE_CODE, SOURCE_FIELDS),
    snapshot: seedSource(store),
  };
  const tx = { __transaction: true } as unknown as Prisma.TransactionClient;
  const relationCommand = jest.fn<
    Promise<{ success: true; relationId: string }>,
    [
      Prisma.TransactionClient,
      TenantContext,
      CreateRecordRelationCommandInput,
      RecordRelationMeta,
      CreateRecordRelationCommandDeps,
    ]
  >();
  relationCommand.mockResolvedValue({
    success: true,
    relationId: 'relation-1',
  });
  const followUpCommand = jest.fn<
    Promise<FollowUpCommandFakeResult>,
    [
      Prisma.TransactionClient,
      TenantContext,
      CreateFollowUpCommandInput,
      FollowUpMeta,
      FollowUpRecordScope,
      CreateFollowUpCommandDeps,
    ]
  >();
  followUpCommand.mockImplementation((_tx, _context, input) =>
    Promise.resolve({
      id: 'follow-up-1',
      assigneeMemberId: input.assigneeMemberId,
      recordId: input.recordId,
      title: input.title,
      dueAt: new Date(input.dueAt).toISOString(),
    }),
  );
  let sequence = 0;
  const deps = {
    store,
    audit: {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as ActionEngineDeps['audit'],
    resolveObject: options.resolveObject ?? objectResolver(),
    createRelation:
      relationCommand as unknown as ActionEngineDeps['createRelation'],
    createFollowUp:
      followUpCommand as unknown as ActionEngineDeps['createFollowUp'],
    clock: () => createdAt,
    idGenerator: () => `created-${++sequence}`,
  } satisfies ActionEngineDeps;

  return {
    store,
    source,
    tx,
    deps,
    relationCommand,
    followUpCommand,
    run: (
      actions: WorkflowActionDraft[],
      overrides: {
        context?: TenantContext;
        source?: typeof source;
        execution?: Partial<typeof execution>;
      } = {},
    ) =>
      executeActions({
        tx,
        context: overrides.context ?? admin,
        source: overrides.source ?? source,
        actions,
        execution: { ...execution, ...overrides.execution },
        meta,
        deps,
      }),
  };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as {
      code: string;
      getStatus(): number;
      message: string;
      fieldErrors: Record<string, string[]>;
    };
  }
  throw new Error('expected the engine to reject');
}

const CREATE_CUSTOMER: WorkflowActionDraft = {
  key: 'create-customer',
  type: 'CREATE_RECORD',
  targetObjectCode: TARGET_CODE,
  values: {
    name: { source: 'SOURCE_FIELD', fieldKey: 'companyName' },
    phone: { source: 'LITERAL', value: '13800000000' },
  },
  owner: { source: 'ACTOR' },
};

const CREATE_CONTACT: WorkflowActionDraft = {
  key: 'create-contact',
  type: 'CREATE_RECORD',
  targetObjectCode: CONTACT_CODE,
  values: { name: { source: 'SOURCE_META', property: 'title' } },
};

const LINK: WorkflowActionDraft = {
  key: 'link-customer-contact',
  type: 'CREATE_RELATION',
  left: {
    source: 'ACTION_OUTPUT',
    actionKey: 'create-customer',
    property: 'recordId',
  },
  right: {
    source: 'ACTION_OUTPUT',
    actionKey: 'create-contact',
    property: 'recordId',
  },
};

const FOLLOW_UP: WorkflowActionDraft = {
  key: 'follow-up-call',
  type: 'CREATE_FOLLOW_UP',
  target: {
    source: 'ACTION_OUTPUT',
    actionKey: 'create-customer',
    property: 'recordId',
  },
  title: { source: 'LITERAL', value: '回访客户' },
  dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
  assignee: { source: 'ACTOR' },
};

/** The same follow-up, but on the second created record of a run. */
const FOLLOW_UP_ON_CONTACT: WorkflowActionDraft = {
  ...FOLLOW_UP,
  target: {
    source: 'ACTION_OUTPUT',
    actionKey: 'create-contact',
    property: 'recordId',
  },
};

const UPDATE_SOURCE: WorkflowActionDraft = {
  key: 'update-source',
  type: 'UPDATE_RECORD',
  target: 'SOURCE_RECORD',
  values: { name: { source: 'LITERAL', value: '转化后' } },
};

const ASSIGN_SOURCE: WorkflowActionDraft = {
  key: 'assign-source',
  type: 'ASSIGN_OWNER',
  target: 'SOURCE_RECORD',
  owner: { source: 'ACTOR' },
};

describe('executeActions ordering and outputs (§28)', () => {
  it('executes the six Action types in array order and returns every output', async () => {
    const { run, store, source, tx, relationCommand, followUpCommand } =
      fixture();
    const order: string[] = [];
    const record = store.createRecord.bind(store);
    jest.spyOn(store, 'createRecord').mockImplementation((input) => {
      order.push(`record:${input.title}`);
      return record(input);
    });
    relationCommand.mockImplementation(() => {
      order.push('relation');
      return Promise.resolve({
        success: true as const,
        relationId: 'relation-1',
      });
    });
    followUpCommand.mockImplementation((_tx, _context, input) => {
      order.push('follow-up');
      return Promise.resolve({
        id: 'follow-up-1',
        assigneeMemberId: input.assigneeMemberId,
        recordId: input.recordId,
        title: input.title,
        dueAt: new Date(input.dueAt).toISOString(),
      });
    });

    const result = await run([
      CREATE_CUSTOMER,
      CREATE_CONTACT,
      LINK,
      FOLLOW_UP,
      UPDATE_SOURCE,
      ASSIGN_SOURCE,
    ]);

    expect(order).toEqual([
      'record:白杰科技',
      'record:原始线索',
      'relation',
      'follow-up',
    ]);
    expect(result.effects).toEqual([
      {
        actionKey: 'create-customer',
        type: 'CREATE_RECORD',
        effect: 'RECORD_CREATED',
        recordId: 'created-1',
      },
      {
        actionKey: 'create-contact',
        type: 'CREATE_RECORD',
        effect: 'RECORD_CREATED',
        recordId: 'created-2',
      },
      {
        actionKey: 'link-customer-contact',
        type: 'CREATE_RELATION',
        effect: 'RELATION_CREATED',
        recordId: 'created-1',
      },
      {
        actionKey: 'follow-up-call',
        type: 'CREATE_FOLLOW_UP',
        effect: 'FOLLOW_UP_CREATED',
        recordId: 'created-1',
      },
      {
        actionKey: 'update-source',
        type: 'UPDATE_RECORD',
        effect: 'SOURCE_RECORD_UPDATED',
        recordId: SNAPSHOT_ID,
      },
      {
        actionKey: 'assign-source',
        type: 'ASSIGN_OWNER',
        effect: 'SOURCE_OWNER_ASSIGNED',
        recordId: SNAPSHOT_ID,
      },
    ]);
    expect(result.outputs.get('create-customer')).toEqual({
      type: 'CREATE_RECORD',
      recordId: 'created-1',
      objectCode: TARGET_CODE,
      recordNo: '11',
    });
    expect(result.outputs.get('create-contact')).toEqual({
      type: 'CREATE_RECORD',
      recordId: 'created-2',
      objectCode: CONTACT_CODE,
      recordNo: '12',
    });
    expect(result.outputs.get('link-customer-contact')).toEqual({
      type: 'CREATE_RELATION',
      relationId: 'relation-1',
    });
    expect(result.outputs.get('follow-up-call')).toEqual({
      type: 'CREATE_FOLLOW_UP',
      followUpId: 'follow-up-1',
      recordId: 'created-1',
    });
    expect(result.outputs.get('update-source')).toEqual({
      type: 'UPDATE_RECORD',
      recordId: SNAPSHOT_ID,
    });
    expect(result.outputs.get('assign-source')).toEqual({
      type: 'ASSIGN_OWNER',
      recordId: SNAPSHOT_ID,
      ownerMemberId: admin.memberId,
    });

    // The engine runs inside the caller's transition (§4/§24): the same
    // `Prisma.TransactionClient` object, never a nested one.
    expect(relationCommand).toHaveBeenCalledWith(
      tx,
      admin,
      expect.objectContaining({ code: 'customers', id: 'created-1' }),
      expect.anything(),
      expect.anything(),
    );
    expect(followUpCommand).toHaveBeenCalledWith(
      tx,
      admin,
      expect.objectContaining({ recordId: 'created-1' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    // The source snapshot itself is untouched by the engine (§13).
    expect(source.snapshot.values).toMatchObject({ name: '原始线索' });
  });

  it('returns an empty result for a transition without actions', async () => {
    const { run } = fixture();

    await expect(run([])).resolves.toEqual({
      outputs: new Map(),
      sourcePatch: null,
      effects: [],
    });
  });
});

describe('CREATE_RECORD executor (§18, §25, §46.3)', () => {
  it('resolves the current target publication inside the transaction before creating', async () => {
    const resolveObject = jest.fn((objectCode: string) =>
      Promise.resolve(resolved(objectCode, TARGET_FIELDS)),
    );
    const { run } = fixture({ resolveObject });

    await run([CREATE_CUSTOMER]);

    expect(resolveObject).toHaveBeenCalledWith(TARGET_CODE);
  });

  it('reuses the ordinary record create rules and reports the created record', async () => {
    const { run, store } = fixture();

    const result = await run([CREATE_CUSTOMER]);

    // `createRecordCommand` owns required/default handling, the title, the
    // workflow initial state and the record number (§18): the stored row is the
    // proof that the engine did not create it by hand.
    expect(store.records).toHaveLength(2);
    expect(store.records[1]).toMatchObject({
      objectId: 'object-customers',
      title: '白杰科技',
      ownerMemberId: admin.memberId,
      version: 1,
      createdByMemberId: admin.memberId,
    });
    expect(result.outputs.get('create-customer')).toMatchObject({
      objectCode: TARGET_CODE,
      recordNo: '11',
    });
  });

  it('correlates the record.created audit with the execution and the action', async () => {
    const { run, store } = fixture();

    await run([CREATE_CUSTOMER]);

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: 'record.created',
      requestId: meta.requestId,
      after: {
        workflowExecutionId: 'execution-1',
        transitionKey: 'convert',
        actionKey: 'create-customer',
        actionType: 'CREATE_RECORD',
      },
    });
  });

  it('denies the target create the Transition allowed (§5, no elevation)', async () => {
    const { run, store } = fixture({
      resolveObject: objectResolver({
        [TARGET_CODE]: { canCreate: false },
      }),
    });

    const error = await rejection(
      run([CREATE_CUSTOMER], { context: employee }),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.getStatus()).toBe(403);
    expect(error.fieldErrors).toEqual({
      'actions.create-customer': ['你无权执行该对象操作。'],
    });
    expect(store.records).toHaveLength(1);
  });

  it('reports a target field failure under actions.<key>.<field>', async () => {
    const { run } = fixture();

    const error = await rejection(
      run([
        {
          key: 'create-customer',
          type: 'CREATE_RECORD',
          targetObjectCode: TARGET_CODE,
          // The target's required `name` is never mapped.
          values: { phone: { source: 'LITERAL', value: '13800000000' } },
        },
      ]),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.fieldErrors).toEqual({
      'actions.create-customer.name': [expect.any(String)],
    });
  });

  it('substitutes the actor when a CREATE_RECORD owner is ACTOR', async () => {
    const { run, store } = fixture();

    await run([CREATE_CUSTOMER], { context: employee });

    expect(store.records[1].ownerMemberId).toBe(employee.memberId);
  });
});

describe('UPDATE_RECORD and ASSIGN_OWNER accumulate one source patch (§13, §14)', () => {
  it('accumulates two UPDATE_RECORD and one ASSIGN_OWNER into ONE patch and writes nothing', async () => {
    const { run, store, source } = fixture();

    const result = await run([
      {
        ...UPDATE_SOURCE,
        values: { name: { source: 'LITERAL', value: '转化后' } },
      },
      {
        key: 'update-source-2',
        type: 'UPDATE_RECORD',
        target: 'SOURCE_RECORD',
        values: { source: { source: 'LITERAL', value: '展会' } },
      },
      ASSIGN_SOURCE,
    ]);

    expect(result.sourcePatch).toEqual({
      values: {
        name: '转化后',
        source: '展会',
        secret: '内部',
        companyName: '白杰科技',
        signedOn: '2026-09-01',
        createdAt: '2026-09-01T08:00:00.000Z',
      },
      title: '转化后',
      ownerMemberId: admin.memberId,
    });
    // §14: the engine stages the patch; it never writes the source record and
    // never moves its version. The caller applies it once.
    expect(store.writeCount).toBe(0);
    expect(store.records[0].version).toBe(4);
    expect(store.records[0].title).toBe('原始线索');
    expect(source.snapshot.version).toBe(4);
  });

  it('keeps an earlier ASSIGN_OWNER when a later UPDATE_RECORD rebuilds the patch', async () => {
    const { run, store, source } = fixture();

    // The ordering that can regress: the accumulator must carry the pending
    // owner forward into every rebuild, or the UPDATE_RECORD that runs LAST
    // silently reverts the owner to the immutable snapshot's.
    expect(source.snapshot.ownerMemberId).toBe(OWNER);

    const result = await run([
      ASSIGN_SOURCE,
      {
        ...UPDATE_SOURCE,
        values: { companyName: { source: 'LITERAL', value: '改名后' } },
      },
    ]);

    expect(result.sourcePatch).toEqual({
      values: {
        name: '原始线索',
        source: '官网',
        secret: '内部',
        companyName: '改名后',
        signedOn: '2026-09-01',
        createdAt: '2026-09-01T08:00:00.000Z',
      },
      title: '原始线索',
      ownerMemberId: admin.memberId,
    });
    // The later UPDATE_RECORD keeps composing into the same patch without
    // dropping the earlier ASSIGN_OWNER.
    expect(result.sourcePatch?.ownerMemberId).toBe(admin.memberId);
    expect(result.sourcePatch?.ownerMemberId).not.toBe(OWNER);
    // §14: still one staged patch, still no write, still the snapshot's owner
    // on the stored record.
    expect(store.writeCount).toBe(0);
    expect(store.records[0].ownerMemberId).toBe(OWNER);
    expect(store.records[0].version).toBe(4);
  });

  it('emits no SOURCE_OWNER_ASSIGNED effect — and no audit — when the actor already owns the record', async () => {
    const { run, store, source } = fixture();

    // The Source Record is already owned by the acting member, so this
    // ASSIGN_OWNER changes nothing.
    const alreadyOwned = {
      ...source,
      snapshot: { ...source.snapshot, ownerMemberId: admin.memberId },
    };

    const result = await run([ASSIGN_SOURCE], { source: alreadyOwned });

    // The Action stays legal: it resolves to the same owner and stages the
    // same (unchanged) owner on the patch.
    expect(result.outputs.get('assign-source')).toEqual({
      type: 'ASSIGN_OWNER',
      recordId: SNAPSHOT_ID,
      ownerMemberId: admin.memberId,
    });
    expect(result.sourcePatch?.ownerMemberId).toBe(admin.memberId);
    // A no-op change must not claim that it changed anything: no effect, and
    // therefore no `record.owner_assigned` audit row for the auditor to read.
    expect(result.effects).toEqual([]);
    expect(store.audits.map((event) => event.action)).not.toContain(
      'record.owner_assigned',
    );
  });

  it('validates the patch through the shared prepareSourceRecordPatch', async () => {
    const { run, store } = fixture();

    // The source publication hides `secret` from an EMPLOYEE; the patch must be
    // rejected by the SAME field-permission engine the HTTP update uses.
    const error = await rejection(
      run(
        [
          {
            ...UPDATE_SOURCE,
            values: { secret: { source: 'LITERAL', value: '泄漏' } },
          },
        ],
        {
          context: employee,
          source: {
            objectCode: SOURCE_CODE,
            resolved: resolved(SOURCE_CODE, SOURCE_FIELDS, {
              fields: { ...access().fields, secret: 'HIDDEN' },
            }),
            snapshot: { ...store.records[0] },
          },
        },
      ),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.getStatus()).toBe(403);
    expect(error.fieldErrors).toEqual({
      'actions.update-source.secret': [expect.any(String)],
    });
    expect(store.writeCount).toBe(0);
  });

  it('rejects two Actions writing the same source field', async () => {
    const { run, store } = fixture();

    const error = await rejection(
      run([
        {
          ...UPDATE_SOURCE,
          values: { name: { source: 'LITERAL', value: 'A' } },
        },
        {
          key: 'update-source-2',
          type: 'UPDATE_RECORD',
          target: 'SOURCE_RECORD',
          values: { name: { source: 'LITERAL', value: 'B' } },
        },
      ]),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    // §32: the step is named by its label, not by the admin-authored key.
    expect(error.message).toBe(
      '无法完成“转化”：步骤“更新当前记录”失败。所有变更均未保存。',
    );
    expect(error.message).not.toContain('update-source-2');
    expect(store.writeCount).toBe(0);
  });

  it('requires source update permission and an update scope other than NONE', async () => {
    const { run, store } = fixture();
    const denied = {
      objectCode: SOURCE_CODE,
      resolved: resolved(SOURCE_CODE, SOURCE_FIELDS, { canUpdate: false }),
      snapshot: store.records[0],
    };

    const error = await rejection(run([UPDATE_SOURCE], { source: denied }));

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.getStatus()).toBe(403);
    expect(store.writeCount).toBe(0);

    const none = await rejection(
      run([UPDATE_SOURCE], {
        source: {
          objectCode: SOURCE_CODE,
          resolved: resolved(SOURCE_CODE, SOURCE_FIELDS, {
            canUpdate: true,
            updateScope: 'NONE',
          }),
          snapshot: store.records[0],
        },
      }),
    );
    expect(none.getStatus()).toBe(403);
  });

  it('forbids ASSIGN_OWNER for an EMPLOYEE instead of silently ignoring it (§20, §46.5)', async () => {
    const { run, store } = fixture();
    const employeeSource = {
      objectCode: SOURCE_CODE,
      resolved: resolved(SOURCE_CODE, SOURCE_FIELDS, {
        readScope: 'OWN',
        updateScope: 'OWN',
      }),
      snapshot: store.records[0],
    };

    const error = await rejection(
      run([ASSIGN_SOURCE], {
        context: employee,
        source: employeeSource,
      }),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.getStatus()).toBe(403);
    expect(error.fieldErrors).toEqual({
      'actions.assign-source': [expect.any(String)],
    });
    expect(store.writeCount).toBe(0);
  });

  it('assigns the source record to the acting admin', async () => {
    const { run } = fixture();

    const result = await run([ASSIGN_SOURCE]);

    expect(result.sourcePatch).toMatchObject({
      ownerMemberId: admin.memberId,
      title: '原始线索',
    });
    expect(result.outputs.get('assign-source')).toEqual({
      type: 'ASSIGN_OWNER',
      recordId: SNAPSHOT_ID,
      ownerMemberId: admin.memberId,
    });
  });

  it('keeps UPDATE_RECORD from touching the owner', async () => {
    const { run } = fixture();

    const result = await run([UPDATE_SOURCE]);

    expect(result.sourcePatch?.ownerMemberId).toBe(OWNER);
  });

  it('rejects a second owner-changing ASSIGN_OWNER', async () => {
    const { run } = fixture();

    const error = await rejection(
      run([ASSIGN_SOURCE, { ...ASSIGN_SOURCE, key: 'assign-source-2' }]),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.fieldErrors).toEqual({
      'actions.assign-source-2': [expect.any(String)],
    });
  });

  it('rejects a source patch the actor cannot reach through the update scope', async () => {
    const { run, store } = fixture();
    const otherOwner = resolved(SOURCE_CODE, SOURCE_FIELDS, {
      readScope: 'ALL',
      updateScope: 'OWN',
    });

    const error = await rejection(
      run([UPDATE_SOURCE], {
        context: admin,
        source: {
          objectCode: SOURCE_CODE,
          resolved: otherOwner,
          snapshot: { ...store.records[0], ownerMemberId: null },
        },
      }),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.getStatus()).toBe(404);
  });
});

describe('immutable source snapshot (§13)', () => {
  it('SOURCE_FIELD still reads the pre-Transition value after UPDATE_RECORD', async () => {
    const { run, store } = fixture();

    await run([
      {
        ...UPDATE_SOURCE,
        values: { companyName: { source: 'LITERAL', value: '改名后' } },
      },
      CREATE_CUSTOMER,
    ]);

    // The created record maps `name` from `companyName`; were the engine reading
    // its own accumulated patch, the title would be 改名后.
    expect(store.records[1].title).toBe('白杰科技');
  });

  it('SOURCE_META.title ignores an earlier UPDATE_RECORD of the title field', async () => {
    const { run, store } = fixture();

    await run([
      {
        ...UPDATE_SOURCE,
        values: { name: { source: 'LITERAL', value: '改写' } },
      },
      CREATE_CONTACT,
    ]);

    expect(store.records[1].title).toBe('原始线索');
  });

  it('SOURCE_OWNER reads the pre-Transition owner after ASSIGN_OWNER', async () => {
    const { run, followUpCommand } = fixture();

    await run([
      CREATE_CUSTOMER,
      ASSIGN_SOURCE,
      { ...FOLLOW_UP, assignee: { source: 'SOURCE_OWNER' } },
    ]);

    expect(followUpCommand).toHaveBeenCalledWith(
      expect.anything(),
      admin,
      expect.objectContaining({ assigneeMemberId: OWNER }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('reports a null SOURCE_OWNER as an assignee failure', async () => {
    const { run, store } = fixture();

    const error = await rejection(
      run(
        [
          CREATE_CUSTOMER,
          { ...FOLLOW_UP, assignee: { source: 'SOURCE_OWNER' } },
        ],
        {
          source: {
            objectCode: SOURCE_CODE,
            resolved: resolved(SOURCE_CODE, SOURCE_FIELDS),
            snapshot: { ...store.records[0], ownerMemberId: null },
          },
        },
      ),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.fieldErrors).toEqual({
      'actions.follow-up-call.assignee': [expect.any(String)],
    });
  });
});

describe('CREATE_RELATION executor (§21)', () => {
  it('creates the relation through the shared command with the caller transaction', async () => {
    const { run, relationCommand, tx } = fixture();

    const result = await run([CREATE_CUSTOMER, CREATE_CONTACT, LINK]);

    expect(relationCommand).toHaveBeenCalledTimes(1);
    const [commandTx, context, input, , deps] = relationCommand.mock.calls[0];
    expect(commandTx).toBe(tx);
    expect(context).toBe(admin);
    expect(input).toEqual({
      code: TARGET_CODE,
      id: 'created-1',
      objectCode: CONTACT_CODE,
      recordId: 'created-2',
    });
    expect(deps.audit).toBeDefined();
    expect(typeof deps.resolveScope).toBe('function');
    expect(result.outputs.get('link-customer-contact')).toEqual({
      type: 'CREATE_RELATION',
      relationId: 'relation-1',
    });
  });

  it('treats the SOURCE_RECORD side as the writing side', async () => {
    const { run, relationCommand } = fixture();

    await run([
      CREATE_CUSTOMER,
      CREATE_CONTACT,
      { ...LINK, left: { source: 'SOURCE_RECORD' } },
    ]);

    expect(relationCommand).toHaveBeenCalledWith(
      expect.anything(),
      admin,
      expect.objectContaining({
        code: SOURCE_CODE,
        id: SNAPSHOT_ID,
        objectCode: CONTACT_CODE,
        recordId: 'created-2',
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('passes a transaction-bound scope resolver that re-applies the read gate', async () => {
    // The command's production `resolveScope` opens its own transaction; the
    // engine must instead resolve through the caller's transaction AND keep the
    // HTTP read gate the transaction-bound resolver deliberately omits (§46.3).
    const { run, relationCommand } = fixture({
      resolveObject: objectResolver({
        [CONTACT_CODE]: { canRead: false, readScope: 'NONE' },
      }),
    });

    await run([CREATE_CUSTOMER, CREATE_CONTACT, LINK]);

    const deps = relationCommand.mock.calls[0][4];
    await expect(
      deps.resolveScope(admin, CONTACT_CODE, 'created-2', false),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
  });

  it('re-applies the read gate to an unreadable relation target', async () => {
    const { run, relationCommand } = fixture({
      resolveObject: objectResolver({
        [CONTACT_CODE]: { canRead: false, readScope: 'NONE' },
      }),
    });
    // The command fake applies the injected scope resolver, which is what the
    // production command does before it writes anything.
    relationCommand.mockImplementation(
      async (_tx, context, input, _meta, deps) => {
        await deps.resolveScope(context, input.code, input.id, true);
        await deps.resolveScope(
          context,
          input.objectCode,
          input.recordId,
          false,
        );
        return { success: true as const, relationId: 'relation-1' };
      },
    );

    const error = await rejection(run([CREATE_CUSTOMER, CREATE_CONTACT, LINK]));

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.getStatus()).toBe(403);
  });

  it('rejects a forward record reference', async () => {
    const { run } = fixture();

    const error = await rejection(run([LINK, CREATE_CUSTOMER, CREATE_CONTACT]));

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.fieldErrors).toEqual({
      'actions.link-customer-contact.left': [expect.any(String)],
    });
  });

  it('rejects a forward ACTION_OUTPUT value reference', async () => {
    const { run } = fixture();

    const error = await rejection(
      run([
        {
          key: 'create-customer',
          type: 'CREATE_RECORD',
          targetObjectCode: TARGET_CODE,
          values: {
            name: {
              source: 'ACTION_OUTPUT',
              actionKey: 'create-contact',
              property: 'recordId',
            },
          },
        },
        CREATE_CONTACT,
      ]),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.fieldErrors).toEqual({
      'actions.create-customer.name': [expect.any(String)],
    });
  });
});

describe('CREATE_FOLLOW_UP executor (§22)', () => {
  it('creates the follow-up for the resolved assignee with the caller transaction', async () => {
    const { run, followUpCommand, tx } = fixture();

    const result = await run([CREATE_CUSTOMER, FOLLOW_UP]);

    expect(followUpCommand).toHaveBeenCalledTimes(1);
    const [commandTx, context, input, , scope, deps] =
      followUpCommand.mock.calls[0];
    expect(commandTx).toBe(tx);
    expect(context).toBe(admin);
    expect(input).toEqual({
      recordId: 'created-1',
      title: '回访客户',
      dueAt: '2026-09-19T10:00:00.000Z',
      assigneeMemberId: admin.memberId,
    });
    expect(scope).toMatchObject({
      objectId: 'object-customers',
      recordId: 'created-1',
    });
    expect(deps.audit).toBeDefined();
    expect(result.outputs.get('follow-up-call')).toEqual({
      type: 'CREATE_FOLLOW_UP',
      followUpId: 'follow-up-1',
      recordId: 'created-1',
    });
  });

  it('scopes an OWN target follow-up to the acting member', async () => {
    const { run, followUpCommand } = fixture({
      resolveObject: objectResolver({
        [CONTACT_CODE]: { readScope: 'OWN', updateScope: 'OWN' },
      }),
    });

    await run([CREATE_CONTACT, FOLLOW_UP_ON_CONTACT]);

    expect(followUpCommand).toHaveBeenCalledWith(
      expect.anything(),
      admin,
      expect.objectContaining({ recordId: 'created-1' }),
      expect.anything(),
      expect.objectContaining({
        objectId: 'object-contacts',
        recordId: 'created-1',
        requiredOwnerMemberId: admin.memberId,
      }),
      expect.anything(),
    );
  });

  it('re-applies the read gate to an unreadable follow-up target', async () => {
    const { run } = fixture({
      resolveObject: objectResolver({
        [CONTACT_CODE]: { canRead: false, readScope: 'NONE' },
      }),
    });

    const error = await rejection(run([CREATE_CONTACT, FOLLOW_UP_ON_CONTACT]));

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.getStatus()).toBe(403);
  });

  it('requires update permission on the follow-up target', async () => {
    const { run } = fixture({
      resolveObject: objectResolver({
        [CONTACT_CODE]: { canUpdate: false },
      }),
    });

    const error = await rejection(run([CREATE_CONTACT, FOLLOW_UP_ON_CONTACT]));

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.getStatus()).toBe(403);
  });

  it('rejects a title source that holds no text or is too long', async () => {
    const { run } = fixture();

    const error = await rejection(
      run([
        {
          ...FOLLOW_UP,
          target: { source: 'SOURCE_RECORD' },
          title: { source: 'LITERAL', value: '   ' },
        },
      ]),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.fieldErrors).toEqual({
      'actions.follow-up-call.title': [expect.any(String)],
    });

    const long = await rejection(
      run([
        {
          ...FOLLOW_UP,
          target: { source: 'SOURCE_RECORD' },
          title: { source: 'LITERAL', value: 'x'.repeat(201) },
        },
      ]),
    );
    expect(long.fieldErrors).toEqual({
      'actions.follow-up-call.title': [expect.any(String)],
    });
  });

  it('rejects a dueAt source that is not a date or datetime', async () => {
    const { run } = fixture();

    const error = await rejection(
      run([
        {
          ...FOLLOW_UP,
          target: { source: 'SOURCE_RECORD' },
          dueAt: { source: 'SOURCE_FIELD', fieldKey: 'name' },
        },
      ]),
    );

    expect(error.code).toBe('ACTION_EXECUTION_FAILED');
    expect(error.fieldErrors).toEqual({
      'actions.follow-up-call.dueAt': [expect.any(String)],
    });
  });
});

describe('runtime action errors (§32)', () => {
  it('keeps an outer RECORD_VERSION_CONFLICT out of the action error', async () => {
    const { run, relationCommand } = fixture();
    relationCommand.mockRejectedValue(
      new ApiException('RECORD_VERSION_CONFLICT', 409),
    );

    const error = await rejection(run([CREATE_CUSTOMER, CREATE_CONTACT, LINK]));

    expect(error.code).toBe('RECORD_VERSION_CONFLICT');
    expect(error.getStatus()).toBe(409);
    // The outer Source Record conflict is not an Action failure: it keeps its
    // own code, status and body.
    expect(error.fieldErrors).toEqual({});
    expect(error.message).not.toContain('所有变更均未保存');
    expect(error.message).not.toContain('转化');
  });

  it('keeps a programming error a programming error', async () => {
    const { run, relationCommand } = fixture();
    relationCommand.mockRejectedValue(new TypeError('boom'));

    await expect(run([CREATE_CUSTOMER, CREATE_CONTACT, LINK])).rejects.toThrow(
      TypeError,
    );
  });

  it('names the failing step by Transition and Action label, never by key (§32)', async () => {
    const { run } = fixture({
      resolveObject: objectResolver({
        [TARGET_CODE]: { canCreate: false },
      }),
    });

    const error = await rejection(run([CREATE_CUSTOMER]));

    // §32 punctuation, verbatim: the Transition LABEL and the Action LABEL.
    expect(error.message).toBe(
      '无法完成“转化”：步骤“创建 1 条记录”失败。所有变更均未保存。',
    );
    // §32 / Task 13: the admin-authored keys are not the employee's business.
    expect(error.message).not.toContain('convert');
    expect(error.message).not.toContain('create-customer');
  });

  it('prefers an admin-authored Action label when the snapshot carries one (§32)', async () => {
    const { run } = fixture({
      resolveObject: objectResolver({
        [TARGET_CODE]: { canCreate: false },
      }),
    });
    // V1's published Action shape has no `label`; this mirrors a snapshot that
    // carries one, which is exactly §32's 「创建客户」 example.
    const labelled = {
      ...CREATE_CUSTOMER,
      label: '创建客户',
    } as WorkflowActionDraft;

    const error = await rejection(run([labelled]));

    expect(error.message).toBe(
      '无法完成“转化”：步骤“创建客户”失败。所有变更均未保存。',
    );
  });

  it('falls back to the raw key for a blank label instead of rendering “” (§32)', async () => {
    const { run } = fixture({
      resolveObject: objectResolver({
        [TARGET_CODE]: { canCreate: false },
      }),
    });

    // The published Transition label is required, so a blank one only reaches
    // the engine from a hand-made snapshot; the message must stay sensible.
    const error = await rejection(
      run([CREATE_CUSTOMER], { execution: { transitionLabel: '  ' } }),
    );

    expect(error.message).toBe(
      '无法完成“convert”：步骤“创建 1 条记录”失败。所有变更均未保存。',
    );
    expect(error.message).not.toContain('“”');
  });

  it('does not run later Actions after a failure', async () => {
    const { run, store } = fixture({
      resolveObject: objectResolver({
        [TARGET_CODE]: { canCreate: false },
      }),
    });

    await rejection(run([CREATE_CUSTOMER, CREATE_CONTACT]));

    // Rollback is the caller's transaction (§4); the engine must not stage the
    // later effects either.
    expect(store.records).toHaveLength(1);
  });
});
