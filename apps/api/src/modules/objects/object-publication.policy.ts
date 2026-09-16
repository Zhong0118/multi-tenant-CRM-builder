import {
  isPublishedFieldType,
  type JsonValue,
  type PublishedDataScope,
  type PublishedField,
  type PublishedFieldAccess,
  type PublishedObjectSchema,
} from './object-schema';
import {
  analyzeObjectConfiguration,
  compileObjectConfiguration,
} from './object-configuration.policy';
import { ApiException } from '../../common/errors/api.exception';
import {
  analyzeActionPublication,
  type ActionPublicationSchema,
  type ActionPublicationTarget,
} from '../actions/action-publication.policy';
import { validateWorkflowDraft } from '../workflows/workflow-draft.policy';
import type { WorkflowDraft } from '../workflows/workflow.types';

export type DraftFieldType = PublishedField['type'] | 'ATTACHMENT';

export interface PublicationDraftField {
  id: string;
  fieldKey: string;
  label: string;
  type: DraftFieldType;
  required: boolean;
  defaultValue: JsonValue;
  validation: Record<string, JsonValue>;
  config: Record<string, JsonValue>;
  sortOrder: number;
  isSystem: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  updatedAt?: string;
}

export interface PublicationDraft {
  object: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
    version: number;
    updatedAt?: string;
  };
  fields: PublicationDraftField[];
  defaultView: {
    code: 'default';
    name: string;
    columnFieldKeys: string[];
    /**
     * Extra JSONB fields included in keyword search. Missing means the
     * publication still uses visible default-view text columns. An empty
     * array means title-only search.
     */
    searchFieldKeys?: string[];
    sort: {
      field: 'updatedAt' | 'createdAt' | 'recordNo';
      direction: 'asc' | 'desc';
    };
    updatedAt?: string;
  } | null;
  employeeAccess: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: false;
    readScope: PublishedDataScope;
    updateScope: PublishedDataScope;
    fields: Record<string, PublishedFieldAccess>;
    memberOverrides?: Record<string, unknown>;
  } | null;
  activeSchema: PublishedObjectSchema | null;
  activeRecordCount: number;
  missingRequiredValueCounts?: Record<string, number>;
  workflow?: WorkflowDraft | null;
  workflowStateRecordCounts?: Record<string, number>;
  /**
   * §25/§26: the CURRENT Active Publications of the Workflow Actions' Target
   * Objects, loaded by the caller inside the same tenant transaction. The
   * policy never queries; a missing entry is reported as an invalid target.
   */
  actionTargets?: ReadonlyMap<string, ActionPublicationTarget>;
}

export interface PublicationIssue {
  code: string;
  message: string;
  fieldKey?: string;
  /**
   * §34: the Transition and Action an Action-originated issue belongs to, so
   * the UI can locate the offending step instead of parsing the message (two
   * Transitions can produce byte-identical text). Optional: every non-action
   * workflow issue (states, transitions, required fields) has no Action.
   */
  transitionKey?: string;
  actionKey?: string;
}

export interface PublicationAnalysis {
  blocking: PublicationIssue[];
  warnings: PublicationIssue[];
  changes: Array<{
    kind: 'ADDED' | 'UPDATED' | 'INACTIVATED';
    fieldKey: string;
  }>;
}

export function analyzePublication(
  input: PublicationDraft,
): PublicationAnalysis {
  const activeFields = input.fields.filter(
    (field) => field.status === 'ACTIVE',
  );
  const configuration = analyzeObjectConfiguration({
    object: input.object,
    fields: input.fields,
    defaultView: input.defaultView,
    employeeAccess: input.employeeAccess,
    previousFields: input.activeSchema?.fields,
  });
  const blocking = [...configuration.blocking];
  if (
    input.employeeAccess &&
    (input.employeeAccess.fields[input.object.titleFieldKey] ?? 'HIDDEN') ===
      'HIDDEN'
  ) {
    blocking.push({
      code: 'TITLE_FIELD_HIDDEN',
      message: '标题字段会用于记录名称和搜索，员工权限至少应为只读。',
      fieldKey: input.object.titleFieldKey,
    });
  }
  blocking.push(...analyzeWorkflowPublication(input));
  const previousFields = new Map(
    (input.activeSchema?.fields ?? []).map((field) => [field.fieldKey, field]),
  );

  for (const field of activeFields) {
    const previous = previousFields.get(field.fieldKey);
    const newlyRequired = field.required && (!previous || !previous.required);
    const missingCount = input.missingRequiredValueCounts?.[field.fieldKey];
    const cannotProveExistingRecordsHaveValues =
      input.activeRecordCount > 0 && missingCount === undefined;

    if (
      newlyRequired &&
      input.activeRecordCount > 0 &&
      (cannotProveExistingRecordsHaveValues || (missingCount ?? 0) > 0)
    ) {
      blocking.push({
        code: 'REQUIRED_FIELD_HAS_MISSING_VALUES',
        message: '现有记录缺少该字段值，暂时不能发布为必填字段。',
        fieldKey: field.fieldKey,
      });
    }
  }

  return {
    blocking,
    warnings: configuration.warnings,
    changes: configuration.changes,
  };
}

