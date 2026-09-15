import { ApiException } from '../../common/errors/api.exception';
import { validateWorkflowDraft } from './workflow-draft.policy';
import type { WorkflowDraft } from './workflow.types';

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

describe('validateWorkflowDraft', () => {
  it('accepts a valid enabled workflow', () => {
    expect(
      validateWorkflowDraft(draft(), { knownFieldKeys: ['amount'] }).initialStateKey,
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
