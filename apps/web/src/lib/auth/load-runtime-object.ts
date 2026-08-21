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
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export interface RuntimeObjectContext {
  schema: RuntimeObjectSchema;
  members: DynamicFieldMember[];
  isAdmin: boolean;
}

/**
 * Loads the published schema a member may actually use. A forbidden, archived,
 * unpublished or cross-tenant object is a not-found here: the page must not
 * reveal that it exists somewhere.
 *
 * Member names are only fetched for administrators, since the member roster is
 * an administrator capability.
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
    if (result.response.status < 500) notFound();
    throw asError(result.error, result.response.status);
  }

  const isAdmin = role === "TENANT_ADMIN";
  let members: DynamicFieldMember[] = [];
  if (isAdmin) {
    const roster = await client.GET("/api/v1/workspaces/{tenantCode}/members", {
      params: { path: { tenantCode }, query: { page: 1, limit: 100 } },
    });
    members = (roster.data?.items ?? [])
      .filter((member) => member.status === "ACTIVE")
      .map((member) => ({
        id: member.id,
        displayName: member.displayName ?? null,
      }));
  }

  return {
    schema: parseRuntimeObjectSchema(result.data),
    members,
    isAdmin,
  };
}

export async function loadRecordPage(
  tenantCode: string,
  objectCode: string,
  query: RecordQuery,
): Promise<RecordPage> {
  const client = await createServerApiClient();
  const result = await client.GET(
    "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records",
    {
      params: {
        path: { tenantCode, objectCode },
        query: {
          page: query.page,
          limit: query.limit,
          sort: query.sort,
          direction: query.direction,
          ...(query.search ? { search: query.search } : {}),
          ...(query.ownerMemberId
            ? { ownerMemberId: query.ownerMemberId }
            : {}),
        },
      },
    },
  );
  if (!result.data) {
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
    if (result.response.status < 500) notFound();
    throw asError(result.error, result.response.status);
  }
  return result.data;
}

function asError(body: unknown, status: number): Error {
  const apiError = toApiError(body, status);
  return Object.assign(new Error(apiError.message), apiError);
}