export function compilePublication(
  input: PublicationDraft & {
    publication: PublishedObjectSchema['publication'];
  },
): PublishedObjectSchema {
  if (!input.defaultView || !input.employeeAccess) {
    throw new Error('Publication draft is incomplete');
  }

  const configuration = compileObjectConfiguration({
    ...input,
    defaultView: input.defaultView,
    employeeAccess: input.employeeAccess,
  });

  const workflow = compilePublishedWorkflow(input);
  return {
    publication: { ...input.publication },
    ...configuration,
    ...(workflow ? { workflow } : {}),
  };
}

function analyzeWorkflowPublication(
  input: PublicationDraft,
): PublicationIssue[] {
  const workflow = input.workflow;
  if (!workflow?.isEnabled) return [];

  const knownFieldKeys = input.fields
    .filter((field) => field.status === 'ACTIVE')
    .map((field) => field.fieldKey);
  const fieldAccess = input.employeeAccess?.fields ?? {};
  let normalized;
  try {
    normalized = validateWorkflowDraft(workflow, { knownFieldKeys });
  } catch (error) {
    const fieldErrors =
      error instanceof ApiException ? error.fieldErrors : undefined;
    const first = fieldErrors
      ? Object.values(fieldErrors).flat()[0]
      : undefined;
    return [
      {
        code: publicationIssueCode(error, first),
        message: first ?? '流程配置不合法，暂时不能发布。',
      },
    ];
  }

  const issues: PublicationIssue[] = [];
  for (const transition of normalized.transitions) {
    if (!transition.allowedRoles.includes('EMPLOYEE')) continue;
    for (const fieldKey of transition.requiredFieldKeys) {
      if ((fieldAccess[fieldKey] ?? 'HIDDEN') === 'HIDDEN') {
        issues.push({
          code: 'WORKFLOW_REQUIRED_FIELD_HIDDEN',
          message: `员工无法看到流程动作所需字段「${fieldKey}」。`,
          fieldKey,
        });
      }
    }
  }

  const nextKeys = new Set(workflow.states.map((state) => state.key));
  for (const [stateKey, count] of Object.entries(
    input.workflowStateRecordCounts ?? {},
  )) {
    if (count > 0 && !nextKeys.has(stateKey)) {
      issues.push({
        code: 'WORKFLOW_STATE_IN_USE',
        message: `仍有 ${count} 条记录使用状态「${stateKey}」，不能从新版本中删除。`,
        fieldKey: stateKey,
      });
    }
  }

  // §25/§26: the structural Action rules were already enforced above by the
  // draft validator; this adds only the cross-object rules, against the CURRENT
  // Target Object publications the caller loaded.
  issues.push(
    ...analyzeActionPublication({
      source: {
        code: input.object.code,
        schema: toActionPublicationSchema(input),
      },
      transitions: normalized.transitions.map((transition) => ({
        key: transition.key,
        allowedRoles: transition.allowedRoles,
        actions: transition.actions ?? [],
      })),
      targets: input.actionTargets ?? new Map(),
    }),
  );
  return issues;
}

/**
 * §34: a structurally invalid Action keeps its own stable code instead of being
 * flattened into the generic draft code, so the designer can locate the exact
 * reason (limit, duplicate key, forward reference, output, source patch).
 */
function publicationIssueCode(
  error: unknown,
  firstMessage: string | undefined,
): string {
  if (error instanceof ApiException) {
    const code: string = error.code;
    if (code.startsWith('WORKFLOW_ACTION_')) return code;
  }
  return firstMessage?.includes('必填字段')
    ? 'WORKFLOW_REQUIRED_FIELD_UNKNOWN'
    : 'WORKFLOW_INVALID_DRAFT';
}

/**
 * The Source Object exactly as this publication will freeze it: active fields
 * of a publishable type, plus the operator's employee policy.
 */
function toActionPublicationSchema(
  input: PublicationDraft,
): ActionPublicationSchema {
  return {
    fields: input.fields.flatMap((field) =>
      field.status === 'ACTIVE' && isPublishedFieldType(field.type)
        ? [
            {
              fieldKey: field.fieldKey,
              type: field.type,
              required: field.required,
              defaultValue: field.defaultValue,
              config: field.config,
              isSystem: field.isSystem,
            },
          ]
        : [],
    ),
    employeeAccess: input.employeeAccess,
  };
}

function compilePublishedWorkflow(
  input: PublicationDraft,
): PublishedObjectSchema['workflow'] {
  const workflow = input.workflow;
  if (!workflow?.isEnabled) return undefined;
  const normalized = validateWorkflowDraft(workflow, {
    knownFieldKeys: input.fields
      .filter((field) => field.status === 'ACTIVE')
      .map((field) => field.fieldKey),
  });
  if (!normalized.initialStateKey) {
    throw new Error('Enabled workflow is missing an initial state');
  }
  return {
    initialStateKey: normalized.initialStateKey,
    states: normalized.states.map((state) => ({
      key: state.key,
      label: state.label,
      sortOrder: state.sortOrder,
      isTerminal: state.isTerminal,
    })),
    transitions: normalized.transitions.map((transition) => ({
      key: transition.key,
      label: transition.label,
      fromStateKey: transition.fromStateKey,
      toStateKey: transition.toStateKey,
      allowedRoles: transition.allowedRoles,
      requiredFieldKeys: transition.requiredFieldKeys,
      // §10: actions are frozen into the snapshot by copy from the validated
      // normalized draft actions; array order is execution order (§28). Legacy
      // drafts without actions publish an explicit empty list.
      actions: transition.actions ?? [],
    })),
  };
}
