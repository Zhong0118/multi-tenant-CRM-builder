import type {
  RecordSortDirection,
  RecordSortField,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

export interface RecordQuery {
  page: number;
  limit: number;
  search?: string;
  ownerMemberId?: string;
  filters: RecordFilters;
  sort: RecordSortField;
  direction: RecordSortDirection;
}

export type RecordDateRangeFilter = { from?: string; to?: string };
export type RecordNumericRangeFilter = { min?: number; max?: number };
export type RecordFilterValue =
  | string[]
  | boolean
  | RecordDateRangeFilter
  | RecordNumericRangeFilter;
export type RecordFilters = Record<string, RecordFilterValue>;

/** Mirrors the API's own defaults so an untouched list needs no query string. */
export const DEFAULT_RECORD_QUERY: RecordQuery = {
  page: 1,
  limit: 20,
  filters: {},
  sort: "updatedAt",
  direction: "desc",
};

const SORT_FIELDS: RecordSortField[] = ["updatedAt", "createdAt", "recordNo"];
const DIRECTIONS: RecordSortDirection[] = ["asc", "desc"];
const MAX_LIMIT = 100;

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Reads the list state out of the URL. Anything the API would reject falls back
 * to the default rather than being forwarded, so a hand-edited URL degrades to
 * a valid list instead of an error.
 */
export function parseRecordQuery(
  params: RawParams,
  publishedSort?: RuntimeObjectSchema["defaultView"]["sort"],
): RecordQuery {
  const defaults: RecordQuery = publishedSort
    ? {
        ...DEFAULT_RECORD_QUERY,
        sort: publishedSort.field,
        direction: publishedSort.direction,
      }
    : DEFAULT_RECORD_QUERY;

  const search = single(params.search)?.trim();
  const ownerMemberId = single(params.ownerMemberId)?.trim();
  const filters = parseOptionFilters(single(params.filters));

  return {
    page: positiveInteger(single(params.page)) ?? defaults.page,
    limit: Math.min(
      positiveInteger(single(params.limit)) ?? defaults.limit,
      MAX_LIMIT,
    ),
    search: search === "" ? undefined : search,
    ownerMemberId: ownerMemberId === "" ? undefined : ownerMemberId,
    filters,
    sort: member(single(params.sort), SORT_FIELDS) ?? defaults.sort,
    direction:
      member(single(params.direction), DIRECTIONS) ?? defaults.direction,
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
  if (query.search) params.set("search", query.search);
  if (query.ownerMemberId) params.set("ownerMemberId", query.ownerMemberId);
  const filters = recordFilterParameter(query.filters);
  if (filters) params.set("filters", filters);
  if (query.sort !== defaults.sort) params.set("sort", query.sort);
  if (query.direction !== defaults.direction) {
    params.set("direction", query.direction);
  }
  return params.toString();
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
  return undefined;
}

function optionalDateBound(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
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
