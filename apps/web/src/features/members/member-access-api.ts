"use client";

import type { components } from "@crm/contracts";
import { DATA_SCOPE_LABELS } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

type Schemas = components["schemas"];
export type MemberObjectAccessRow = Schemas["MemberObjectAccessResponseDto"];
export type MemberObjectPolicy = Schemas["MemberObjectPolicyResponseDto"];
export type MemberObjectAccessInput = Schemas["MemberObjectAccessDto"];
export const MEMBER_READ_SCOPE_LABELS = {
  ...DATA_SCOPE_LABELS,
  GROUP: "本组成员名下",
};

export interface MemberAccessApi {
  list(tenantCode: string, memberId: string): Promise<MemberObjectAccessRow[]>;
  set(
    tenantCode: string,
    memberId: string,
    objectId: string,
    input: MemberObjectAccessInput,
  ): Promise<MemberObjectAccessRow>;
}

const ACCESS_PATH =
  "/api/v1/workspaces/{tenantCode}/members/{memberId}/object-access" as const;

export const memberAccessApi: MemberAccessApi = {
  async list(tenantCode, memberId) {
    return dataOrThrow(
      await browserApiClient.GET(ACCESS_PATH, {
        params: { path: { tenantCode, memberId } },
      }),
    );
  },
  async set(tenantCode, memberId, objectId, input) {
    return dataOrThrow(
      await browserApiClient.PUT(`${ACCESS_PATH}/{objectId}`, {
        params: { path: { tenantCode, memberId, objectId } },
        body: input,
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
