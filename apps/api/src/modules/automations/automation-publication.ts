import {
  analyzeActionPublication,
  type ActionPublicationSchema,
} from '../actions/action-publication.policy';
import type { WorkflowActionDraft } from '../actions/action.types';
import { ApiException } from '../../common/errors/api.exception';
import type {
  PublicationDraft,
  PublicationIssue,
} from '../objects/object-publication.policy';
import { isPublishedFieldType } from '../objects/object-schema';
import {
  normalizeStaticFieldValue,
  RecordValueError,
} from '../records/record-value-engine';
import { validateAutomationRules } from './automation.policy';
import type { AutomationRule, AutomationValue } from './automation.types';

export function automationActions(
  rule: AutomationRule,
  inputs: Record<string, AutomationValue> = {},
): WorkflowActionDraft[] {
  return [
    {
      key: 'create',
      type: 'CREATE_RECORD',
      targetObjectCode: rule.targetObjectCode,
      owner: { source: rule.owner },
      values: Object.fromEntries(
        Object.entries(rule.mappings).map(([key, mapping]) => [
          key,
          mapping.source === 'INPUT'
            ? { source: 'LITERAL', value: inputs[key] ?? null }
            : mapping,
        ]),
      ),
    },
    {
      key: 'link',
      type: 'CREATE_RELATION',
      left: { source: 'SOURCE_RECORD' },
      right: {
        source: 'ACTION_OUTPUT',
        actionKey: 'create',
        property: 'recordId',
      },
    },
  ];
}
export function analyzeAutomationPublication(
  input: PublicationDraft,
): PublicationIssue[] {
  if (!input.automations?.length) return [];
  try {
    validateAutomationRules(
      input.automations,
      input.object.code,
      input.fields
        .filter((field) => field.status === 'ACTIVE')
        .map((field) => field.fieldKey),
    );
  } catch (error) {
    if (error instanceof ApiException)
      return [{ code: 'VALIDATION_FAILED', message: error.message }];
    throw error;
  }
  const issues = analyzeActionPublication({
    source: {
      code: input.object.code,
      schema: {
        fields: input.fields.flatMap((field) =>
          field.status === 'ACTIVE' && isPublishedFieldType(field.type)
            ? [{ ...field, type: field.type }]
            : [],
        ),
        employeeAccess: input.employeeAccess,
      },
    },
    transitions: input.automations
      .filter((rule) => rule.enabled)
      .map((rule) => ({
        key: rule.key,
        allowedRoles: rule.allowedRoles,
        actions: automationActions(rule),
      })),
    targets: input.actionTargets ?? new Map(),
  });
  for (const rule of input.automations.filter((rule) => rule.enabled)) {
    if (rule.trigger.type === 'FIELD_CHANGED') {
      const fieldKey = rule.trigger.fieldKey;
      const field = input.fields.find((field) => field.fieldKey === fieldKey);
      if (field && isPublishedFieldType(field.type)) {
        try {
          normalizeStaticFieldValue(
            { ...field, type: field.type, validation: field.validation ?? {} },
            rule.trigger.equals,
          );
        } catch (error) {
          if (!(error instanceof RecordValueError)) throw error;
          issues.push({
            code: 'VALIDATION_FAILED',
            fieldKey,
            transitionKey: rule.key,
            message: `自动化「${rule.label}」的触发值不符合来源字段「${fieldKey}」的类型、校验或有效选项。`,
          });
        }
      }
    }
    const target = input.actionTargets?.get(rule.targetObjectCode)?.schema;
    if (target) issues.push(...analyzeFixedMappings(rule, target));
    if (rule.allowedRoles.includes('EMPLOYEE')) {
      const copied = Object.values(rule.mappings).filter(
        (mapping) => mapping.source === 'SOURCE_FIELD',
      );
      if (
        !input.employeeAccess?.canRead ||
        !input.employeeAccess.canUpdate ||
        copied.some(
          (mapping) =>
            (input.employeeAccess?.fields[mapping.fieldKey] ?? 'HIDDEN') ===
            'HIDDEN',
        ) ||
        (target &&
          (!target.employeeAccess?.canRead ||
            target.employeeAccess.readScope === 'NONE'))
      ) {
        issues.push({
          code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
          transitionKey: rule.key,
          message: `自动化「${rule.label}」允许员工执行，但当前记录、复制字段或目标关联的读取权限不足。`,
        });
      }
    }
  }
  return issues;
}

