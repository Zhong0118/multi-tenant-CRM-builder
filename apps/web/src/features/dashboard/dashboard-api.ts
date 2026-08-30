"use client";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import type { DashboardConfiguration } from "./dashboard-types";

const CONFIGURATION_PATH =
  "/api/v1/workspaces/{tenantCode}/dashboard/configuration" as const;

export async function saveDashboardConfiguration(
  tenantCode: string,
  input: { expectedVersion: number; configuration: DashboardConfiguration },
) {
  const result = await browserApiClient.PUT(CONFIGURATION_PATH, {
    params: { path: { tenantCode } },
    body: {
      expectedVersion: input.expectedVersion,
      configuration: input.configuration as unknown as Record<string, unknown>,
    },
  });
  if (result.data) return result.data;
  throw toApiError(result.error, result.response.status);
}
