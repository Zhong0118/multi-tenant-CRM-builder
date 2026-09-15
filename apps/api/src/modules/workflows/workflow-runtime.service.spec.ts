import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type {
  PublishedObjectRecord,
  PublishedObjectRepository,
} from '../objects/published-object.repository';
import { PublishedObjectService } from '../objects/published-object.service';
import type {
  DynamicRecord,
  RecordsRepository,
  RecordsStore,
} from '../records/records.repository';
import { START_TRANSITION_KEY } from './workflow-runtime';
import { WorkflowRuntimeService } from './workflow-runtime.service';

const employee: TenantContext = {
  userId: 'user-employee',
  tenantId: 'tenant-a',
  tenantCode: 'nebula-demo',
  memberId: 'member-employee',
  role: 'EMPLOYEE',
};

const meta = { requestId: 'req-runtime', ip: '127.0.0.1' };

function publishedSchema(): PublishedObjectSchema {
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
        },
      ],
    },
  };
}

class MemoryPublishedRepository implements PublishedObjectRepository {
  readonly record: PublishedObjectRecord = {
    id: 'object-leads',
    code: 'leads',
    status: 'ACTIVE',
    sortOrder: 10,
    configuration: publishedSchema(),
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

class MemoryRecordsStore implements Partial<RecordsStore> {
  records: DynamicRecord[] = [];
  audits: AuditEvent[] = [];
  history: Array<{ recordId: string; transitionKey: string }> = [];

  findRecord(_objectId: string, recordId: string) {
    return Promise.resolve(
      this.records.find((record) => record.id === recordId) ?? null,
    );
  }

  applyWorkflowTransition(input: {
    recordId: string;
    expectedVersion: number;
    workflowStateKey: string;
    history: { transitionKey: string };
  }) {
    const record = this.records.find((item) => item.id === input.recordId);
    if (!record || record.version !== input.expectedVersion) {
      return Promise.resolve(null);
    }
    record.workflowStateKey = input.workflowStateKey;
    record.version += 1;
    this.history.push({
      recordId: input.recordId,
      transitionKey: input.history.transitionKey,
    });
    return Promise.resolve(structuredClone(record));
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

  appendAudit(event: AuditEvent) {
    this.audits.push(event);
    return Promise.resolve();
  }
}

class MemoryRecordsRepository implements RecordsRepository {
  constructor(readonly store: MemoryRecordsStore) {}
  withTenant<T>(
    _context: TenantContext,
    work: (store: RecordsStore) => Promise<T>,
  ) {
    return work(this.store as unknown as RecordsStore);
  }
}

function fixture(record: DynamicRecord) {
  const published = new MemoryPublishedRepository();
  const store = new MemoryRecordsStore();
  store.records.push(record);
  const service = new WorkflowRuntimeService(
    new PublishedObjectService(published),
    new MemoryRecordsRepository(store),
  );
  return { service, store, published };
}

function ownedRecord(
  overrides: Partial<DynamicRecord> = {},
): DynamicRecord {
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

describe('WorkflowRuntimeService', () => {
  it('executes a valid transition and writes history', async () => {
    const { service, store } = fixture(ownedRecord());
    const result = await service.execute(
      employee,
      'leads',
      'record-1',
      'mark-won',
      { expectedVersion: 7 },
      meta,
    );
    expect(result.currentState?.key).toBe('won');
    expect(store.history[0]?.transitionKey).toBe('mark-won');
    expect(store.audits.map((event) => event.action)).toEqual([
      'record.transition_executed',
    ]);
  });

  it('starts a legacy record', async () => {
    const { service, store } = fixture(
      ownedRecord({ workflowStateKey: null }),
    );
    const result = await service.execute(
      employee,
      'leads',
      'record-1',
      START_TRANSITION_KEY,
      { expectedVersion: 7 },
      meta,
    );
    expect(result.currentState?.key).toBe('new');
    expect(store.audits[0]?.action).toBe('record.workflow_started');
  });

  it('rejects a stale version', async () => {
    const { service } = fixture(ownedRecord());
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
  });

  it('rejects execute when update is revoked', async () => {
    const { service, published } = fixture(ownedRecord());
    const configuration = published.record
      .configuration as PublishedObjectSchema;
    configuration.employeeAccess.canUpdate = false;
    configuration.employeeAccess.updateScope = 'NONE';
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
  });
});
