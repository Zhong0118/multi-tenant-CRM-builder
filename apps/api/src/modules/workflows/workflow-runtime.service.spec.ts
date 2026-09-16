import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type {
  ActionEngineService,
  ExecuteTransitionActionsInput,
} from '../actions/actions.module';
import type {
  ActionEffectSummary,
  ActionExecutionResult,
} from '../actions/action-engine';
import type { WorkflowActionDraft } from '../actions/action.types';
import type { AuditEvent } from '../audit/audit-event';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type {
  PublishedObjectRecord,
  PublishedObjectRepository,
} from '../objects/published-object.repository';
import { PublishedObjectService } from '../objects/published-object.service';
import type {
  ApplySourceRecordPatchStoreInput,
  DynamicRecord,
  RecordsRepository,
  RecordsStore,
  RecordsTransaction,
} from '../records/records.repository';
import { START_TRANSITION_KEY } from './workflow-runtime';
import { WorkflowRuntimeService } from './workflow-runtime.service';

/**
 * §4 / §23 / §29 / §30 — the atomic execution path.
 *
 * The unit harness models the ONE tenant transaction the repository opens:
 * `withTenantTransaction` snapshots the store, hands the caller both the `tx`
 * and the transaction-bound store, and restores the snapshot when the work
 * throws. That is what makes "a failing Action leaves nothing behind"
 * observable here; Task 10 proves the same thing against real PostgreSQL.
 *
 * A shared journal records every observable step, so the §23 order is asserted
 * as one sequence rather than as isolated call counts.
 */

const employee: TenantContext = {
  userId: 'user-employee',
  tenantId: 'tenant-a',
  tenantCode: 'nebula-demo',
  memberId: 'member-employee',
  role: 'EMPLOYEE',
};

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-a',
  tenantCode: 'nebula-demo',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
};

const meta = { requestId: 'req-runtime', ip: '127.0.0.1' };

class Journal {
  readonly entries: string[] = [];
  record(entry: string) {
    this.entries.push(entry);
  }
}

const UPDATE_AMOUNT: WorkflowActionDraft = {
  key: 'set-amount',
  type: 'UPDATE_RECORD',
  target: 'SOURCE_RECORD',
  values: { amount: { source: 'LITERAL', value: '200.00' } },
};

const ASSIGN_ACTOR: WorkflowActionDraft = {
  key: 'take-ownership',
  type: 'ASSIGN_OWNER',
  target: 'SOURCE_RECORD',
  owner: { source: 'ACTOR' },
};

const CREATE_CUSTOMER: WorkflowActionDraft = {
  key: 'create-customer',
  type: 'CREATE_RECORD',
  targetObjectCode: 'customers',
  values: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
};

function publishedSchema(
  actions: WorkflowActionDraft[],
): PublishedObjectSchema {
  return {
    publication: {
      id: 'publication-leads',
      number: 1,
      sourceDraftVersion: 4,
      publishedAt: '2026-08-21T10:00:00.000Z',
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
      {
        id: 'field-name',
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
        id: 'field-amount',
        fieldKey: 'amount',
        label: '预计金额',
        type: 'MONEY',
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
      name: '全部',
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
      fields: { name: 'EDIT', amount: 'EDIT' },
    },
    workflow: {
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
          allowedRoles: ['EMPLOYEE', 'TENANT_ADMIN'],
          requiredFieldKeys: ['amount'],
          actions,
        },
      ],
    },
  };
}

/** The `findFirst` row `findPublishedObjectInTransaction` maps. */
function objectRow(schema: PublishedObjectSchema) {
  return {
    id: schema.object.id,
    code: schema.object.code,
    status: 'ACTIVE' as const,
    sortOrder: schema.object.sortOrder,
    activePublication: { configuration: schema },
    permissions: [],
  };
}

class MemoryPublishedRepository implements PublishedObjectRepository {
  readonly record: PublishedObjectRecord = {
    id: 'object-leads',
    code: 'leads',
    status: 'ACTIVE',
    sortOrder: 10,
    configuration: publishedSchema([]),
  };

  list() {
    return Promise.resolve([structuredClone(this.record)]);
  }

  findByCode(_context: TenantContext, code: string) {
    return Promise.resolve(
      code === this.record.code ? structuredClone(this.record) : null,
    );
  }
}

interface TransitionHistoryRecord {
  recordId: string;
  transitionKey: string;
  recordVersionBefore: number;
  recordVersionAfter: number;
}

