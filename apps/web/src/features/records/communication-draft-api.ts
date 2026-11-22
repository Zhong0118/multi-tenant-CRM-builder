"use client";

import type { components } from "@crm/contracts";
import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";

export type CommunicationDraft =
  components["schemas"]["CommunicationDraftResponseDto"];
export type DraftResult = CommunicationDraft["results"][number];
export type DraftConfirmation =
  | { itemKey: "note"; editedValue: string }
  | { itemKey: "followUp"; editedValue: { title: string; dueAt: string } }
  | { itemKey: "fields"; editedValue: { values: Record<string, unknown> } };

const PATH =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}/communication-drafts" as const;
export const communicationDraftApi = {
  async create(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    body: components["schemas"]["CreateCommunicationDraftDto"],
  ) {
    return dataOrThrow(
      await browserApiClient.POST(PATH, {
        params: { path: { tenantCode, objectCode, recordId } },
        body,
      }),
    );
  },
  async read(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    draftId: string,
  ) {
    return dataOrThrow(
      await browserApiClient.GET(`${PATH}/{draftId}`, {
        params: { path: { tenantCode, objectCode, recordId, draftId } },
      }),
    );
  },
  async confirm(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    draftId: string,
    items: DraftConfirmation[],
  ) {
    return dataOrThrow(
      await browserApiClient.POST(`${PATH}/{draftId}/confirm`, {
        params: { path: { tenantCode, objectCode, recordId, draftId } },
        body: { items },
      }),
    );
  },
};
export type CommunicationDraftApi = typeof communicationDraftApi;
