import type { ActionPublicationTarget } from '../actions/action-publication.policy';
import type {
  BusinessTemplateConfiguration,
  TemplateObjectConfiguration,
} from './business-template.schema';
import type { TemplatePublicationIssue } from './business-template-publication.policy';
import {
  validatePoolConfig,
  analyzePoolProtectionSources,
} from '../records/record-pool-config';
import { GOAL_METRICS } from '../work/dto/work-goals.dto';
import { ApiException } from '../../common/errors/api.exception';
import { validateWorkflowDraft } from '../workflows/workflow-draft.policy';

export function templateActionTargets(
  input: BusinessTemplateConfiguration,
): Map<string, ActionPublicationTarget> {
  return new Map(
    input.objects
      .filter((o) => o.status === 'ACTIVE')
      .map((object) => [
        object.code,
        {
          code: object.code,
          status: 'ACTIVE',
          schema: {
            fields: object.fields.filter((f) => f.status === 'ACTIVE'),
            employeeAccess: object.employeeAccess,
          },
        },
      ]),
  );
}

/** Values are interpreted by field/action semantics, never by UUID shape. */
export function findTemplatePortabilityBlockers(
  input: BusinessTemplateConfiguration,
): TemplatePublicationIssue[] {
  const issues: TemplatePublicationIssue[] = [];
  const objects = new Map(input.objects.map((o) => [o.code, o]));
  for (const object of input.objects) {
    const block = (path: string, fieldKey?: string) =>
      issues.push({
        code: 'TEMPLATE_MEMBER_BINDING_NOT_PORTABLE',
        message: '模板不能携带公司专属成员绑定，请改用动态成员来源。',
        objectId: object.id,
        fieldKey,
        path: `objects.${object.id}.${path}`,
      });
    const mappings = (
      values: unknown,
      target: TemplateObjectConfiguration | undefined,
      path: string,
    ) => {
      if (!values || typeof values !== 'object' || Array.isArray(values))
        return;
      for (const [key, source] of Object.entries(values)) {
        if (!source || typeof source !== 'object') continue;
        const value = source as {
          source?: unknown;
          memberId?: unknown;
          value?: unknown;
        };
        if (value.source === 'ACTOR' && value.memberId !== undefined)
          block(`${path}.${key}.memberId`, key);
        if (
          value.source === 'LITERAL' &&
          value.value !== null &&
          value.value !== undefined &&
          target?.fields.some((f) => f.fieldKey === key && f.type === 'MEMBER')
        )
          block(`${path}.${key}.value`, key);
      }
    };
    for (const [index, transition] of (
      object.workflow?.transitions ?? []
    ).entries()) {
      for (const [actionIndex, action] of (
        transition.actions ?? []
      ).entries()) {
        const path = `workflow.transitions.${index}.actions.${actionIndex}`;
        if (action.type === 'CREATE_RECORD')
          mappings(
            action.values,
            objects.get(action.targetObjectCode),
            `${path}.values`,
          );
        if (action.type === 'UPDATE_RECORD')
          mappings(action.values, object, `${path}.values`);
        // owner/assignee normally permit only dynamic sources; reject legacy ACTOR bindings as well.
        for (const key of ['owner', 'assignee'] as const) {
          const value = (action as unknown as Record<string, unknown>)[key] as
            { source?: unknown; memberId?: unknown } | undefined;
          if (value?.source === 'ACTOR' && value.memberId !== undefined)
            block(`${path}.${key}.memberId`);
        }
      }
    }
    for (const [index, rule] of (object.automations ?? []).entries()) {
      mappings(
        rule.mappings,
        objects.get(rule.targetObjectCode),
        `automations.${index}.mappings`,
      );
      const trigger = rule.trigger;
      if (
        trigger.type === 'FIELD_CHANGED' &&
        trigger.equals !== null &&
        object.fields.some(
          (f) => f.fieldKey === trigger.fieldKey && f.type === 'MEMBER',
        )
      )
        block(`automations.${index}.trigger.equals`, trigger.fieldKey);
    }
  }
  return issues;
}

export function analyzeTemplateExtensions(
  input: BusinessTemplateConfiguration,
): TemplatePublicationIssue[] {
  const issues: TemplatePublicationIssue[] = [];
  if (input.goalRules === null)
    issues.push({
      code: 'TEMPLATE_EXTENSION_INVALID',
      message: '模板目标规则不能为 null，请省略未配置的扩展。',
      objectId: '',
      path: 'goalRules',
    });
  for (const object of input.objects) {
    for (const key of ['workflow', 'automations', 'pool'] as const) {
      if (object[key] === null)
        issues.push({
          code: 'TEMPLATE_EXTENSION_INVALID',
          message: '模板流程扩展不能为 null，请省略未配置的扩展。',
          objectId: object.id,
          path: `objects.${object.id}.${key}`,
        });
    }
    if (object.workflow) {
      try {
        // Disabled workflows are retained and inserted into relational rows too.
        validateWorkflowDraft(object.workflow, {
          knownFieldKeys: object.fields.map((field) => field.fieldKey),
        });
      } catch (error) {
        const errors = error instanceof ApiException ? error.fieldErrors : {};
        const [field, messages] = Object.entries(errors)[0] ?? [];
        issues.push({
          code: 'TEMPLATE_WORKFLOW_INVALID',
          message: messages?.[0] ?? '模板流程结构不合法。',
          objectId: object.id,
          path: `objects.${object.id}.workflow${field ? '.' + field : ''}`,
        });
      }
    }
  }
  const states = new Map(
    input.objects
      .filter((o) => o.status === 'ACTIVE')
      .map((o) => [
        o.code,
        o.workflow?.isEnabled ? o.workflow.states.map((s) => s.key) : [],
      ]),
  );
  for (const object of input.objects) {
    if (!object.pool || object.status !== 'ACTIVE') continue;
    try {
      validatePoolConfig({ ...object.pool, version: 1 });
    } catch {
      issues.push({
        code: 'POOL_CONFIG_INVALID',
        message: '公海配置不合法。',
        objectId: object.id,
        path: `objects.${object.id}.pool`,
      });
      continue;
    }
    issues.push(
      ...analyzePoolProtectionSources(object.pool, states).map((issue) => ({
        ...issue,
        objectId: object.id,
        path: `objects.${object.id}.pool.protectionRules`,
      })),
    );
  }
  const metrics = new Set<string>();
  for (const [index, rule] of (input.goalRules ?? []).entries()) {
    if (
      !GOAL_METRICS.includes(rule.metric) ||
      metrics.has(rule.metric) ||
      rule.audience !== 'ALL_EMPLOYEES' ||
      typeof rule.enabled !== 'boolean' ||
      !Number.isInteger(rule.target) ||
      rule.target < 1 ||
      rule.target > 100000 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.remindAt) ||
      !Array.isArray(rule.weekdays) ||
      !rule.weekdays.length ||
      rule.weekdays.length > 7 ||
      new Set(rule.weekdays).size !== rule.weekdays.length ||
      rule.weekdays.some(
        (day) => !Number.isInteger(day) || day < 1 || day > 7,
      ) ||
      Object.keys(rule).some(
        (key) =>
          ![
            'metric',
            'target',
            'remindAt',
            'weekdays',
            'audience',
            'enabled',
          ].includes(key),
      )
    )
      issues.push({
        code: 'TEMPLATE_GOAL_RULE_INVALID',
        message: '模板仅支持合法的全体员工每日目标。',
        objectId: '',
        path: `goalRules.${index}`,
      });
    metrics.add(rule.metric);
  }
  return issues;
}
