import { ApiException } from '../../common/errors/api.exception';
import { validateWorkflowDraft } from './workflow-draft.policy';
import type {
  WorkflowDraft,
  WorkflowDraftInput,
  WorkflowTransitionDraftInput,
} from './workflow.types';

function draft(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    isEnabled: true,
    initialStateKey: 'new',
    states: [
      {
        key: 'new',
        label: '新建',
        sortOrder: 10,
        isTerminal: false,
      },
      {
        key: 'won',
        label: '赢单',
        sortOrder: 20,
        isTerminal: true,
      },
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
    ...overrides,
  };
}

function transition(
  overrides: Partial<WorkflowTransitionDraftInput> = {},
): WorkflowTransitionDraftInput {
  return {
    key: 'mark-won',
    label: '标记赢单',
    fromStateKey: 'new',
    toStateKey: 'won',
    allowedRoles: ['TENANT_ADMIN'],
    requiredFieldKeys: [],
    sortOrder: 10,
    ...overrides,
  };
}

/** Draft input as it arrives from the HTTP DTO: actions are still untyped. */
function draftInput(
  transitions: WorkflowTransitionDraftInput[],
): WorkflowDraftInput {
  return {
    isEnabled: true,
    initialStateKey: 'new',
    states: [
      { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
      { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
    ],
    transitions,
  };
}

describe('validateWorkflowDraft', () => {
  it('accepts a valid enabled workflow', () => {
    expect(
      validateWorkflowDraft(draft(), { knownFieldKeys: ['amount'] })
        .initialStateKey,
    ).toBe('new');
  });

  it('rejects a missing initial state', () => {
    expect(() =>
      validateWorkflowDraft(draft({ initialStateKey: 'missing' })),
    ).toThrow(ApiException);
  });

  it('rejects a dangling transition target', () => {
    expect(() =>
      validateWorkflowDraft(
        draft({
          transitions: [
            {
              key: 'jump',
              label: '跳转',
              fromStateKey: 'new',
              toStateKey: 'gone',
              allowedRoles: ['TENANT_ADMIN'],
              requiredFieldKeys: [],
              sortOrder: 10,
            },
          ],
        }),
      ),
    ).toThrow(ApiException);
  });

  it('rejects an outgoing transition from a terminal state', () => {
    expect(() =>
      validateWorkflowDraft(
        draft({
          transitions: [
            {
              key: 'reopen',
              label: '重新打开',
              fromStateKey: 'won',
              toStateKey: 'new',
              allowedRoles: ['TENANT_ADMIN'],
              requiredFieldKeys: [],
              sortOrder: 10,
            },
          ],
        }),
      ),
    ).toThrow(ApiException);
  });

  it('rejects a required field that is not on the object', () => {
    expect(() =>
      validateWorkflowDraft(draft(), { knownFieldKeys: ['name'] }),
    ).toThrow(ApiException);
  });

  it('rejects duplicate keys', () => {
    expect(() =>
      validateWorkflowDraft(
        draft({
          states: [
            { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
            { key: 'new', label: '重复', sortOrder: 20, isTerminal: false },
          ],
        }),
      ),
    ).toThrow(ApiException);
  });
});

describe('validateWorkflowDraft transition actions', () => {
  const createCustomer = {
    key: 'create-customer',
    type: 'CREATE_RECORD',
    targetObjectCode: 'customer',
    values: { name: { source: 'SOURCE_FIELD', fieldKey: 'amount' } },
  };

  it('keeps valid transition actions and normalizes their keys', () => {
    const normalized = validateWorkflowDraft(
      draftInput([
        transition({
          actions: [
            { ...createCustomer, key: 'Create-Customer' },
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
          ],
        }),
      ]),
      { knownFieldKeys: ['amount'] },
    );

    expect(
      normalized.transitions[0].actions?.map((action) => action.key),
    ).toEqual(['create-customer', 'link-customer']);
  });

  it('normalizes a transition without actions to an empty list', () => {
    const normalized = validateWorkflowDraft(draftInput([transition()]), {
      knownFieldKeys: ['amount'],
    });

    expect(normalized.transitions[0].actions).toEqual([]);
  });

  it('rejects an invalid action with an addressable transition field path', () => {
    let thrown: unknown;
    try {
      validateWorkflowDraft(
        draftInput([
          transition({
            actions: [
              createCustomer,
              { ...createCustomer, key: 'Create_Customer' },
            ],
          }),
        ]),
        { knownFieldKeys: ['amount'] },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiException);
    const exception = thrown as ApiException;
    expect(exception.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(Object.keys(exception.fieldErrors)).toEqual([
      'transitions.0.actions.1.key',
    ]);
  });

  it('rejects conflicting source patch fields between UPDATE_RECORD actions', () => {
    let thrown: unknown;
    try {
      validateWorkflowDraft(
        draftInput([
          transition({
            actions: [
              {
                key: 'update-stage',
                type: 'UPDATE_RECORD',
                target: 'SOURCE_RECORD',
                values: { stage: { source: 'LITERAL', value: 'won' } },
              },
              {
                key: 'update-stage-again',
                type: 'UPDATE_RECORD',
                target: 'SOURCE_RECORD',
                values: { stage: { source: 'LITERAL', value: 'lost' } },
              },
            ],
          }),
        ]),
        { knownFieldKeys: ['amount'] },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiException);
    const exception = thrown as ApiException;
    expect(exception.code).toBe('WORKFLOW_ACTION_SOURCE_PATCH_CONFLICT');
    expect(Object.keys(exception.fieldErrors)).toEqual([
      'transitions.0.actions.1.values.stage',
    ]);
  });
});
