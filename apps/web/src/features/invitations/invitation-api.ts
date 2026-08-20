"use client";

import type { components } from "@crm/contracts";

import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";

type Schemas = components["schemas"];

export type PersonalInvitation = Schemas["PersonalInvitationResponseDto"] & {
  inviterName?: string;
};
export type InvitationMembership = Schemas["InvitationMembershipResponseDto"];
export type WorkspaceSummary = Schemas["WorkspaceSummaryResponseDto"];

export interface InvitationApi {
  accept(invitationId: string): Promise<InvitationMembership>;
  decline(
    invitationId: string,
  ): Promise<Schemas["InvitationActionResponseDto"]>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
}

async function dataOrThrow<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

export const invitationApi: InvitationApi = {
  async accept(invitationId) {
    return dataOrThrow(
      await browserApiClient.POST(
        "/api/v1/me/invitations/{invitationId}/accept",
        { params: { path: { invitationId } } },
      ),
    );
  },
  async decline(invitationId) {
    return dataOrThrow(
      await browserApiClient.POST(
        "/api/v1/me/invitations/{invitationId}/decline",
        { params: { path: { invitationId } } },
      ),
    );
  },
  async listWorkspaces() {
    return dataOrThrow(await browserApiClient.GET("/api/v1/me/workspaces"));
  },
};
