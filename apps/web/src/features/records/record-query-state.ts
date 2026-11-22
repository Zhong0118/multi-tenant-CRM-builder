import { parseImportDate } from "@/lib/import-date";
import {
  parseFilterRule,
  type FilterRule,
  type operations,
} from "@crm/contracts";
import type {
  RecordListSortField,
  RecordSortDirection,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import {
  isSearchableFieldType,
  SYSTEM_RECORD_SORT_FIELDS,
} from "@/features/objects/object-types";

import {
  POOL_STAGES,
  type PoolStageFilter,
  type PoolQuality,
} from "./record-pool-types";

export class RecordViewUnavailableError extends Error {
  constructor(readonly fallback?: { id: string; name: string } | null) {
    super("该视图条件不可用");
  }
}

export interface RecordQuery {
  viewId?: string;
  baseViewId?: string;
  filterRule?: FilterRule;
  poolStage?: PoolStageFilter;
  poolQuality?: PoolQuality;
  page: number;
  limit: number;
  search?: string;
  ownerMemberId?: string;
  scope?: "mine" | "pool" | "group" | "all";
  filters: RecordFilters;
  sort: RecordListSortField;
  direction: RecordSortDirection;
}

export type RecordDateRangeFilter = { from?: string; to?: string };
export type RecordRelativeDateFilter = { relative: RecordRelativeDatePreset };
export type RecordNumericRangeFilter = { min?: number; max?: number };
export type RecordTextContainsFilter = { contains: string };
export type RecordPresenceFilter = { presence: RecordPresence };
export type RecordRelativeDatePreset =
  | "today"
  | "yesterday"
  | "last_month"
  | "this_week"
  | "this_month"
  | "past_7_days"
  | "past_30_days";
export type RecordPresence = "empty" | "not_empty";
export type RecordFilterValue =
  | string[]
  | boolean
  | RecordDateRangeFilter
  | RecordRelativeDateFilter
  | RecordNumericRangeFilter
  | RecordTextContainsFilter
  | RecordPresenceFilter;

export const RELATIVE_DATE_PRESETS: RecordRelativeDatePreset[] = [
  "today",
  "yesterday",
  "past_7_days",
  "past_30_days",
  "this_week",
  "this_month",
  "last_month",
];

export const RELATIVE_DATE_PRESET_LABELS: Record<
  RecordRelativeDatePreset,
  string
> = {
  today: "今天",
  yesterday: "昨天",
  last_month: "上月",
  this_week: "本周",
  this_month: "本月",
  past_7_days: "近 7 天",
  past_30_days: "近 30 天",
};
export type RecordFilters = Record<string, RecordFilterValue>;

/** Mirrors the API's own defaults so an untouched list needs no query string. */
export const DEFAULT_RECORD_QUERY: RecordQuery = {
  page: 1,
  limit: 20,
  filters: {},
  sort: "updatedAt",
  direction: "desc",
};

const DIRECTIONS: RecordSortDirection[] = ["asc", "desc"];
const MAX_LIMIT = 1000;

type RawParams = Record<string, string | string[] | undefined>;

/**
 * A saved view is authoritative. A preview restores its explicit rule and
 * editable options. Broken previews must never turn into an unrestricted list.
 */
export function parseRecordQuery(
  params: RawParams,
  publishedSort?: RuntimeObjectSchema["defaultView"]["sort"],
  sortableFieldKeys: string[] = [],
): RecordQuery {
  const defaults: RecordQuery = publishedSort
    ? {
        ...DEFAULT_RECORD_QUERY,
        sort: publishedSort.field,
        direction: publishedSort.direction,
      }
    : DEFAULT_RECORD_QUERY;

  const paging = {
    page: positiveInteger(single(params.page)) ?? defaults.page,
    limit: Math.min(
      positiveInteger(single(params.limit)) ?? defaults.limit,
      MAX_LIMIT,
    ),
  };
  const viewId = single(params.viewId);
  if (viewId !== undefined) {
    if (!viewId.trim()) throw new RecordViewUnavailableError();
    return { ...defaults, ...paging, viewId };
  }
  const baseViewId = single(params.baseViewId);
  const serialized = single(params.filters);
  let filterRule: FilterRule | undefined;
  if (serialized) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      if (
        baseViewId !== undefined ||
        /"(version|match|conditions)"\s*:/.test(serialized)
      )
        throw new RecordViewUnavailableError();
    }
    if (
      isPlainObject(parsed) &&
      (typeof parsed.version === "number" ||
        typeof parsed.version === "string" ||
        typeof parsed.match === "string" ||
        ("conditions" in parsed && "match" in parsed))
    ) {
      try {
        if (serialized.length > 4000) throw new RecordViewUnavailableError();
        filterRule = parseFilterRule(parsed);
      } catch {
        throw new RecordViewUnavailableError();
      }
    }
  }
  if (baseViewId !== undefined && (!baseViewId.trim() || !filterRule))
    throw new RecordViewUnavailableError();
  const search = single(params.search)?.trim();
  const ownerMemberId = single(params.ownerMemberId)?.trim();
  const filters = filterRule ? {} : parseOptionFilters(serialized);
  const allowedSorts = [
    ...SYSTEM_RECORD_SORT_FIELDS,
    ...sortableFieldKeys.filter((fieldKey) =>
      /^[a-z][a-zA-Z0-9_]*$/.test(fieldKey),
    ),
  ];

  return {
    ...paging,
    ...(filterRule ? { filterRule } : {}),
    ...(baseViewId ? { baseViewId } : {}),
    search: search === "" ? undefined : search,
    ownerMemberId: ownerMemberId === "" ? undefined : ownerMemberId,
    filters,
    poolStage: member(single(params.poolStage), [...POOL_STAGES, "LEGACY"] as PoolStageFilter[]),
    poolQuality: member(single(params.poolQuality), ["INVALID", "DUPLICATE", "LOST"] as const),
    scope: member(single(params.scope), ["mine", "pool", "group", "all"] as const),
    sort: member(single(params.sort), allowedSorts) ?? defaults.sort,
    direction:
      member(single(params.direction), DIRECTIONS) ?? defaults.direction,
  };
}