class MemoryRecordsStore implements Partial<RecordsStore> {
  records: DynamicRecord[] = [];
  audits: AuditEvent[] = [];
  history: TransitionHistoryRecord[] = [];
  lockInputs: Array<{
    objectId: string;
    recordId: string;
    ownerMemberId: string | null;
  }> = [];
  transitionCalls: ApplySourceRecordPatchStoreInput[] = [];
  patchCalls: ApplySourceRecordPatchStoreInput[] = [];
  readonly journal: Journal;

  constructor(journal: Journal) {
    this.journal = journal;
  }

  snapshot() {
    return {
      records: structuredClone(this.records),
      audits: structuredClone(this.audits),
      history: structuredClone(this.history),
    };
  }

  restore(snapshot: ReturnType<MemoryRecordsStore['snapshot']>) {
    this.records = snapshot.records;
    this.audits = snapshot.audits;
    this.history = snapshot.history;
  }

  /** True once any write intent ran — the rollback tests read this. */
  get writes(): string[] {
    return this.journal.entries.filter(
      (entry) => entry === 'apply-transition' || entry === 'apply-record-patch',
    );
  }

  lockRecord(input: {
    objectId: string;
    recordId: string;
    ownerMemberId: string | null;
  }) {
    this.journal.record('lock-record');
    this.lockInputs.push({ ...input });
    const record = this.records.find(
      (item) =>
        item.id === input.recordId &&
        item.objectId === input.objectId &&
        item.deletedAt === null,
    );
    if (!record) return Promise.resolve(null);
    if (
      input.ownerMemberId !== null &&
      record.ownerMemberId !== input.ownerMemberId
    ) {
      return Promise.resolve(null);
    }
    // A fresh object, so nothing the caller does to the "snapshot" can reach
    // the stored row without another write intent.
    return Promise.resolve(structuredClone(record));
  }

  applyTransition(input: ApplySourceRecordPatchStoreInput) {
    this.journal.record('apply-transition');
    this.transitionCalls.push(structuredClone(input));
    const record = this.records.find((item) => item.id === input.recordId);
    if (!record || record.version !== input.expectedVersion) {
      return Promise.resolve(null);
    }
    record.values = { ...input.patch.values };
    record.title = input.patch.title;
    record.ownerMemberId = input.patch.ownerMemberId;
    if (input.patch.workflowStateKey !== undefined) {
      record.workflowStateKey = input.patch.workflowStateKey;
    }
    record.version += 1;
    if (input.history) {
      this.history.push({
        recordId: input.recordId,
        transitionKey: input.history.transitionKey,
        recordVersionBefore: input.expectedVersion,
        recordVersionAfter: input.expectedVersion + 1,
      });
    }
    return Promise.resolve(structuredClone(record));
  }

  /**
   * The ordinary-update intent. It takes the unconditional ACTIVE-owner lock,
   * whose one observable consequence here is that a record owned by a member
   * who is no longer ACTIVE is refused. A Transition must NOT reach this.
   */
  applyRecordPatch(input: ApplySourceRecordPatchStoreInput) {
    this.journal.record('apply-record-patch');
    this.patchCalls.push(structuredClone(input));
    this.journal.entries.push('owner-lock-of-offboarded-owner-rejected');
    return Promise.reject(new ApiException('OWNER_INVALID', 400));
  }

  appendAudit(event: AuditEvent) {
    this.journal.record(`audit:${event.action}`);
    this.audits.push(event);
    return Promise.resolve();
  }

  listTransitionHistory(recordId: string) {
    return Promise.resolve({
      items: this.history
        .filter((item) => item.recordId === recordId)
        .map((item, index) => ({
          id: `history-${index}`,
          transitionKey: item.transitionKey,
          transitionLabel: item.transitionKey,
          fromStateKey: null,
          fromStateLabel: null,
          toStateKey: 'new',
          toStateLabel: '新建',
          actorMemberId: employee.memberId,
          actorDisplayName: '员工',
          createdAt: '2026-09-15T10:00:00.000Z',
        })),
      page: 1,
      limit: 20,
      total: this.history.length,
    });
  }

  findRecord(_objectId: string, recordId: string) {
    return Promise.resolve(
      structuredClone(
        this.records.find((item) => item.id === recordId) ?? null,
      ),
    );
  }
}

class MemoryRecordsRepository implements RecordsRepository {
  transactions = 0;

  constructor(
    readonly store: MemoryRecordsStore,
    private readonly tx: Prisma.TransactionClient,
    private readonly journal: Journal,
  ) {}

  withTenant<T>(
    context: TenantContext,
    work: (store: RecordsStore) => Promise<T>,
  ): Promise<T> {
    return this.withTenantTransaction(context, (session) =>
      work(session.store),
    );
  }

