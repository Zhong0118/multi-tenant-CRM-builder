import type { TableBuilderAnswer, TableBuilderResult } from '@crm/contracts';
import {
  builtInReason,
  canonicalName,
} from '../../../src/modules/ai/table-blueprint';

export interface Sample {
  id: string;
  industry: string;
  description: string;
  existingObjects: string[];
  answers: TableBuilderAnswer[];
  mustCover: {
    entity: string;
    fields: { meaning: string; type: string; options?: string[] }[];
  }[];
  mustOmit: string[];
  permissionCeiling: string;
  expectQuestion?: boolean;
  expectConflict?: boolean;
  overLimit?: boolean;
}
const contains = (candidate: string, expected: string) =>
  canonicalName(candidate).includes(canonicalName(expected));

export function measure(sample: Sample, result: TableBuilderResult | null) {
  const plan = result?.kind === 'blueprint' ? result.blueprint : undefined;
  const failures: string[] = [];
  const checks = {
    entities: [] as boolean[],
    types: [] as boolean[],
    options: [] as boolean[],
    omissions: [] as boolean[],
  };
  for (const entity of sample.mustCover) {
    const table = plan?.tables.find((t) => contains(t.name, entity.entity));
    checks.entities.push(!!table);
    if (!table) failures.push('缺少业务表 ' + entity.entity);
    for (const wanted of entity.fields) {
      const field = table?.fields.find(
        (f) => contains(f.label, wanted.meaning) && f.type === wanted.type,
      );
      checks.types.push(!!field);
      if (!field)
        failures.push(
          entity.entity +
            ' 缺少匹配字段 ' +
            wanted.meaning +
            ' / ' +
            wanted.type,
        );
      for (const option of wanted.options ?? []) {
        const found = !!field?.options?.some(
          (o) => canonicalName(o.label) === canonicalName(option),
        );
        checks.options.push(found);
        if (!found) failures.push(wanted.meaning + ' 缺少选项 ' + option);
      }
    }
  }
  for (const request of sample.mustOmit) {
    const explained = !!plan?.omitted.some(
      (o) => contains(o.request, request) && o.reason.trim(),
    );
    const included = plan?.tables.some(
      (t) =>
        contains(t.name, request) ||
        t.fields.some((f) => contains(f.label, request)),
    );
    checks.omissions.push(explained && !included);
    if (!explained || included) failures.push('未正确说明或移除 ' + request);
  }
  if (!result) failures.push('无预览结果');
  else if (sample.expectQuestion) {
    if (result.kind !== 'question') failures.push('应先追问');
  } else if (result.kind === 'question') failures.push('明确需求被追问');
  else {
    const blocked = result.issues.filter((i) => i.blocking);
    if (sample.expectConflict && !blocked.some((i) => i.code === 'NAME_IN_USE'))
      failures.push('未拦截重名');
    if (
      sample.overLimit &&
      !(
        result.blueprint.tables.length > 6 &&
        blocked.some((i) => i.code === 'TABLE_COUNT')
      )
    )
      failures.push('未保留并阻止超限实体');
    if (
      !sample.expectConflict &&
      !sample.overLimit &&
      (blocked.length || !result.blueprint.tables.length)
    )
      failures.push('无可确认方案');
  }
  return { checks, failures };
}
export const scoreTablePlan = (sample: Sample, result: TableBuilderResult) =>
  measure(sample, result).failures;

export function previewViolations(result: TableBuilderResult | null): string[] {
  if (result?.kind !== 'blueprint') return [];
  const violations: string[] = [];
  for (const table of result.blueprint.tables) {
    for (const name of [table.name, ...table.fields.map((f) => f.label)])
      if (builtInReason(name)) violations.push('重复平台能力 ' + name);
    // This preview contract carries intentions only. Any executable access
    // configuration at any level bypasses the manual baseline.
    if (containsAccess(table)) violations.push('预览包含可执行的权限配置');
  }
  return violations;
}
function containsAccess(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, v]) =>
      /^(employeeAccess|fieldAccess|permissions|can(Create|Read|Update|Delete|Export|Import)|readScope|updateScope)$/.test(
        key,
      ) || containsAccess(v),
  );
}
