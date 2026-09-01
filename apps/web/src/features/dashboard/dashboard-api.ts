"use client";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import {
  parseDashboardRuntime,
  parseDraft,
  parsePublication,
  type DashboardDefinitionV2,
} from "./dashboard-types";

const CONFIGURATION_PATH =
  "/api/v1/workspaces/{tenantCode}/dashboard/configuration" as const;
const PREVIEW_PATH =
  "/api/v1/workspaces/{tenantCode}/dashboard/preview" as const;
const PUBLICATION_PATH =
  "/api/v1/workspaces/{tenantCode}/dashboard/publications" as const;

export async function saveDashboardDraft(
  tenantCode: string,
  input: { expectedVersion: number; configuration: DashboardDefinitionV2 },
) {
  const result = await browserApiClient.PUT(CONFIGURATION_PATH, {
    params: { path: { tenantCode } },
    body: {
      expectedVersion: input.expectedVersion,
      configuration: input.configuration as unknown as Record<string, unknown>,
    },
  });
  if (result.data) return parseDraft(result.data);
  throw toApiError(result.error, result.response.status);
}
export async function previewDashboardDraft(
  tenantCode: string,
  input: { expectedVersion: number },
) {
  const to = new Date();
  const from = new Date(to.getTime() - 31 * 24 * 60 * 60 * 1000);
  const result = await browserApiClient.POST(PREVIEW_PATH, {
    params: { path: { tenantCode } },
    body: {
      expectedVersion: input.expectedVersion,
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
    },
  });
  if (result.data) return parseDashboardRuntime(result.data);
  throw toApiError(result.error, result.response.status);
}
export async function publishDashboardDraft(
  tenantCode: string,
  input: { expectedVersion: number },
) {
  const result = await browserApiClient.POST(PUBLICATION_PATH, {
    params: { path: { tenantCode } },
    body: input,
  });
  if (result.data) return parsePublication(result.data);
  throw toApiError(result.error, result.response.status);
}