  async withTenantTransaction<T>(
    _context: TenantContext,
    work: (session: RecordsTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactions += 1;
    this.journal.record(`transaction:${this.transactions}`);
    const snapshot = this.store.snapshot();
    try {
      return await work({
        tx: this.tx,
        store: this.store as unknown as RecordsStore,
      });
    } catch (error) {
      // §4: the transaction rolls back — everything written inside is undone.
      this.store.restore(snapshot);
      throw error;
    }
  }
}

class MemoryActionEngine implements Partial<ActionEngineService> {
  readonly calls: ExecuteTransitionActionsInput[] = [];
  result: ActionExecutionResult = {
    outputs: new Map(),
    sourcePatch: null,
    effects: [],
  };
  failure: Error | null = null;
  beforeExecute?: (input: ExecuteTransitionActionsInput) => void;

  execute(
    input: ExecuteTransitionActionsInput,
  ): Promise<ActionExecutionResult> {
    this.calls.push(input);
    this.journal.record('execute-actions');
    this.beforeExecute?.(input);
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.result);
  }

  constructor(private readonly journal: Journal) {}
}

interface FixtureOptions {
  record?: Partial<DynamicRecord>;
  actions?: WorkflowActionDraft[];
  context?: TenantContext;
  /** Mutates the source publication before it is served. */
  configure?: (schema: PublishedObjectSchema) => void;
  /** `null` makes the published object disappear mid-flight. */
  sourceRow?: boolean;
  actorRows?: Array<{ role: string }>;
  effects?: ActionEffectSummary[];
  sourcePatch?: ActionExecutionResult['sourcePatch'];
}