/** Changing a target publication must preserve every live incoming mapping. */
export function analyzeAutomationDependencies(
  candidate: PublicationDraft,
  objects: readonly import('../objects/objects.repository').ObjectDraft[],
): PublicationIssue[] {
  const targetFields = candidate.fields.flatMap((field) =>
    field.status === 'ACTIVE' && isPublishedFieldType(field.type)
      ? [{ ...field, type: field.type }]
      : [],
  );
  const issues: PublicationIssue[] = [];
  for (const object of objects) {
    const source = object.activeSchema;
    if (
      object.object.status !== 'ACTIVE' ||
      !source ||
      source.object.code === candidate.object.code
    )
      continue;
    const rules = (source.automations ?? []).filter(
      (rule) => rule.enabled && rule.targetObjectCode === candidate.object.code,
    );
    for (const rule of rules)
      issues.push(
        ...analyzeFixedMappings(rule, {
          fields: targetFields,
          employeeAccess: candidate.employeeAccess,
        }),
      );
    issues.push(
      ...analyzeActionPublication({
        source: { code: source.object.code, schema: source },
        transitions: rules.map((rule) => ({
          key: rule.key,
          allowedRoles: rule.allowedRoles,
          actions: automationActions(rule),
        })),
        targets: new Map([
          [
            candidate.object.code,
            {
              code: candidate.object.code,
              status: 'ACTIVE',
              schema: {
                fields: targetFields,
                employeeAccess: candidate.employeeAccess,
              },
            },
          ],
        ]),
      }).map((issue) => ({
        ...issue,
        message: `业务表「${source.object.code}」的自动化依赖：${issue.message}`,
      })),
    );
  }
  return issues;
}

function analyzeFixedMappings(
  rule: AutomationRule,
  target: ActionPublicationSchema,
): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  if (
    rule.allowedRoles.includes('EMPLOYEE') &&
    (!target.employeeAccess?.canRead ||
      target.employeeAccess.readScope === 'NONE')
  ) {
    issues.push({
      code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
      transitionKey: rule.key,
      message: `自动化「${rule.label}」要求员工有权读取目标记录以建立关联。`,
    });
  }
  for (const [fieldKey, mapping] of Object.entries(rule.mappings)) {
    const field = target.fields.find((field) => field.fieldKey === fieldKey);
    if (!field) continue;
    if (
      rule.allowedRoles.includes('EMPLOYEE') &&
      mapping.source === 'INPUT' &&
      field.type === 'MEMBER'
    ) {
      issues.push({
        code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
        fieldKey,
        transitionKey: rule.key,
        message: `自动化「${rule.label}」的成员字段「${fieldKey}」不支持员工手动输入，请使用来源字段，或由管理员设置固定成员。`,
      });
    }
    if (
      mapping.source === 'NOW' &&
      field.type !== 'DATE' &&
      field.type !== 'DATETIME'
    ) {
      issues.push({
        code: 'WORKFLOW_ACTION_FIELD_TYPE_MISMATCH',
        fieldKey,
        transitionKey: rule.key,
        message: `自动化「${rule.label}」的当前时间只能写入日期字段「${fieldKey}」。`,
      });
    }
    if (mapping.source !== 'LITERAL') continue;
    try {
      normalizeStaticFieldValue(
        { ...field, validation: field.validation ?? {} },
        mapping.value,
      );
    } catch (error) {
      if (!(error instanceof RecordValueError)) throw error;
      issues.push({
        code: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
        fieldKey,
        transitionKey: rule.key,
        message: `自动化「${rule.label}」的固定值不符合目标字段「${fieldKey}」的必填、类型、校验或有效选项。`,
      });
    }
  }
  return issues;
}
