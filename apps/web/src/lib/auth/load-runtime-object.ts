import "server-only";

import type { components } from "@crm/contracts";
import { notFound } from "next/navigation";

import {
  parseRuntimeObjectSchema,
  type RecordPage,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import type { DynamicFieldMember } from "@/features/records/dynamic-field";
import type { RecordQuery } from "@/features/records/record-query-state";
import {
  recordRequestParameters,
  isPristineRecordQuery,
  restrictRecordQuery,
  RecordViewUnavailableError,
} from "@/features/records/record-query-state";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export interface RuntimeObjectContext {
  schema: RuntimeObjectSchema;
  members: DynamicFieldMember[];
  isAdmin: boolean;
}

/**
 * Loads the authorized published schema. Inaccessible/unpublished tables stay
 * private; only an explicit authorized OBJECT_ARCHIVED response is explained.
 *
 * Administrators load the roster; GROUP readers receive only their authorized
 * group owner labels from the schema response.
 */
export async function loadRuntimeObject(
  tenantCode: string,
  objectCode: string,
  role: "TENANT_ADMIN" | "EMPLOYEE",
): Promise<RuntimeObjectContext> {
  const client = await createServerApiClient();
  const result = await client.GET(
    "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/schema",
    { params: { path: { tenantCode, objectCode } } },
  );
  if (!result.data) {
    if (
      toApiError(result.error, result.response.status).code ===
      "OBJECT_ARCHIVED"
    )
      throw new ArchivedObjectError();
    if (
      toApiError(result.error, result.response.status).code ===
      "OBJECT_ACTION_FORBIDDEN"
    )
      throw new ObjectAccessRestrictedError();
    if (result.response.status < 500) notFound();
    throw asError(result.error, result.response.status);
  }

  const schema = parseRuntimeObjectSchema(result.data);
  const isAdmin = role === "TENANT_ADMIN";
  const members: DynamicFieldMember[] =
    !isAdmin && schema.scopes.read === "GROUP"
      ? (result.data.ownerMembers ?? []).map(({ id, displayName, status }) => ({
          id,
          displayName,
          status,
        }))
      : [];
  if (isAdmin) {
    let page = 1;
    let loaded = 0;
    while (true) {
      const roster = await client.GET(
        "/api/v1/workspaces/{tenantCode}/members",
        {
          params: { path: { tenantCode }, query: { page, limit: 100 } },
        },
      );
      if (!roster.data) throw asError(roster.error, roster.response.status);
      // Disabled members stay in the roster so the records they still own
      // show their name; every picker offers active members only.
      members.push(
        ...roster.data.items.map((member) => ({
          id: member.id,
          displayName: member.displayName ?? null,
          status: member.status,
        })),
      );
      loaded += roster.data.items.length;
      if (loaded >= roster.data.total || roster.data.items.length === 0) break;
      page += 1;
    }
  }

  return {
    schema,
    members,
    isAdmin,
  };
}

/** Resolve the editable team default before the first server page so a restricted view cannot flash unrelated records. */
export async function resolveInitialRecordQuery(
  tenantCode: string,
  objectCode: string,
  query: RecordQuery,
  schema: RuntimeObjectSchema,
): Promise<RecordQuery> {
  const authorized = restrictRecordQuery(query, schema);
  if (!isPristineRecordQuery(authorized, schema.defaultView.sort)) return authorized;
  const client = await createServerApiClient();
  const result = await client.GET(
    "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/record-views",
    { params: { path: { tenantCode, objectCode } } },
  );
  if (!result.data) {
    if (result.response.status >= 500)
      throw asError(result.error, result.response.status);
    throw new RecordViewUnavailableError();
  }
  const preset = result.data.items.find((view) => view.code === "all");
  if (!preset?.available) {
    const next = result.data.items.find((view) => view.available);
    throw new RecordViewUnavailableError(
      next ? { id: next.id, name: next.name } : null,
    );
  }
  return { ...query, viewId: preset.id };
}

export async function loadRecordPage(
  tenantCode: string,
  objectCode: string,
  query: RecordQuery,
): Promise<RecordPage> {
  const client = await createServerApiClient();
  if (query.baseViewId && !query.viewId) {
    const source = await client.GET(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/record-views/{viewId}",
      {
        params: { path: { tenantCode, objectCode, viewId: query.baseViewId } },
      },
    );
    if (!source.data) {
      if (source.response.status >= 500)
        throw asError(source.error, source.response.status);
      throw new RecordViewUnavailableError();
    }
    if (!source.data.available) throw new RecordViewUnavailableError();
  }
  const result = await client.GET(
    "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records",
    {
      params: {
        path: { tenantCode, objectCode },
        query: recordRequestParameters(query),
      },
    },
  );
  if (!result.data) {
    if (
      toApiError(result.error, result.response.status).code ===
      "OBJECT_ARCHIVED"
    )
      throw new ArchivedObjectError();
    const { code } = toApiError(result.error, result.response.status);
    if (code === "OBJECT_ACTION_FORBIDDEN")
      throw new ObjectAccessRestrictedError();
    if (
      (query.viewId || query.filterRule) &&
      (code === "RECORD_FILTER_INVALID" ||
        code === "RECORD_SORT_INVALID" ||
        code === "VALIDATION_FAILED" ||
        (code === "RECORD_NOT_FOUND" && query.viewId))
    )
      throw new RecordViewUnavailableError();
    if (result.response.status < 500) notFound();
    throw asError(result.error, result.response.status);
  }
  return result.data;
}

export async function loadRecord(
  tenantCode: string,
  objectCode: string,
  recordId: string,
): Promise<components["schemas"]["RecordResponseDto"]> {
  const client = await createServerApiClient();
  const result = await client.GET(
    "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}",
    { params: { path: { tenantCode, objectCode, recordId } } },
  );
  if (!result.data) {
    if (
      toApiError(result.error, result.response.status).code ===
      "OBJECT_ARCHIVED"
    )
      throw new ArchivedObjectError();
    if (result.response.status < 500) notFound();
    throw asError(result.error, result.response.status);
  }
  return result.data;
}

function asError(body: unknown, status: number): Error {
  const apiError = toApiError(body, status);
  return Object.assign(new Error(apiError.message), apiError);
}

export class ArchivedObjectError extends Error {
  readonly code = "OBJECT_ARCHIVED";
  constructor() {
    super("业务表已停用");
  }
}

export class ObjectAccessRestrictedError extends Error {
  constructor() {
    super("访问受限");
  }
}