function ownedRecord(overrides: Partial<DynamicRecord> = {}): DynamicRecord {
  return {
    id: 'record-1',
    objectId: 'object-leads',
    recordNo: 1n,
    ownerMemberId: employee.memberId,
    workflowStateKey: 'new',
    title: '张三',
    values: { name: '张三', amount: '100.00' },
    version: 7,
    createdByMemberId: employee.memberId,
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function fixture(options: FixtureOptions = {}) {
  const context = options.context ?? employee;
  const journal = new Journal();
  const schema = publishedSchema(options.actions ?? []);
  options.configure?.(schema);

  const store = new MemoryRecordsStore(journal);
  store.records.push(ownedRecord(options.record));

  const tx = {
    $queryRaw: () => {
      journal.record('lock-actor');
      return Promise.resolve(options.actorRows ?? [{ role: context.role }]);
    },
    objectDefinition: {
      findFirst: () => {
        journal.record('resolve-source-object');
        return Promise.resolve(
          options.sourceRow === false ? null : objectRow(schema),
        );
      },
    },
  } as unknown as Prisma.TransactionClient;

  const repository = new MemoryRecordsRepository(store, tx, journal);
  const published = new MemoryPublishedRepository();
  published.record.configuration = schema;

  const engine = new MemoryActionEngine(journal);
  engine.result = {
    outputs: new Map(),
    sourcePatch: options.sourcePatch ?? null,
    effects: options.effects ?? [],
  };

  const service = new WorkflowRuntimeService(
    new PublishedObjectService(published),
    repository,
    engine as unknown as ActionEngineService,
  );

  return {
    service,
    store,
    repository,
    engine,
    journal,
    tx,
    published,
    schema,
  };
}

function lastRecord(store: MemoryRecordsStore, recordId = 'record-1') {
  return store.records.find((item) => item.id === recordId)!;
}

describe('WorkflowRuntimeService.execute — §23 atomic execution', () => {
  it('runs the whole §23 sequence inside ONE tenant transaction', async () => {
    const { service, journal, repository } = fixture({
      actions: [CREATE_CUSTOMER, UPDATE_AMOUNT, ASSIGN_ACTOR],
      effects: [
        {
          actionKey: 'create-customer',
          type: 'CREATE_RECORD',
          effect: 'RECORD_CREATED',
          recordId: 'record-new',
        },
        {
          actionKey: 'set-amount',
          type: 'UPDATE_RECORD',
          effect: 'SOURCE_RECORD_UPDATED',
          recordId: 'record-1',
        },
        {
          actionKey: 'take-ownership',
          type: 'ASSIGN_OWNER',
          effect: 'SOURCE_OWNER_ASSIGNED',
          recordId: 'record-1',
        },
      ],
      sourcePatch: {
        values: { name: '张三', amount: '200.00' },
        title: '张三',
        ownerMemberId: employee.memberId,
      },
    });

    await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    // §23: resolve source publication → lock/re-check actor → lock source record
    // → version check → resolve transition → execute actions → apply the source
    // patch + next state → history/audits — all inside the one transaction.
    expect(journal.entries).toEqual([
      'transaction:1',
      'resolve-source-object',
      'lock-actor',
      'lock-record',
      'execute-actions',
      'apply-transition',
      'audit:record.updated',
      'audit:record.owner_assigned',
      'audit:record.transition_executed',
    ]);
    expect(repository.transactions).toBe(1);
  });

  it('executes the published actions in published order with the real actor context', async () => {
    const { service, engine, tx } = fixture({
      actions: [CREATE_CUSTOMER, UPDATE_AMOUNT, ASSIGN_ACTOR],
    });

    await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    const call = engine.calls[0];
    expect(call.actions.map((action) => action.key)).toEqual([
      'create-customer',
      'set-amount',
      'take-ownership',
    ]);
    // §5: the Action runs as the real actor, with no elevation and inside the
    // same transaction the repository opened.
    expect(call.context).toBe(employee);
    expect(call.execution.transitionKey).toBe('mark-won');
    expect(call.tx).toBe(tx);
  });

  it('hands the engine the immutable pre-Transition snapshot, untouched', async () => {
    const { service, engine, store } = fixture({
      actions: [UPDATE_AMOUNT],
      sourcePatch: {
        values: { name: '张三', amount: '200.00' },
        title: '张三',
        ownerMemberId: employee.memberId,
      },
    });

    await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    const snapshot = engine.calls[0].source.snapshot;
    // §13: the snapshot is the pre-Transition record — old state, old values,
    // old version — even though the very same transition patched the amount.
    expect(snapshot).toEqual(ownedRecord());
    expect(engine.calls[0].source.objectCode).toBe('leads');
    expect(engine.calls[0].source.resolved.schema.object.code).toBe('leads');
    // The snapshot object itself was not mutated by the write that followed.
    expect(snapshot.version).toBe(7);
    expect(snapshot.workflowStateKey).toBe('new');
    expect(snapshot.values.amount).toBe('100.00');
    expect(lastRecord(store).version).toBe(8);
  });

  it('stops on a stale expectedVersion before any action runs', async () => {
    const { service, store, engine, journal } = fixture({
      actions: [CREATE_CUSTOMER],
    });

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 6 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });

    // §29: the retry created nothing downstream and left no trace.
    expect(engine.calls).toEqual([]);
    expect(journal.entries).not.toContain('execute-actions');
    expect(store.transitionCalls).toEqual([]);
    expect(store.history).toEqual([]);
    expect(store.audits).toEqual([]);
    expect(lastRecord(store).version).toBe(7);
    expect(lastRecord(store).workflowStateKey).toBe('new');
  });

  it('propagates RECORD_VERSION_CONFLICT unchanged when the guarded write loses the race', async () => {
    const { service, store, engine } = fixture({ actions: [UPDATE_AMOUNT] });
    // The row moved after the lock but before the guarded write.
    engine.beforeExecute = () => {
      store.records[0].version = 8;
    };

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });
    expect(store.transitionCalls).toHaveLength(1);
    expect(store.history).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it('writes the source record once, with exactly one version bump', async () => {
    const { service, store } = fixture({
      actions: [UPDATE_AMOUNT],
      sourcePatch: {
        values: { name: '张三', amount: '200.00' },
        title: '张三',
        ownerMemberId: employee.memberId,
      },
    });

    const result = await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    // §14/§23: ONE write intent, guarded by the requested version, carrying the
    // accumulated patch AND the next state, moving the version by exactly one.
    expect(store.transitionCalls).toHaveLength(1);
    expect(store.transitionCalls[0].expectedVersion).toBe(7);
    expect(store.transitionCalls[0].patch).toMatchObject({
      values: { name: '张三', amount: '200.00' },
      workflowStateKey: 'won',
    });
    expect(lastRecord(store).version).toBe(8);
    expect(result.recordVersion).toBe(8);
    expect(result.currentState?.key).toBe('won');
  });

  it('carries the snapshot values when no action touched the source record', async () => {
    const { service, store } = fixture({ actions: [CREATE_CUSTOMER] });

    await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    expect(store.transitionCalls[0].patch).toEqual({
      values: { name: '张三', amount: '100.00' },
      title: '张三',
      ownerMemberId: employee.memberId,
      workflowStateKey: 'won',
    });
  });

  it('writes exactly one Transition History row whose versions differ by 1', async () => {
    const { service, store } = fixture({ actions: [UPDATE_AMOUNT] });

    await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    expect(store.history).toHaveLength(1);
    expect(store.history[0]).toMatchObject({
      recordId: 'record-1',
      transitionKey: 'mark-won',
      recordVersionBefore: 7,
      recordVersionAfter: 8,
    });
  });

  it('appends the §30 source-mutation audits with action correlation, then the transition audit', async () => {
    const { service, store, engine } = fixture({
      actions: [UPDATE_AMOUNT, ASSIGN_ACTOR, CREATE_CUSTOMER],
      sourcePatch: {
        values: { name: '张三', amount: '200.00' },
        title: '张三',
        ownerMemberId: employee.memberId,
      },
      effects: [
        {
          actionKey: 'create-customer',
          type: 'CREATE_RECORD',
          effect: 'RECORD_CREATED',
          recordId: 'record-new',
        },
        {
          actionKey: 'set-amount',
          type: 'UPDATE_RECORD',
          effect: 'SOURCE_RECORD_UPDATED',
          recordId: 'record-1',
        },
        {
          actionKey: 'take-ownership',
          type: 'ASSIGN_OWNER',
          effect: 'SOURCE_OWNER_ASSIGNED',
          recordId: 'record-1',
        },
      ],
    });

    await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    const executionId = engine.calls[0].execution.workflowExecutionId;
    expect(executionId).toEqual(expect.any(String));
    expect(executionId.length).toBeGreaterThan(0);

    // A1/T8a: the engine writes no source audit; the patch applier does, one per
    // source-mutating Action, each carrying the §30 correlation. The
    // `record.created` of an Action-created record stays the domain command's.
    expect(store.audits.map((event) => event.action)).toEqual([
      'record.updated',
      'record.owner_assigned',
      'record.transition_executed',
    ]);
    expect(store.audits[0]).toMatchObject({
      resourceType: 'record',
      resourceId: 'record-1',
      actorType: 'USER',
      actorId: employee.userId,
      requestId: meta.requestId,
      ip: meta.ip,
      before: { version: 7 },
      after: {
        version: 8,
        workflowExecutionId: executionId,
        transitionKey: 'mark-won',
        actionKey: 'set-amount',
        actionType: 'UPDATE_RECORD',
      },
    });
    expect(store.audits[0].after).toMatchObject({
      values: { amount: '200.00' },
    });
    expect(store.audits[1]).toMatchObject({
      after: {
        workflowExecutionId: executionId,
        transitionKey: 'mark-won',
        actionKey: 'take-ownership',
        actionType: 'ASSIGN_OWNER',
        ownerMemberId: employee.memberId,
      },
    });
  });

  it('appends the transition audit with execution id, states, versions and actionCount', async () => {
    const { service, store, engine } = fixture({
      actions: [UPDATE_AMOUNT, ASSIGN_ACTOR],
    });

    await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    const executionId = engine.calls[0].execution.workflowExecutionId;
    const transitionAudit = store.audits.at(-1)!;
    expect(transitionAudit.action).toBe('record.transition_executed');
    expect(transitionAudit.after).toEqual({
      objectCode: 'leads',
      transitionKey: 'mark-won',
      fromStateKey: 'new',
      toStateKey: 'won',
      recordVersionBefore: 7,
      recordVersionAfter: 8,
      actionCount: 2,
      workflowExecutionId: executionId,
    });
  });

  it('rolls the whole Transition back when an action fails', async () => {
    const failure = new ApiException('ACTION_EXECUTION_FAILED', 400);
    const { service, store, engine } = fixture({
      actions: [CREATE_CUSTOMER, UPDATE_AMOUNT],
      sourcePatch: {
        values: { name: '张三', amount: '200.00' },
        title: '张三',
        ownerMemberId: employee.memberId,
      },
    });
    engine.beforeExecute = (input) => {
      // Downstream artefacts of an Action that already succeeded, plus its
      // domain audit — all inside the same transaction the service owns.
      void input;
      store.records.push(ownedRecord({ id: 'record-new', recordNo: 2n }));
      store.audits.push({
        tenantId: employee.tenantId,
        actorType: 'USER',
        actorId: employee.userId,
        action: 'record.created',
        resourceType: 'record',
        resourceId: 'record-new',
        requestId: meta.requestId,
      });
    };
    engine.failure = failure;

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toBe(failure);

    // §4: created records, the source patch, the state change, the History row
    // and every successful-looking audit are gone.
    expect(store.records.map((record) => record.id)).toEqual(['record-1']);
    expect(store.audits).toEqual([]);
    expect(store.history).toEqual([]);
    expect(store.transitionCalls).toEqual([]);
    expect(lastRecord(store)).toEqual(ownedRecord());
  });

  it('writes nothing at all before a failing action returns', async () => {
    const failure = new ApiException('ACTION_EXECUTION_FAILED', 400);
    const { service, store, engine } = fixture({ actions: [CREATE_CUSTOMER] });
    engine.failure = failure;

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toBe(failure);

    // The source write and the audits come strictly after the Actions: if the
    // patch were applied first, this list would not be empty.
    expect(store.writes).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it('writes the source record through the Transition intent, not the ordinary one', async () => {
    // An admin advancing a record whose owner has been offboarded: the ordinary
    // update intent re-locks the ACTIVE owner and would refuse (OWNER_INVALID).
    const { service, store } = fixture({
      record: { ownerMemberId: 'member-offboarded' },
      context: admin,
    });

    const result = await service.execute(
      admin,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    expect(result.currentState?.key).toBe('won');
    expect(store.patchCalls).toEqual([]);
    expect(store.transitionCalls).toHaveLength(1);
    expect(store.lockInputs[0]).toEqual({
      objectId: 'object-leads',
      recordId: 'record-1',
      ownerMemberId: null,
    });
  });

  it("keeps the OWN update scope: another member's record is not found", async () => {
    const { service, engine } = fixture({
      record: { ownerMemberId: 'member-other' },
    });

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(engine.calls).toEqual([]);
  });

  it('re-checks and locks the acting membership inside the transaction', async () => {
    const { service, engine, store } = fixture({ actorRows: [] });

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    expect(engine.calls).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  it('keeps the source read gate the HTTP path applies', async () => {
    const { service, engine } = fixture({
      configure: (schema) => {
        schema.employeeAccess.canRead = false;
      },
    });

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
    expect(engine.calls).toEqual([]);
  });

  it('rejects execute when update is revoked', async () => {
    const { service, engine } = fixture({
      configure: (schema) => {
        schema.employeeAccess.canUpdate = false;
        schema.employeeAccess.updateScope = 'NONE';
      },
    });

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'WORKFLOW_TRANSITION_FORBIDDEN' });
    expect(engine.calls).toEqual([]);
  });

  it('rejects a missing published object before anything else', async () => {
    const { service, engine } = fixture({ sourceRow: false });

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(engine.calls).toEqual([]);
  });

  it('runs the state/role/required-field checks from the published snapshot', async () => {
    const { service, engine } = fixture({
      record: { values: { name: '张三', amount: null } },
    });

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'WORKFLOW_REQUIRED_FIELDS_MISSING' });
    expect(engine.calls).toEqual([]);
  });

  it('keeps a plain transition with no actions exactly as it was', async () => {
    const { service, store } = fixture();

    const result = await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    expect(result.currentState?.key).toBe('won');
    expect(store.history).toHaveLength(1);
    expect(store.audits.map((event) => event.action)).toEqual([
      'record.transition_executed',
    ]);
    expect(store.audits[0].after).toMatchObject({ actionCount: 0 });
  });

  it('keeps the legacy start transition unchanged', async () => {
    const { service, store, engine } = fixture({
      record: { workflowStateKey: null },
    });

    const result = await service.execute(
      employee,
      'leads',
      'record-1',
      START_TRANSITION_KEY,
      { expectedVersion: 7 },
      meta,
    );

    expect(result.currentState?.key).toBe('new');
    expect(store.audits.map((event) => event.action)).toEqual([
      'record.workflow_started',
    ]);
    expect(engine.calls[0].actions).toEqual([]);
  });
});

/**
 * §32 / §36 — a lock-order deadlock between two concurrent Transitions must not
 * surface as a vague 500. This is the shape a real deadlock produces through
 * `@prisma/adapter-pg`: `P2010` ("raw query failed") carrying the driver's own
 * SQLSTATE in `meta.driverAdapterError.cause.originalCode` (verified against
 * PostgreSQL with the real client, not assumed).
 */
function writeConflict(): Error {
  return Object.assign(
    new Error('Raw query failed. Code: `40P01`. Message: `deadlock detected`'),
    {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '40P01',
            originalMessage: 'deadlock detected',
            kind: 'postgres',
          },
        },
      },
    },
  );
}

