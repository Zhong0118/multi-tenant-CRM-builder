import {
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
}

export interface PublicationIssue {
  code: string;
  message: string;
  fieldKey?: string;
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
  try {
    validateWorkflowDraft(workflow, { knownFieldKeys });
  } catch (error) {
    const fieldErrors =
      error instanceof ApiException ? error.fieldErrors : undefined;
    const first = fieldErrors
      ? Object.values(fieldErrors).flat()[0]
      : undefined;
    return [
      {
        code: first?.includes('必填字段')
          ? 'WORKFLOW_REQUIRED_FIELD_UNKNOWN'
          : 'WORKFLOW_INVALID_DRAFT',
        message: first ?? '流程配置不合法，暂时不能发布。',
      },
    ];
  }

  const issues: PublicationIssue[] = [];
  for (const transition of workflow.transitions) {
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
  return issues;
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
    })),
  };
}
