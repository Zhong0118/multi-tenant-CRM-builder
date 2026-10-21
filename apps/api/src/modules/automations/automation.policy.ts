import { isDeepStrictEqual } from 'node:util';
import { ApiException } from '../../common/errors/api.exception';
import type { AutomationRule, AutomationValue } from './automation.types';

function invalid(message: string): never {
  throw new ApiException('VALIDATION_FAILED', 400, { message });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('规则格式无效。');
  return value as Record<string, unknown>;
}
function literal(value: unknown): value is AutomationValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}
export function validateAutomationRules(
  input: unknown,
  sourceCode: string,
  fieldKeys: readonly string[],
): AutomationRule[] {
  if (!Array.isArray(input) || input.length > 20)
    invalid('每张表最多配置 20 条自动化规则。');
  const keys = new Set<string>();
  for (const raw of input) {
    const rule = object(raw);
    if (
      typeof rule.key !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(rule.key) ||
      keys.has(rule.key)
    )
      invalid('规则标识无效或重复。');
    keys.add(rule.key);
    if (
      typeof rule.label !== 'string' ||
      !rule.label.trim() ||
      rule.label.length > 100 ||
      typeof rule.enabled !== 'boolean'
    )
      invalid('请填写规则名称与启用状态。');
    if (
      !Array.isArray(rule.allowedRoles) ||
      !rule.allowedRoles.length ||
      rule.allowedRoles.some(
        (role) => !['TENANT_ADMIN', 'EMPLOYEE'].includes(role as string),
      )
    )
      invalid('请选择允许执行的角色。');
    if (
      typeof rule.targetObjectCode !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(rule.targetObjectCode) ||
      rule.targetObjectCode === sourceCode
    )
      invalid('请选择不同的目标业务表。');
    if (rule.owner !== 'ACTOR' && rule.owner !== 'SOURCE_OWNER')
      invalid('负责人来源无效。');
    const trigger = object(rule.trigger);
    if (trigger.type !== 'MANUAL' && trigger.type !== 'FIELD_CHANGED')
      invalid('触发方式无效。');
    if (
      trigger.type === 'FIELD_CHANGED' &&
      (!fieldKeys.includes(trigger.fieldKey as string) ||
        !literal(trigger.equals))
    )
      invalid('触发字段或匹配值无效。');
    const mappings = object(rule.mappings);
    if (Object.keys(mappings).length > 50) invalid('字段映射最多 50 项。');
    for (const rawMapping of Object.values(mappings)) {
      const mapping = object(rawMapping);
      if (
        !['SOURCE_FIELD', 'LITERAL', 'NOW', 'INPUT'].includes(
          mapping.source as string,
        )
      )
        invalid('映射来源无效。');
      if (
        mapping.source === 'SOURCE_FIELD' &&
        !fieldKeys.includes(mapping.fieldKey as string)
      )
        invalid('映射引用的来源字段不可用。');
      if (mapping.source === 'LITERAL' && !literal(mapping.value))
        invalid('固定值无效。');
      if (mapping.source === 'INPUT' && trigger.type !== 'MANUAL')
        invalid('字段自动触发不能要求本次填写。');
    }
  }
  return structuredClone(input) as AutomationRule[];
}
export function matchesFieldChange(
  rule: AutomationRule,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return (
    rule.enabled &&
    rule.trigger.type === 'FIELD_CHANGED' &&
    !isDeepStrictEqual(before[rule.trigger.fieldKey], rule.trigger.equals) &&
    isDeepStrictEqual(after[rule.trigger.fieldKey], rule.trigger.equals)
  );
}