describe('WorkflowRuntimeService.execute — bounded write-conflict retry (§32, §36)', () => {
  it('retries the whole transaction when the first attempt is aborted by a write conflict', async () => {
    const { service, store, repository } = fixture({
      actions: [ASSIGN_ACTOR],
      effects: [
        {
          actionKey: 'take-ownership',
          type: 'ASSIGN_OWNER',
          effect: 'SOURCE_OWNER_ASSIGNED',
          recordId: 'record-1',
        },
      ],
      sourcePatch: {
        values: { name: '张三', amount: '100.00' },
        title: '张三',
        ownerMemberId: employee.memberId,
      },
    });
    // The conflict hits the FIRST audit of the first attempt, i.e. after that
    // attempt already applied the record patch and its History row — the
    // strongest point to observe that the whole attempt rolled back.
    const appendAudit = store.appendAudit.bind(store);
    let audits = 0;
    jest.spyOn(store, 'appendAudit').mockImplementation((event) => {
      audits += 1;
      if (audits === 1) return Promise.reject(writeConflict());
      return appendAudit(event);
    });

    const result = await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    // Two attempts, one committed: nothing from the aborted attempt survives.
    expect(repository.transactions).toBe(2);
    expect(lastRecord(store).version).toBe(8);
    expect(result.recordVersion).toBe(8);
    expect(store.history).toHaveLength(1);
    expect(store.audits.map((event) => event.action)).toEqual([
      'record.owner_assigned',
      'record.transition_executed',
    ]);
  });

  it('writes no record.owner_assigned audit when the engine reports no owner change', async () => {
    // An ASSIGN_OWNER that leaves the owner as it was returns no
    // SOURCE_OWNER_ASSIGNED effect, and this path must then write no
    // `record.owner_assigned` row: the audit trail may not claim a change that
    // did not happen.
    const { service, store } = fixture({
      actions: [ASSIGN_ACTOR],
      effects: [],
    });

    await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );

    expect(store.audits.map((event) => event.action)).toEqual([
      'record.transition_executed',
    ]);
  });

  it('does not retry a failure that is not a write conflict', async () => {
    const { service, store, repository } = fixture({ actions: [ASSIGN_ACTOR] });
    const failure = new ApiException('RECORD_NOT_FOUND', 404);
    jest
      .spyOn(store, 'lockRecord')
      .mockImplementation((): Promise<never> => Promise.reject(failure));

    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toBe(failure);
    expect(repository.transactions).toBe(1);
  });

  it('gives up after the bounded attempts and rethrows the original conflict', async () => {
    const { service, store, repository } = fixture({ actions: [ASSIGN_ACTOR] });
    const conflict = writeConflict();
    jest
      .spyOn(store, 'lockRecord')
      .mockImplementation((): Promise<never> => Promise.reject(conflict));

    // No wrong success and no silent swallow: the caller sees the conflict.
    await expect(
      service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).rejects.toBe(conflict);
    expect(repository.transactions).toBe(3);
    expect(store.history).toEqual([]);
    expect(lastRecord(store).version).toBe(7);
  });
});

