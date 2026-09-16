import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { WorkflowActionDraft } from '../actions/action.types';
import { WorkflowAdminService } from './workflow-admin.service';
import type {
  WorkflowRepository,
  WorkflowStore,
} from './workflow.repository';
import type { WorkflowDraft, WorkflowDraftResponse } from './workflow.types';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-1',
  tenantCode: 'nebula-demo',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
};

const employee: TenantContext = {
  ...admin,
  userId: 'user-employee',
  memberId: 'member-employee',
  role: 'EMPLOYEE',
};

const meta = { requestId: 'req-workflow', ip: '127.0.0.1' };

const validDraft: WorkflowDraft = {
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
      allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
      requiredFieldKeys: ['amount'],
      sortOrder: 10,
    },
  ],
};

/** Two ordered Action steps: an UPDATE_RECORD followed by an ASSIGN_OWNER. */
const orderedActions: WorkflowActionDraft[] = [
  {
    key: 'update-source',
    type: 'UPDATE_RECORD',
    target: 'SOURCE_RECORD',
    values: { note: { source: 'LITERAL', value: '已转化' } },
  },
  {
    key: 'assign-actor',
    type: 'ASSIGN_OWNER',
    target: 'SOURCE_RECORD',
    owner: { source: 'ACTOR' },
  },
];

const actionsDraft: WorkflowDraft = {
  ...validDraft,
  transitions: validDraft.transitions.map((transition) => ({
    ...transition,
    actions: orderedActions,
  })),
};

class MemoryWorkflowStore implements WorkflowStore {
  object = {
    id: 'object-1',
    version: 12,
    fieldKeys: ['amount', 'name'],
  };
  draft: WorkflowDraft | null = null;
  audits: Array<{ action: string }> = [];

  findObjectVersion(objectId: string) {
    return Promise.resolve(objectId === this.object.id ? this.object : null);
  }

  findDraft() {
    return Promise.resolve(this.draft);
  }

  replaceDraft(input: {
    objectId: string;
    expectedVersion: number;
    draft: WorkflowDraft;
  }): Promise<WorkflowDraftResponse | null> {
    if (input.expectedVersion !== this.object.version) return Promise.resolve(null);
    this.draft = this.snapshot(input.draft);
    this.object.version += 1;
    return Promise.resolve({
      ...this.snapshot(input.draft),
      objectVersion: this.object.version,
    });
  }

  appendAudit(event: { action: string }) {
    this.audits.push(event);
    return Promise.resolve();
  }

  /**
   * The Prisma store persists a draft through JSONB columns. Keeping object
   * references here would let a round-trip assertion pass without ever crossing
   * that boundary, so the fake goes through JSON too: `undefined` disappears and
   * array order is whatever the serializer preserves.
   */
  private snapshot(draft: WorkflowDraft): WorkflowDraft {
    return JSON.parse(JSON.stringify(draft)) as WorkflowDraft;
  }
}

class MemoryWorkflowRepository implements WorkflowRepository {
  constructor(readonly store: MemoryWorkflowStore) {}

  withTenant<T>(
    _context: TenantContext,
    work: (store: WorkflowStore) => Promise<T>,
  ): Promise<T> {
    return work(this.store);
  }
}

async function expectRejected(
  pending: Promise<unknown>,
  code: string,
  status: number,
) {
  try {
    await pending;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException);
    const exception = error as ApiException;
    expect(exception.code).toBe(code);
    expect(exception.getStatus()).toBe(status);
  }
}

function fixture() {
  const store = new MemoryWorkflowStore();
  const service = new WorkflowAdminService(new MemoryWorkflowRepository(store));
  return { service, store };
}

describe('WorkflowAdminService', () => {
  it('rejects employee updates', async () => {
    const { service } = fixture();
    await expectRejected(
      service.save(
        employee,
        'object-1',
        { ...validDraft, expectedDraftRevision: 12 },
        meta,
      ),
      'OBJECT_ACTION_FORBIDDEN',
      403,
    );
  });

  it('hides objects that are not in the current tenant store', async () => {
    const { service } = fixture();
    await expectRejected(
      service.get(admin, 'object-other'),
      'OBJECT_NOT_FOUND',
      404,
    );
  });

  it('rejects duplicate transition keys', async () => {
    const { service } = fixture();
    await expect(
      service.save(
        admin,
        'object-1',
        {
          ...validDraft,
          expectedDraftRevision: 12,
          states: [
            ...validDraft.states,
            { key: 'lost', label: '输单', sortOrder: 30, isTerminal: true },
          ],
          transitions: [
            validDraft.transitions[0],
            { ...validDraft.transitions[0], toStateKey: 'lost' },
          ],
        },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID_DRAFT' });
  });

  it('returns an empty draft when none has been saved', async () => {
    const { service } = fixture();
    await expect(service.get(admin, 'object-1')).resolves.toEqual({
      isEnabled: false,
      initialStateKey: null,
      states: [],
      transitions: [],
      objectVersion: 12,
    });
  });

  it('rejects a stale object version', async () => {
    const { service } = fixture();
    await expect(
      service.save(
        admin,
        'object-1',
        { ...validDraft, expectedDraftRevision: 11 },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
  });

  it('replaces the draft without publishing', async () => {
    const { service, store } = fixture();
    const saved = await service.save(
      admin,
      'object-1',
      { ...validDraft, expectedDraftRevision: 12 },
      meta,
    );
    expect(saved.objectVersion).toBe(13);
    expect(store.draft?.isEnabled).toBe(true);
    expect(store.audits.map((event) => event.action)).toEqual([
      'workflow.draft_updated',
    ]);
  });

  it('round-trips two ordered actions through save and get', async () => {
    const { service, store } = fixture();

    const saved = await service.save(
      admin,
      'object-1',
      { ...actionsDraft, expectedDraftRevision: 12 },
      meta,
    );
    const loaded = await service.get(admin, 'object-1');

    expect(loaded.transitions[0]?.actions).toEqual(orderedActions);
    expect(saved.transitions[0]?.actions).toEqual(orderedActions);
    expect(loaded.transitions[0]?.actions?.map((action) => action.key)).toEqual(
      ['update-source', 'assign-actor'],
    );
    expect(
      loaded.transitions[0]?.actions?.map((action) => action.type),
    ).toEqual(['UPDATE_RECORD', 'ASSIGN_OWNER']);
    // Order is execution order (§28): it must survive the persistence boundary
    // exactly as saved, not merely contain the same steps.
    expect(store.draft?.transitions[0]?.actions).toEqual(orderedActions);
  });

  it('persists a transition without actions as an empty list', async () => {
    const { service } = fixture();

    const saved = await service.save(
      admin,
      'object-1',
      { ...validDraft, expectedDraftRevision: 12 },
      meta,
    );
    const loaded = await service.get(admin, 'object-1');

    expect(saved.transitions[0]?.actions).toEqual([]);
    expect(loaded.transitions[0]?.actions).toEqual([]);
  });
});
