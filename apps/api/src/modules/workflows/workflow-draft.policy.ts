import { ApiException } from '../../common/errors/api.exception';
import { validateTransitionActions } from '../actions/action-draft.policy';
import {
  WORKFLOW_KEY_PATTERN,
  WORKFLOW_ROLES,
  type WorkflowDraft,
  type WorkflowDraftInput,
  type WorkflowRole,
  type WorkflowTransitionDraftInput,
} from './workflow.types';

export function validateWorkflowDraft(
  draft: WorkflowDraftInput,
  options: { knownFieldKeys?: Iterable<string> } = {},
): WorkflowDraft {
  const states = draft.states.map(normalizeState);
  const transitions = draft.transitions.map(normalizeTransition);
  const stateKeys = new Set<string>();
  const transitionKeys = new Set<string>();
  const fromTo = new Set<string>();
  const knownFields = options.knownFieldKeys
    ? new Set(options.knownFieldKeys)
    : undefined;

  for (const [index, state] of states.entries()) {
    if (stateKeys.has(state.key)) {
      throw fieldError(`states.${index}.key`, '状态编码不能重复。');
    }
    stateKeys.add(state.key);
  }

  if (draft.isEnabled) {
    if (states.length < 1) {
      throw fieldError('states', '启用流程时至少需要一个状态。');
    }
    if (!draft.initialStateKey) {
      throw fieldError('initialStateKey', '请指定初始状态。');
    }
  }

  const initialStateKey = draft.initialStateKey
    ? normalizeKey(draft.initialStateKey, 'initialStateKey')
    : null;
  if (initialStateKey && !stateKeys.has(initialStateKey)) {
    throw fieldError('initialStateKey', '初始状态必须是已定义的状态编码。');
  }

  const terminalKeys = new Set(
    states.filter((state) => state.isTerminal).map((state) => state.key),
  );

  for (const [index, transition] of transitions.entries()) {
    if (transition.key.startsWith('__')) {
      throw fieldError(
        `transitions.${index}.key`,
        '动作编码不能使用系统保留前缀。',
      );
    }
    if (transitionKeys.has(transition.key)) {
      throw fieldError(`transitions.${index}.key`, '动作编码不能重复。');
    }
    transitionKeys.add(transition.key);
    if (!stateKeys.has(transition.fromStateKey)) {
      throw fieldError(`transitions.${index}.fromStateKey`, '起始状态不存在。');
    }
    if (!stateKeys.has(transition.toStateKey)) {
      throw fieldError(`transitions.${index}.toStateKey`, '目标状态不存在。');
    }
    if (transition.fromStateKey === transition.toStateKey) {
      throw fieldError(
        `transitions.${index}.toStateKey`,
        '不能迁移到同一状态。',
      );
    }
    if (terminalKeys.has(transition.fromStateKey)) {
      throw fieldError(
        `transitions.${index}.fromStateKey`,
        '终态不能配置后续动作。',
      );
    }
    const edge = `${transition.fromStateKey}>${transition.toStateKey}`;
    if (fromTo.has(edge)) {
      throw fieldError(
        `transitions.${index}.toStateKey`,
        '同一对起始和目标状态不能重复定义。',
      );
    }
    fromTo.add(edge);
    if (transition.allowedRoles.length === 0) {
      throw fieldError(
        `transitions.${index}.allowedRoles`,
        '请至少选择一个角色。',
      );
    }
    for (const role of transition.allowedRoles) {
      if (!WORKFLOW_ROLES.includes(role)) {
        throw fieldError(`transitions.${index}.allowedRoles`, '角色不受支持。');
      }
    }
    for (const [
      fieldIndex,
      fieldKey,
    ] of transition.requiredFieldKeys.entries()) {
      if (knownFields && !knownFields.has(fieldKey)) {
        throw fieldError(
          `transitions.${index}.requiredFieldKeys.${fieldIndex}`,
          '必填字段必须属于当前业务表。',
        );
      }
    }
  }

  return {
    isEnabled: draft.isEnabled,
    initialStateKey,
    states,
    transitions,
  };
}

function normalizeState(state: WorkflowDraft['states'][number], index: number) {
  return {
    key: normalizeKey(state.key, `states.${index}.key`),
    label: normalizeLabel(state.label, `states.${index}.label`),
    description: normalizeDescription(state.description),
    sortOrder: state.sortOrder,
    isTerminal: state.isTerminal,
  };
}

function normalizeTransition(
  transition: WorkflowTransitionDraftInput,
  index: number,
) {
  return {
    key: normalizeKey(transition.key, `transitions.${index}.key`),
    label: normalizeLabel(transition.label, `transitions.${index}.label`),
    fromStateKey: normalizeKey(
      transition.fromStateKey,
      `transitions.${index}.fromStateKey`,
    ),
    toStateKey: normalizeKey(
      transition.toStateKey,
      `transitions.${index}.toStateKey`,
    ),
    allowedRoles: [...new Set(transition.allowedRoles)] as WorkflowRole[],
    requiredFieldKeys: [...new Set(transition.requiredFieldKeys)],
    sortOrder: transition.sortOrder,
    // Legacy drafts/published snapshots without actions normalize to `[]`.
    actions: validateTransitionActions(transition.actions, {
      fieldPath: `transitions.${index}.actions`,
    }),
  };
}

function normalizeKey(value: string, field: string): string {
  const key = value.trim().toLowerCase();
  if (!WORKFLOW_KEY_PATTERN.test(key)) {
    throw fieldError(field, '仅支持小写字母、数字和单个连字符。');
  }
  return key;
}

function normalizeLabel(value: string, field: string): string {
  const label = value.trim();
  if (label.length === 0) throw fieldError(field, '名称不能为空。');
  return label;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const description = value.trim();
  return description.length === 0 ? null : description;
}

function fieldError(field: string, message: string): ApiException {
  return new ApiException('WORKFLOW_INVALID_DRAFT', 400, {
    fieldErrors: { [field]: [message] },
  });
}
