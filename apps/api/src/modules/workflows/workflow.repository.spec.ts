import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { WorkflowActionDraft } from '../actions/action.types';
import type { AuditService } from '../audit/audit.service';
import { PrismaWorkflowRepository } from './workflow.repository';
import type { WorkflowDraft } from './workflow.types';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-1',
  tenantCode: 'nebula-demo',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
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

const markWonTransition: WorkflowDraft['transitions'][number] = {
  key: 'mark-won',
  label: '标记赢单',
  fromStateKey: 'new',
  toStateKey: 'won',
  allowedRoles: ['TENANT_ADMIN'],
  requiredFieldKeys: [],
  actions: orderedActions,
  sortOrder: 10,
};

const draft: WorkflowDraft = {
  isEnabled: true,
  initialStateKey: 'new',
  states: [{ key: 'new', label: '新建', sortOrder: 10, isTerminal: false }],
  transitions: [markWonTransition],
};

const legacyDraft: WorkflowDraft = {
  ...draft,
  transitions: [{ ...markWonTransition, actions: undefined }],
};

/** The nested `transitions.create` payload the repository hands to Prisma. */
interface TransitionCreateArgs {
  data: { transitions: { create: Array<{ actions: unknown }> } };
}

function repository(transaction: object) {
  return new PrismaWorkflowRepository(
    {
      withTenant: async <T>(
        _context: TenantContext,
        work: (value: never) => Promise<T>,
      ) => work(transaction as never),
    } as unknown as DatabaseContextRunner,
    {} as AuditService,
  );
}

function transitionRow(actions: unknown) {
  return {
    key: 'mark-won',
    label: '标记赢单',
    fromStateKey: 'new',
    toStateKey: 'won',
    allowedRoles: ['TENANT_ADMIN'],
    requiredFieldKeys: [],
    sortOrder: 10,
    actions,
  };
}

function transactionWithTransitions(transitions: unknown[]) {
  return {
    objectWorkflowDefinition: {
      findFirst: jest.fn().mockResolvedValue({
        isEnabled: true,
        initialStateKey: 'new',
        states: [],
        transitions,
      }),
    },
  };
}

/** Collects the nested create payloads so assertions never touch `any`. */
function transactionWithCreate(calls: TransitionCreateArgs[]) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ version: 7 }]),
    objectWorkflowDefinition: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: TransitionCreateArgs) => {
        calls.push(args);
        return Promise.resolve({});
      }),
    },
    objectDefinition: { update: jest.fn().mockResolvedValue({}) },
  };
}

function replace(input: WorkflowDraft, calls: TransitionCreateArgs[] = []) {
  return repository(transactionWithCreate(calls)).withTenant(
    admin,
    (workflowStore) =>
      workflowStore.replaceDraft({
        objectId: 'object-1',
        expectedVersion: 7,
        draft: input,
        actorMemberId: 'member-admin',
      }),
  );
}

describe('PrismaWorkflowRepository actions mapping', () => {
  it('reads transition actions in their stored order', async () => {
    const store = transactionWithTransitions([transitionRow(orderedActions)]);

    const found = await repository(store).withTenant(admin, (workflowStore) =>
      workflowStore.findDraft('object-1'),
    );

    expect(found?.transitions[0]?.actions).toEqual(orderedActions);
    expect(found?.transitions[0]?.actions?.map((action) => action.key)).toEqual(
      ['update-source', 'assign-actor'],
    );
  });

  it('normalizes a transition without an actions array to an empty list', async () => {
    const store = transactionWithTransitions([
      transitionRow(undefined),
      { ...transitionRow({}), key: 'mark-lost' },
    ]);

    const found = await repository(store).withTenant(admin, (workflowStore) =>
      workflowStore.findDraft('object-1'),
    );

    expect(found?.transitions.map((transition) => transition.actions)).toEqual([
      [],
      [],
    ]);
  });

  it('writes transition actions in their draft order', async () => {
    const calls: TransitionCreateArgs[] = [];

    const saved = await replace(draft, calls);

    expect(calls[0]?.data.transitions.create[0]?.actions).toEqual(
      orderedActions,
    );
    expect(saved?.transitions[0]?.actions).toEqual(orderedActions);
    expect(saved?.objectVersion).toBe(8);
  });

  it('writes an empty actions list when a legacy draft omits them', async () => {
    const calls: TransitionCreateArgs[] = [];

    await replace(legacyDraft, calls);

    expect(calls[0]?.data.transitions.create[0]?.actions).toEqual([]);
  });
});