export function isPristineRecordQuery(
  query: RecordQuery,
  sort: RuntimeObjectSchema["defaultView"]["sort"],
) {
  return (
    !query.viewId &&
    !query.baseViewId &&
    !query.filterRule &&
    !Object.keys(query.filters).length &&
    !query.search &&
    !query.scope &&
    !query.poolStage &&
    !query.poolQuality &&
    !query.ownerMemberId &&
    query.sort === sort.field &&
    query.direction === sort.direction
  );
}

/** Reopening a saved view or URL must respect the current shared query scope. */
export function restrictRecordQuery(
  query: RecordQuery,
  schema: RuntimeObjectSchema,
): RecordQuery {
  // GROUP is an access ceiling; opening a table still starts with the leader's own records.
  if (
    schema.scopes.read === "GROUP" &&
    !query.scope &&
    !query.ownerMemberId
  ) {
    query = { ...query, scope: "mine" };
  }
  if (schema.queryFieldKeys === undefined) return query;
  const allowed = new Set(schema.queryFieldKeys);
  function hasUnavailableField(group: Pick<FilterRule, "conditions">): boolean {
    return group.conditions.some((term) =>
      "conditions" in term
        ? hasUnavailableField(term)
        : !(
            term.fieldKey === "$owner" ||
            term.fieldKey === "$followUp" ||
            allowed.has(term.fieldKey)
          ),
    );
  }
  if (query.filterRule && hasUnavailableField(query.filterRule))
    throw new RecordViewUnavailableError();
  const searchable = schema.fields.some(
    (field) =>
      allowed.has(field.fieldKey) &&
      (field.fieldKey === schema.object.titleFieldKey ||
        isSearchableFieldType(field.type)),
  );
  return {
    ...query,
    search: searchable ? query.search : undefined,
    filters: Object.fromEntries(
      Object.entries(query.filters).filter(([key]) => allowed.has(key)),
    ),
    sort:
      allowed.has(query.sort) ||
      (SYSTEM_RECORD_SORT_FIELDS as readonly string[]).includes(query.sort)
        ? query.sort
        : schema.defaultView.sort.field,
  };
}

/**
 * Serializes only what differs from the defaults, so the URL stays readable and
 * a default list has no query string to share around.
 */