/**
 * §31 — the lightweight `executionSummary` of the execute response.
 *
 * Asserted on the serialized body: that is the JSON a client receives, and it
 * is also the exact byte string the leakage assertion scans below.
 */
interface ExecutionSummaryActionBody {
  type: string;
  label: string;
}

interface ExecutionSummaryBody {
  workflowExecutionId: string;
  transitionKey: string;
  actions: ExecutionSummaryActionBody[];
}

function responseBody(view: object): {
  availableTransitions: Array<
    Record<string, unknown> & { effects?: ExecutionSummaryActionBody[] }
  >;
  executionSummary?: ExecutionSummaryBody;
} {
  return JSON.parse(JSON.stringify(view)) as {
    availableTransitions: Array<
      Record<string, unknown> & { effects?: ExecutionSummaryActionBody[] }
    >;
    executionSummary?: ExecutionSummaryBody;
  };
}

/**
 * One of every V1 Action type, each carrying the internals §31 forbids the
 * execution summary from echoing: a hidden field key (`phone`), the mapping
 * sources, a mapped value (`200.00`), a follow-up title and the Target Object
 * code (`customers`).
 */
const LEAKY_SUMMARY_ACTIONS: WorkflowActionDraft[] = [
  CREATE_CUSTOMER,
  UPDATE_AMOUNT,
  ASSIGN_ACTOR,
  {
    key: 'link-customer',
    type: 'CREATE_RELATION',
    left: { source: 'SOURCE_RECORD' },
    right: {
      source: 'ACTION_OUTPUT',
      actionKey: 'create-customer',
      property: 'recordId',
    },
  },
  {
    key: 'follow-up',
    type: 'CREATE_FOLLOW_UP',
    target: { source: 'SOURCE_RECORD' },
    title: { source: 'LITERAL', value: '首次回访' },
    dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
    assignee: { source: 'ACTOR' },
  },
];

