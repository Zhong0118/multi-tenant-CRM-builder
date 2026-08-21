"use client";

import { dataOrThrow } from "@/features/objects/object-api";
import type {
  RecordPage,
  RecordSortDirection,
  RecordSortField,
  RecordSummary,
} from "@/features/objects/object-types";
import { browserApiClient } from "@/lib/api/browser-client";

export interface RecordListQuery {
  page: number;
  limit: number;
  search?: string;
  ownerMemberId?: string;
  sort?: RecordSortField;
  direction?: RecordSortDirection;
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
}

const RECORDS_PATH =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records" as const;
const RECORD_PATH = `${RECORDS_PATH}/{recordId}` as const;

export const recordApi: RecordApi = {
  async list(tenantCode, objectCode, query) {
    return dataOrThrow(
      await browserApiClient.GET(RECORDS_PATH, {
        params: {
          path: { tenantCode, objectCode },
          query: definedEntries(query),
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
};

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