export function recordQuerySearch(
  query: RecordQuery,
  defaults: RecordQuery = DEFAULT_RECORD_QUERY,
): string {
  const params = new URLSearchParams();
  if (query.page !== defaults.page) params.set("page", String(query.page));
  if (query.limit !== defaults.limit) params.set("limit", String(query.limit));
  if (query.viewId) {
    params.set("viewId", query.viewId);
    return params.toString();
  }
  if (query.baseViewId) params.set("baseViewId", query.baseViewId);
  if (query.search) params.set("search", query.search);
  if (query.scope) params.set("scope", query.scope);
  if (query.poolStage) params.set("poolStage", query.poolStage);
  if (query.poolQuality) params.set("poolQuality", query.poolQuality);
  if (query.ownerMemberId) params.set("ownerMemberId", query.ownerMemberId);
  const filters = query.filterRule
    ? JSON.stringify(query.filterRule)
    : recordFilterParameter(query.filters);
  if (filters) params.set("filters", filters);
  if (query.baseViewId || query.sort !== defaults.sort)
    params.set("sort", query.sort);
  if (query.baseViewId || query.direction !== defaults.direction) {
    params.set("direction", query.direction);
  }
  return params.toString();
}

/** The same transport for SSR, browser refreshes and CSV export. */
export function recordRequestParameters(
  query: Partial<RecordQuery> & { columns?: string[] },
): NonNullable<operations["RecordsController_list"]["parameters"]["query"]> {
  const {
    page,
    limit,
    viewId,
    filterRule,
    filters,
    search,
    scope,
    poolStage,
    poolQuality,
    ownerMemberId,
    sort,
    direction,
    columns,
  } = query;
  const paging = {
    ...(page !== undefined ? { page } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
  if (viewId) return { ...paging, viewId };
  const serialized = filterRule
    ? JSON.stringify(filterRule)
    : filters
      ? recordFilterParameter(filters)
      : "";
  return {
    ...paging,
    ...(serialized ? { filters: serialized } : {}),
    ...(search ? { search } : {}),
    ...(scope ? { scope } : {}),
    ...(poolStage ? { poolStage } : {}),
    ...(poolQuality ? { poolQuality } : {}),
    ...(ownerMemberId ? { ownerMemberId } : {}),
    ...(sort ? { sort } : {}),
    ...(direction ? { direction } : {}),
    ...(columns ? { columns } : {}),
  };
}

/** Changing a filter restarts paging; keeping the old page would show nothing. */
export function withFilter(
  query: RecordQuery,
  change: Partial<Pick<RecordQuery, "search" | "ownerMemberId" | "filters">>,
): RecordQuery {
  return { ...query, ...change, page: 1 };
}

export function recordFilterParameter(filters: RecordFilters): string {
  const normalized = Object.fromEntries(
    Object.entries(filters)
      .map(([fieldKey, value]) => [fieldKey, normalizeFilterValue(value)] as const)
      .filter((entry): entry is [string, RecordFilterValue] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : "";
}

function parseOptionFilters(value: string | undefined): RecordFilters {
  if (!value || value.length > 4000) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isPlainObject(parsed)) return {};
    const entries = Object.entries(parsed);
    if (entries.length > 8) return {};
    const filters: RecordFilters = {};
    for (const [fieldKey, rawValue] of entries) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(fieldKey)) return {};
      const normalized = normalizeFilterValue(rawValue);
      if (normalized === undefined) return {};
      filters[fieldKey] = normalized;
    }
    return filters;
  } catch {
    return {};
  }
}

