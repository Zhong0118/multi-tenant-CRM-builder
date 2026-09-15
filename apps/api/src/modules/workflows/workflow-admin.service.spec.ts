import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
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
    this.draft = structuredClone(input.draft);
    this.object.version += 1;
    return Promise.resolve({
      ...structuredClone(input.draft),
      objectVersion: this.object.version,
    });
  }

  appendAudit(event: { action: string }) {
    this.audits.push(event);
    return Promise.resolve();
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
});
