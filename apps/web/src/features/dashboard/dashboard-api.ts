"use client";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import {
  parseDashboardRuntime,
  parseDraft,
  parsePublication,
  type DashboardDefinitionV2,
  type DashboardListItem,
} from "./dashboard-types";

const DASHBOARDS_PATH = "/api/v1/workspaces/{tenantCode}/dashboards" as const;
const DASHBOARD_PATH = `${DASHBOARDS_PATH}/{dashboardCode}` as const;
const CONFIGURATION_PATH = `${DASHBOARD_PATH}/configuration` as const;
const PREVIEW_PATH = `${DASHBOARD_PATH}/preview` as const;
const PUBLICATION_PATH = `${DASHBOARD_PATH}/publications` as const;

export async function saveDashboardDraft(
  tenantCode: string,
  dashboardCode: string,
  input: { expectedVersion: number; configuration: DashboardDefinitionV2 },
) {
  const result = await browserApiClient.PUT(CONFIGURATION_PATH, {
    params: { path: { tenantCode, dashboardCode } },
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
  dashboardCode: string,
  input: { expectedVersion: number },
) {
  const to = new Date();
  const from = new Date(to.getTime() - 31 * 24 * 60 * 60 * 1000);
  const result = await browserApiClient.POST(PREVIEW_PATH, {
    params: { path: { tenantCode, dashboardCode } },
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
  dashboardCode: string,
  input: { expectedVersion: number },
) {
  const result = await browserApiClient.POST(PUBLICATION_PATH, {
    params: { path: { tenantCode, dashboardCode } },
    body: input,
  });
  if (result.data) return parsePublication(result.data);
  throw toApiError(result.error, result.response.status);
}

export async function createDashboard(
  tenantCode: string,
  input: { name: string; copyFrom?: string },
) {
  const result = await browserApiClient.POST(DASHBOARDS_PATH, {
    params: { path: { tenantCode } },
    body: input,
  });
  if (result.data) return parseDraft(result.data);
  throw toApiError(result.error, result.response.status);
}

export async function updateDashboard(
  tenantCode: string,
  dashboardCode: string,
  input: { name?: string; audience?: "ALL" | "TENANT_ADMIN" | "EMPLOYEE"; status?: "ACTIVE" | "ARCHIVED" },
) {
  const result = await browserApiClient.PATCH(DASHBOARD_PATH, {
    params: { path: { tenantCode, dashboardCode } },
    body: input,
  });
  if (result.data) return parseDraft(result.data);
  throw toApiError(result.error, result.response.status);
}

export async function setDashboardDefaults(
  tenantCode: string,
  input: { adminDashboardCode?: string; employeeDashboardCode?: string },
) {
  const result = await browserApiClient.PATCH(`${DASHBOARDS_PATH}/defaults`, {
    params: { path: { tenantCode } },
    body: input,
  });
  if (result.data) return result.data;
  throw toApiError(result.error, result.response.status);
}

export async function reorderDashboards(
  tenantCode: string,
  dashboardCodes: string[],
): Promise<DashboardListItem[]> {
  const result = await browserApiClient.PUT(`${DASHBOARDS_PATH}/order`, {
    params: { path: { tenantCode } },
    body: { dashboardCodes },
  });
  if (result.data) return result.data;
  throw toApiError(result.error, result.response.status);
}
