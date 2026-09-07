"use client";

import { dataOrThrow } from "@/features/objects/object-api";
import type {
  RecordPage,
  RecordSortDirection,
  RecordListSortField,
  RecordSummary,
} from "@/features/objects/object-types";
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
}

const RECORDS_PATH =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records" as const;
const RECORD_PATH = `${RECORDS_PATH}/{recordId}` as const;
const ACTIVITIES_PATH = `${RECORD_PATH}/activities` as const;

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
