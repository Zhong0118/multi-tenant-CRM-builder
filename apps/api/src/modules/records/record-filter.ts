import {
  legacyFiltersToRule,
  parseFilterRule,
  recordFilterFieldType,
  validateFilterCondition,
  type FilterCondition,
  type FilterGroup,
  type FilterRule,
} from '@crm/contracts';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import {
  addCalendarDays,
  localDateAt,
  localMidnightUtc,
  isValidFollowUpTimeZone,
} from '../follow-ups/follow-up-workbench-time';
import type {
  RecordListFieldSort,
  RecordListQuery,
  RecordListFilter,
  RecordListSystemSort,
  RecordsStore,
} from './records.repository';

function invalidRecordFilter() {
  return new ApiException('RECORD_FILTER_INVALID', 400, {
    fieldErrors: { filters: ['请选择当前业务表中可见的选项。'] },
  });
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function leaves(group: FilterGroup): FilterCondition[] {
  return group.conditions.flatMap((child) =>
    'conditions' in child ? leaves(child) : [child],
  );
}
export function queryFields(resolved: ResolvedObjectSchema) {
  return resolved.visibleSchema.fields.filter(
    (field) =>
      resolved.visibleSchema.queryFieldKeys === undefined ||
      resolved.visibleSchema.queryFieldKeys.includes(field.fieldKey),
  );
}

function fieldType(resolved: ResolvedObjectSchema, key: string) {
  if (key === '$owner') return 'OWNER';
  if (key === '$followUp') return 'FOLLOW_UP';
  const field = queryFields(resolved).find((f) => f.fieldKey === key);
  return field ? recordFilterFieldType(field) : undefined;
}

export async function validateRecordFilterRule(
  raw: unknown,
  resolved: ResolvedObjectSchema,
  context: TenantContext,
  memberExists: (id: string) => Promise<boolean>,
): Promise<FilterRule> {
  let rule: FilterRule;
  const members = new Set<string>();
  try {
    rule = parseFilterRule(raw);
    for (const condition of leaves(rule)) {
      const type = fieldType(resolved, condition.fieldKey);
      if (!type) throw invalidRecordFilter();
      validateFilterCondition(condition, type);
      if (!Array.isArray(condition.value)) continue;
      if (type === 'OWNER' || type === 'MEMBER') {
        for (const id of condition.value) {
          if (
            type === 'OWNER' &&
            resolved.access.readScope === 'GROUP' &&
            id !== '$me'
          ) {
            if (!resolved.access.groupOwnerMemberIds?.includes(id))
              throw invalidRecordFilter();
            continue;
          }
          if (id !== '$me' && id !== context.memberId) members.add(id);
        }
      } else {
        const field = resolved.visibleSchema.fields.find(
          (f) => f.fieldKey === condition.fieldKey,
        );
        const options = field?.config.options;
        if (!Array.isArray(options)) throw invalidRecordFilter();
        const active = new Set(
          options.flatMap((o) =>
            isPlainObject(o) && o.status !== 'INACTIVE' ? [o.key] : [],
          ),
        );
        if (!condition.value.every((key) => active.has(key)))
          throw invalidRecordFilter();
      }
    }
  } catch {
    throw invalidRecordFilter();
  }
  for (const id of members) {
    if (!(await memberExists(id))) throw invalidRecordFilter();
  }
  return rule;
}

function relativeRange(
  preset: string,
  today: string,
): { from: string; to: string } {
  if (preset === 'yesterday') {
    const day = addCalendarDays(today, -1);
    return { from: day, to: day };
  }
  if (preset === 'last_month') {
    const to = addCalendarDays(today.slice(0, 8) + '01', -1);
    return { from: to.slice(0, 8) + '01', to };
  }
  const current = new Date(today + 'T00:00:00Z');
  if (preset === 'this_week') {
    const from = addCalendarDays(today, -((current.getUTCDay() + 6) % 7));
    return { from, to: addCalendarDays(from, 6) };
  }
  if (preset === 'this_month') {
    current.setUTCMonth(current.getUTCMonth() + 1, 0);
    return {
      from: today.slice(0, 8) + '01',
      to: current.toISOString().slice(0, 10),
    };
  }
  const offset =
    preset === 'past_7_days' ? -6 : preset === 'past_30_days' ? -29 : 0;
  return { from: addCalendarDays(today, offset), to: today };
}

export async function parseListFilters(
  serialized: string | undefined,
  resolved: ResolvedObjectSchema,
  context: TenantContext,
  store: RecordsStore,
  now: Date,
  timeZone?: string | null,
): Promise<RecordListFilter[]> {
  if (!serialized) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
    if (!isPlainObject(raw)) throw invalidRecordFilter();
    if (
      !('version' in raw && typeof raw.version === 'number') &&
      !('match' in raw && 'conditions' in raw)
    )
      raw = legacyFiltersToRule(raw, queryFields(resolved));
  } catch {
    throw invalidRecordFilter();
  }
  const rule = await validateRecordFilterRule(raw, resolved, context, (id) =>
    store.memberExists(id),
  );
  const needsZone = leaves(rule).some(
    (c) =>
      c.operator === 'dueThroughToday' ||
      c.operator === 'relative' ||
      (fieldType(resolved, c.fieldKey) === 'DATETIME' &&
        c.operator !== 'empty' &&
        c.operator !== 'notEmpty'),
  );
  const zone =
    needsZone && timeZone === undefined
      ? await store.getTenantTimezone?.()
      : timeZone;
  if (needsZone && !isValidFollowUpTimeZone(zone ?? null)) {
    throw new ApiException('INTERNAL_ERROR', 500, {
      message: '租户时区配置无效，请联系平台管理员。',
    });
  }
  const today = needsZone ? localDateAt(now, zone!) : '';
  const midnights = new Map<string, string>();
  function midnight(date: string) {
    let instant = midnights.get(date);
    if (!instant) {
      instant = localMidnightUtc(date, zone!).toISOString();
      midnights.set(date, instant);
    }
    return instant;
  }
  function compile(node: FilterCondition | FilterGroup): RecordListFilter {
    if ('conditions' in node)
      return {
        mode: 'GROUP',
        match: node.match,
        conditions: node.conditions.map(compile),
      };
    const { fieldKey, operator, value } = node;
    const type = fieldType(resolved, fieldKey);
    if (operator === 'empty' || operator === 'notEmpty')
      return { fieldKey, mode: operator === 'empty' ? 'EMPTY' : 'NOT_EMPTY' };
    if (operator === 'dueThroughToday') {
      const any =
        isPlainObject(value) &&
        'assignee' in value &&
        value.assignee === 'any' &&
        context.role === 'TENANT_ADMIN';
      return {
        mode: 'FOLLOW_UP',
        assigneeMemberId: any ? null : context.memberId,
        before: midnight(addCalendarDays(today, 1)),
      };
    }
    if (operator === 'in' || operator === 'notIn') {
      const ids = value as string[];
      const positive: RecordListFilter =
        type === 'MEMBER' || type === 'OWNER'
          ? {
              fieldKey,
              mode: 'MEMBER_EQUALS',
              values: ids.map((id) => (id === '$me' ? context.memberId : id)),
            }
          : {
              fieldKey,
              mode: type === 'MULTI_SELECT' ? 'CONTAINS' : 'EQUALS',
              values: ids,
            };
      return operator === 'notIn'
        ? { fieldKey, mode: 'NOT', filter: positive }
        : positive;
    }
    if (
      type === 'DATE' ||
      type === 'DATETIME' ||
      (type === 'DATE_TEXT' &&
        ['on', 'after', 'before', 'between', 'relative'].includes(operator))
    ) {
      let from: string | undefined;
      let before: string | undefined;
      if (operator === 'after') from = addCalendarDays(value as string, 1);
      else if (operator === 'before') before = value as string;
      else {
        const range =
          operator === 'relative'
            ? relativeRange(value as string, today)
            : operator === 'between'
              ? (value as { from: string; to: string })
              : { from: value as string, to: value as string };
        from = range.from;
        before = addCalendarDays(range.to, 1);
      }
      return {
        fieldKey,
        mode: 'DATE_RANGE',
        dateType: type,
        ...(from ? { from: type === 'DATETIME' ? midnight(from) : from } : {}),
        ...(before
          ? { before: type === 'DATETIME' ? midnight(before) : before }
          : {}),
      };
    }
    if (type === 'NUMBER' || type === 'MONEY') {
      const scalar = value as string | number;
      const range = value as { from: string | number; to: string | number };
      switch (operator) {
        case 'between':
          return {
            fieldKey,
            mode: 'NUMBER_RANGE',
            min: range.from,
            max: range.to,
          };
        case 'eq':
          return { fieldKey, mode: 'NUMBER_RANGE', min: scalar, max: scalar };
        case 'gte':
          return { fieldKey, mode: 'NUMBER_RANGE', min: scalar };
        case 'lte':
          return { fieldKey, mode: 'NUMBER_RANGE', max: scalar };
        case 'gt':
          return { fieldKey, mode: 'NUMBER_RANGE', gt: scalar };
        case 'lt':
          return { fieldKey, mode: 'NUMBER_RANGE', lt: scalar };
      }
    }
    if (type === 'BOOLEAN')
      return { fieldKey, mode: 'BOOLEAN_EQUALS', value: value as boolean };
    if (operator === 'eq')
      return { fieldKey, mode: 'TEXT_EQUALS', value: value as string };
    const positive: RecordListFilter = {
      fieldKey,
      mode: 'TEXT_CONTAINS',
      contains: value as string,
    };
    return operator === 'notContains'
      ? { fieldKey, mode: 'NOT', filter: positive }
      : positive;
  }
  return rule.match === 'all' ? rule.conditions.map(compile) : [compile(rule)];
}