describe('WorkflowRuntimeService.execute — §31 execution summary', () => {
  it('summarises the executed actions under the audited execution id', async () => {
    const { service, store } = fixture({
      actions: [CREATE_CUSTOMER, UPDATE_AMOUNT],
      effects: [
        {
          actionKey: 'create-customer',
          type: 'CREATE_RECORD',
          effect: 'RECORD_CREATED',
          recordId: 'record-new',
        },
        {
          actionKey: 'set-amount',
          type: 'UPDATE_RECORD',
          effect: 'SOURCE_RECORD_UPDATED',
          recordId: 'record-1',
        },
      ],
      sourcePatch: {
        values: { name: '张三', amount: '200.00' },
        title: '张三',
        ownerMemberId: employee.memberId,
      },
    });

    const result = await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );
    const summary = responseBody(result).executionSummary;

    expect(summary?.workflowExecutionId).toEqual(expect.any(String));
    expect(summary?.transitionKey).toBe('mark-won');
    expect(summary?.actions).toEqual([
      { type: 'CREATE_RECORD', label: '创建 1 条记录' },
      { type: 'UPDATE_RECORD', label: '更新当前记录' },
    ]);
    // §30: the summary names the same execution id the audit trail carries.
    expect(
      store.audits.find(
        (event) => event.action === 'record.transition_executed',
      )?.after,
    ).toMatchObject({
      workflowExecutionId: summary?.workflowExecutionId,
      transitionKey: 'mark-won',
    });
  });

  it('keeps field keys, mappings, values and object codes out of the summary (§31)', async () => {
    const { service } = fixture({
      actions: LEAKY_SUMMARY_ACTIONS,
      sourcePatch: {
        values: { name: '张三', amount: '200.00' },
        title: '张三',
        ownerMemberId: employee.memberId,
      },
    });

    const result = await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );
    const serialized = JSON.stringify(responseBody(result).executionSummary);

    for (const secret of [
      'phone',
      'customers',
      'customer',
      '200.00',
      'SOURCE_FIELD',
      'SOURCE_RECORD',
      'LITERAL',
      'NOW_PLUS_DAYS',
      'ACTION_OUTPUT',
      'recordId',
      '首次回访',
      'create-customer',
      'set-amount',
      'take-ownership',
      'values',
      'name',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // The summary still names what happened, per Action, in execution order.
    expect(
      responseBody(result).executionSummary?.actions.map((a) => a.type),
    ).toEqual([
      'CREATE_RECORD',
      'UPDATE_RECORD',
      'ASSIGN_OWNER',
      'CREATE_RELATION',
      'CREATE_FOLLOW_UP',
    ]);
  });

  it('returns an empty action list when the transition has no actions', async () => {
    const { service } = fixture();

    const summary = responseBody(
      await service.execute(
        employee,
        'leads',
        'record-1',
        'mark-won',
        { expectedVersion: 7 },
        meta,
      ),
    ).executionSummary;

    // Present but empty, never omitted: the field is additive and a consumer
    // can always read `actions`.
    expect(summary).toBeDefined();
    expect(summary?.workflowExecutionId).toEqual(expect.any(String));
    expect(summary?.transitionKey).toBe('mark-won');
    expect(summary?.actions).toEqual([]);
  });

  it('summarises the synthetic start transition under its own key', async () => {
    const { service } = fixture({ record: { workflowStateKey: null } });

    const summary = responseBody(
      await service.execute(
        employee,
        'leads',
        'record-1',
        START_TRANSITION_KEY,
        { expectedVersion: 7 },
        meta,
      ),
    ).executionSummary;

    expect(summary?.workflowExecutionId).toEqual(expect.any(String));
    expect(summary?.transitionKey).toBe(START_TRANSITION_KEY);
    expect(summary?.actions).toEqual([]);
  });
});

describe('WorkflowRuntimeService read paths', () => {
  it('still reads the runtime view through the read-gated resolver', async () => {
    const { service } = fixture();

    const view = await service.get(employee, 'leads', 'record-1');

    expect(view.currentState?.key).toBe('new');
    expect(view.recordVersion).toBe(7);
    expect(view.availableTransitions.map((item) => item.key)).toEqual([
      'mark-won',
    ]);
  });

  it('keeps the GET body free of an execution summary (§31, §35)', async () => {
    const { service } = fixture({ actions: [UPDATE_AMOUNT] });

    const body = responseBody(await service.get(employee, 'leads', 'record-1'));

    // Nothing was executed by a read, so the field is absent — a client written
    // against the pre-Task-11 body sees exactly the shape it saw before.
    expect(body).not.toHaveProperty('executionSummary');
    // The static effect summary is additive and lives on both paths.
    expect(body.availableTransitions[0].effects).toEqual([
      { type: 'UPDATE_RECORD', label: '更新当前记录' },
    ]);
  });
});
