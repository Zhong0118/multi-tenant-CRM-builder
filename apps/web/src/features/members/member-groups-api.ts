"use client";

import type { components } from "@crm/contracts";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

export type MemberGroup = components["schemas"]["MemberGroupDto"];
export type MemberGroupsResponse = components["schemas"]["MemberGroupListDto"];
export type MemberGroupInput = components["schemas"]["CreateMemberGroupDto"];

export interface MemberGroupsApi {
  list(tenantCode: string): Promise<MemberGroupsResponse>;
  create(tenantCode: string, input: MemberGroupInput): Promise<MemberGroup>;
  update(
    tenantCode: string,
    groupId: string,
    input: MemberGroupInput & { expectedVersion: number },
  ): Promise<MemberGroup>;
  remove(
    tenantCode: string,
    groupId: string,
    expectedVersion: number,
  ): Promise<components["schemas"]["DeleteMemberGroupResponseDto"]>;
}

const GROUPS_PATH = "/api/v1/workspaces/{tenantCode}/member-groups" as const;

export const memberGroupsApi: MemberGroupsApi = {
  async list(tenantCode) {
    return dataOrThrow(
      await browserApiClient.GET(GROUPS_PATH, {
        params: { path: { tenantCode } },
      }),
    );
  },
  async create(tenantCode, input) {
    return dataOrThrow(
      await browserApiClient.POST(GROUPS_PATH, {
        params: { path: { tenantCode } },
        body: input,
      }),
    );
  },
  async update(tenantCode, groupId, input) {
    return dataOrThrow(
      await browserApiClient.PATCH(`${GROUPS_PATH}/{groupId}`, {
        params: { path: { tenantCode, groupId } },
        body: input,
      }),
    );
  },
  async remove(tenantCode, groupId, expectedVersion) {
    return dataOrThrow(
      await browserApiClient.DELETE(`${GROUPS_PATH}/{groupId}`, {
        params: { path: { tenantCode, groupId } },
        body: { expectedVersion },
      }),
    );
  },
};

async function dataOrThrow<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}