function normalizeFilterValue(value: unknown): RecordFilterValue | undefined {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (
      value.length === 0 ||
      value.length > 20 ||
      value.some(
        (item) =>
          typeof item !== "string" || item.length === 0 || item.length > 100,
      )
    ) {
      return undefined;
    }
    return [...new Set(value as string[])];
  }
  if (!isPlainObject(value)) return undefined;
  if ("presence" in value) {
    if (value.presence !== "empty" && value.presence !== "not_empty") {
      return undefined;
    }
    return { presence: value.presence };
  }
  if ("relative" in value) {
    if (
      typeof value.relative !== "string" ||
      !RELATIVE_DATE_PRESETS.includes(value.relative as RecordRelativeDatePreset)
    ) {
      return undefined;
    }
    return { relative: value.relative as RecordRelativeDatePreset };
  }
  if ("from" in value || "to" in value) {
    const from = optionalDateBound(value.from);
    const to = optionalDateBound(value.to);
    if (from === false || to === false || (from === undefined && to === undefined)) {
      return undefined;
    }
    if (from && to && from > to) return undefined;
    return {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }
  if ("min" in value || "max" in value) {
    const min = optionalNumericBound(value.min);
    const max = optionalNumericBound(value.max);
    if (min === false || max === false || (min === undefined && max === undefined)) {
      return undefined;
    }
    if (min !== undefined && max !== undefined && min > max) return undefined;
    return {
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
  }
  if ("contains" in value) {
    if (
      typeof value.contains !== "string" ||
      value.contains.length === 0 ||
      value.contains.length > 100
    ) {
      return undefined;
    }
    return { contains: value.contains };
  }
  return undefined;
}

function optionalDateBound(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    parseImportDate(value) !== value
  )
    return false;
  return value;
}

function optionalNumericBound(value: unknown): number | undefined | false {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value;
}

export function isDateRangeFilter(
  value: RecordFilterValue | undefined,
): value is RecordDateRangeFilter {
  return (
    value !== undefined &&
    typeof value !== "boolean" &&
    !Array.isArray(value) &&
    ("from" in value || "to" in value)
  );
}

export function isRelativeDateFilter(
  value: RecordFilterValue | undefined,
): value is RecordRelativeDateFilter {
  return (
    value !== undefined &&
    typeof value !== "boolean" &&
    !Array.isArray(value) &&
    "relative" in value
  );
}

export function isPresenceFilter(
  value: RecordFilterValue | undefined,
): value is RecordPresenceFilter {
  return (
    value !== undefined &&
    typeof value !== "boolean" &&
    !Array.isArray(value) &&
    "presence" in value
  );
}

export function isNumericRangeFilter(
  value: RecordFilterValue | undefined,
): value is RecordNumericRangeFilter {
  return (
    value !== undefined &&
    typeof value !== "boolean" &&
    !Array.isArray(value) &&
    ("min" in value || "max" in value)
  );
}

export function isTextContainsFilter(
  value: RecordFilterValue | undefined,
): value is RecordTextContainsFilter {
  return (
    value !== undefined &&
    typeof value !== "boolean" &&
    !Array.isArray(value) &&
    "contains" in value
  );
}

export function optionFilterValues(
  filters: RecordFilters,
  fieldKey: string,
): string[] {
  const value = filters[fieldKey];
  return Array.isArray(value) ? value : [];
}

export function dateRangeFilterValue(
  filters: RecordFilters,
  fieldKey: string,
): RecordDateRangeFilter | undefined {
  const value = filters[fieldKey];
  return isDateRangeFilter(value) ? value : undefined;
}

export function relativeDateFilterValue(
  filters: RecordFilters,
  fieldKey: string,
): RecordRelativeDatePreset | undefined {
  const value = filters[fieldKey];
  return isRelativeDateFilter(value) ? value.relative : undefined;
}

export function presenceFilterValue(
  filters: RecordFilters,
  fieldKey: string,
): RecordPresence | undefined {
  const value = filters[fieldKey];
  return isPresenceFilter(value) ? value.presence : undefined;
}

export function numericRangeFilterValue(
  filters: RecordFilters,
  fieldKey: string,
): RecordNumericRangeFilter | undefined {
  const value = filters[fieldKey];
  return isNumericRangeFilter(value) ? value : undefined;
}

export function booleanFilterValue(
  filters: RecordFilters,
  fieldKey: string,
): boolean | undefined {
  const value = filters[fieldKey];
  return typeof value === "boolean" ? value : undefined;
}

export function textContainsFilterValue(
  filters: RecordFilters,
  fieldKey: string,
): string | undefined {
  const value = filters[fieldKey];
  return isTextContainsFilter(value) ? value.contains : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function member<T extends string>(
  value: string | undefined,
  allowed: T[],
): T | undefined {
  return value !== undefined && (allowed as string[]).includes(value)
    ? (value as T)
    : undefined;
}
