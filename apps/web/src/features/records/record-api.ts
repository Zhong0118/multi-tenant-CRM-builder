"use client";

import { dataOrThrow } from "@/features/objects/object-api";
import type {
  RecordPage,
  RecordSortDirection,
  RecordListSortField,
  RecordSummary,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { browserApiOrigin } from "@/lib/api/api-origin";
import { browserApiClient } from "@/lib/api/browser-client";

import {
  recordFilterParameter,
  type RecordFilters,
} from "./record-query-state";

export interface RecordListQuery {
  page: number;
  limit: number;
  search?: string;
  ownerMemberId?: string;
  filters?: RecordFilters;
  sort?: RecordListSortField;
  direction?: RecordSortDirection;
  columns?: string[];
}

export interface CreateRecordInput {
  values: Record<string, unknown>;
  ownerMemberId?: string | null;
}

export interface UpdateRecordInput {
  version: number;
  values?: Record<string, unknown>;
  ownerMemberId?: string | null;
}

export interface RecordBatchUpdateItem {
  recordId: string;
  version: number;
}

export interface RecordBatchUpdateInput {
  items: RecordBatchUpdateItem[];
  values?: Record<string, unknown>;
  ownerMemberId?: string | null;
}

export interface RecordBatchUpdateResultItem {
  recordId: string;
  status: "UPDATED" | "FAILED";
  record?: RecordSummary;
  error?: { code: string; message: string };
}

export interface RecordBatchUpdateResult {
  updated: number;
  failed: number;
  items: RecordBatchUpdateResultItem[];
}

export const MEMBER_ACTIVITY_TYPES = [
  "CALL",
  "MESSAGE",
  "MEETING",
  "NOTE",
] as const;

export type MemberActivityType = (typeof MEMBER_ACTIVITY_TYPES)[number];

export interface RecordActivity {
  id: string;
  activityType: MemberActivityType;
  content: string;
  nextActionAt: string | null;
  actorMemberId: string | null;
  actorDisplayName: string | null;
  createdAt: string;
}

export interface RecordActivityPage {
  items: RecordActivity[];
  page: number;
  limit: number;
  total: number;
}

export interface CreateRecordActivityInput {
  activityType: MemberActivityType;
  content: string;
  nextActionAt?: string | null;
}

export interface RecordApi {
  list(
    tenantCode: string,
    objectCode: string,
    query: RecordListQuery,
  ): Promise<RecordPage>;
  create(
    tenantCode: string,
    objectCode: string,
    input: CreateRecordInput,
  ): Promise<RecordSummary>;
  detail(
    tenantCode: string,
    objectCode: string,
    recordId: string,
  ): Promise<RecordSummary>;
  update(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    input: UpdateRecordInput,
  ): Promise<RecordSummary>;
  remove(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    version: number,
  ): Promise<{ accepted: true }>;
  listActivities(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    query?: { page?: number; limit?: number },
  ): Promise<RecordActivityPage>;
  createActivity(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    input: CreateRecordActivityInput,
  ): Promise<RecordActivity>;
  export(
    tenantCode: string,
    objectCode: string,
    query: Omit<RecordListQuery, "page" | "limit">,
  ): Promise<void>;
  batchUpdate(
    tenantCode: string,
    objectCode: string,
    input: RecordBatchUpdateInput,
  ): Promise<RecordBatchUpdateResult>;
}

const RECORDS_PATH =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records" as const;
const RECORD_PATH = `${RECORDS_PATH}/{recordId}` as const;
const ACTIVITIES_PATH = `${RECORD_PATH}/activities` as const;
const BATCH_PATH = `${RECORDS_PATH}/batch` as const;

export const recordApi: RecordApi = {
  async list(tenantCode, objectCode, query) {
    const { filters, ...rest } = query;
    return dataOrThrow(
      await browserApiClient.GET(RECORDS_PATH, {
        params: {
          path: { tenantCode, objectCode },
          query: definedEntries({
            ...rest,
            filters: filters ? recordFilterParameter(filters) : undefined,
          }),
        },
      }),
    );
  },
  async create(tenantCode, objectCode, input) {
    return dataOrThrow(
      await browserApiClient.POST(RECORDS_PATH, {
        params: { path: { tenantCode, objectCode } },
        body: definedEntries(input),
      }),
    );
  },
  async batchUpdate(tenantCode, objectCode, input) {
    return dataOrThrow(
      await browserApiClient.POST(BATCH_PATH, {
        params: { path: { tenantCode, objectCode } },
        body: definedEntries(input),
      }),
    );
  },
  async detail(tenantCode, objectCode, recordId) {
    return dataOrThrow(
      await browserApiClient.GET(RECORD_PATH, {
        params: { path: { tenantCode, objectCode, recordId } },
      }),
    );
  },
  async update(tenantCode, objectCode, recordId, input) {
    return dataOrThrow(
      await browserApiClient.PATCH(RECORD_PATH, {
        params: { path: { tenantCode, objectCode, recordId } },
        body: definedEntries(input),
      }),
    );
  },
  async remove(tenantCode, objectCode, recordId, version) {
    return dataOrThrow(
      await browserApiClient.DELETE(RECORD_PATH, {
        params: { path: { tenantCode, objectCode, recordId } },
        body: { version },
      }),
    );
  },
  async listActivities(tenantCode, objectCode, recordId, query = {}) {
    return dataOrThrow(
      await browserApiClient.GET(ACTIVITIES_PATH, {
        params: {
          path: { tenantCode, objectCode, recordId },
          query: definedEntries({
            page: query.page ?? 1,
            limit: query.limit ?? 20,
          }),
        },
      }),
    );
  },
  async createActivity(tenantCode, objectCode, recordId, input) {
    return dataOrThrow(
      await browserApiClient.POST(ACTIVITIES_PATH, {
        params: { path: { tenantCode, objectCode, recordId } },
        body: definedEntries(input),
      }),
    );
  },
  async export(tenantCode, objectCode, query) {
    const { filters, ...rest } = query;
    const params = new URLSearchParams();
    const { columns, ...queryRest } = rest;
    for (const [key, value] of Object.entries(
      definedEntries({
        ...queryRest,
        filters: filters ? recordFilterParameter(filters) : undefined,
      }),
    )) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    for (const fieldKey of columns ?? []) {
      params.append("columns", fieldKey);
    }
    const search = params.toString();
    const url = `${browserApiOrigin()}/api/v1/workspaces/${encodeURIComponent(
      tenantCode,
    )}/objects/${encodeURIComponent(objectCode)}/records/export${
      search ? `?${search}` : ""
    }`;
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw toApiError(body, response.status);
    }
    const blob = await response.blob();
    const fileName = fileNameFromDisposition(
      response.headers.get("Content-Disposition"),
      `${objectCode}.csv`,
    );
    downloadBlob(blob, fileName);
  },
};

function fileNameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  if (!header) return fallback;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded?.[1]) return decodeURIComponent(encoded[1]);
  const quoted = header.match(/filename="([^"]+)"/i);
  return quoted?.[1] ?? fallback;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

/**
 * An absent filter and an explicitly empty one mean different things to the
 * API, so undefined entries are dropped rather than serialized. A `null`
 * owner survives: it is how a record is handed back to nobody.
 */
function definedEntries<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