const SYSTEM_SORTS = new Set<RecordListSystemSort>([
  'updatedAt',
  'createdAt',
  'recordNo',
  'nextFollowUpAt',
]);
const SORTABLE_FIELD_KINDS: Record<string, RecordListFieldSort['kind']> = {
  TEXT: 'TEXT',
  PHONE: 'TEXT',
  EMAIL: 'TEXT',
  NUMBER: 'NUMBER',
  MONEY: 'NUMBER',
  DATE: 'DATE',
  DATETIME: 'DATETIME',
  DATE_TEXT: 'DATE_TEXT',
  SINGLE_SELECT: 'OPTION',
};

export function parseListSort(
  sort: string,
  resolved: ResolvedObjectSchema,
): RecordListQuery['sort'] {
  if (SYSTEM_SORTS.has(sort as RecordListSystemSort)) {
    return sort as RecordListSystemSort;
  }
  const field = queryFields(resolved).find(
    (candidate) => candidate.fieldKey === sort,
  );
  const kind = field
    ? SORTABLE_FIELD_KINDS[recordFilterFieldType(field)]
    : undefined;
  if (!field || !kind) {
    throw new ApiException('RECORD_SORT_INVALID', 400, {
      fieldErrors: { sort: ['请选择当前业务表中可排序的字段。'] },
    });
  }
  if (kind !== 'OPTION') return { fieldKey: field.fieldKey, kind };
  const optionKeys = Array.isArray(field.config.options)
    ? field.config.options.flatMap((option) => {
        if (!isPlainObject(option) || typeof option.key !== 'string') return [];
        return [option.key];
      })
    : [];
  return { fieldKey: field.fieldKey, kind, optionKeys };
}
