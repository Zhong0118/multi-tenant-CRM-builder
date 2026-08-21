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
  sort: RecordSortField;
  direction: RecordSortDirection;
}

/** Mirrors the API's own defaults so an untouched list needs no query string. */
export const DEFAULT_RECORD_QUERY: RecordQuery = {
  page: 1,
  limit: 20,
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

  return {
    page: positiveInteger(single(params.page)) ?? defaults.page,
    limit: Math.min(
      positiveInteger(single(params.limit)) ?? defaults.limit,
      MAX_LIMIT,
    ),
    search: search === "" ? undefined : search,
    ownerMemberId: ownerMemberId === "" ? undefined : ownerMemberId,
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
  if (query.sort !== defaults.sort) params.set("sort", query.sort);
  if (query.direction !== defaults.direction) {
    params.set("direction", query.direction);
  }
  return params.toString();
}

/** Changing a filter restarts paging; keeping the old page would show nothing. */
export function withFilter(
  query: RecordQuery,
  change: Partial<Pick<RecordQuery, "search" | "ownerMemberId">>,
): RecordQuery {
  return { ...query, ...change, page: 1 };
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
