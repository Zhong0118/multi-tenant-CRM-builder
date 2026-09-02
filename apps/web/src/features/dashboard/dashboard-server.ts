import "server-only";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import {
  parseDashboardConfigurationView,
  parseDashboardOverview,
  type DashboardRuntimeResult,
} from "./dashboard-types";

const LIST_PATH = "/api/v1/workspaces/{tenantCode}/dashboards" as const;
const CONFIGURATION_PATH =
  "/api/v1/workspaces/{tenantCode}/dashboards/{dashboardCode}/configuration" as const;
const OVERVIEW_PATH =
  "/api/v1/workspaces/{tenantCode}/dashboards/{dashboardCode}/overview" as const;
const DEFAULT_OVERVIEW_PATH =
  "/api/v1/workspaces/{tenantCode}/dashboards/overview" as const;

export async function loadDashboardConfiguration(
  tenantCode: string,
  dashboardCode: string,
) {
  const client = await createServerApiClient();
  const result = await client.GET(CONFIGURATION_PATH, {
    params: { path: { tenantCode, dashboardCode } },
  });
  if (!result.data) throw toApiError(result.error, result.response.status);
  return parseDashboardConfigurationView(result.data);
}

export async function loadDashboardOverview(
  tenantCode: string,
  dashboardCode?: string,
): Promise<DashboardRuntimeResult> {
  const client = await createServerApiClient();
  const result = dashboardCode
    ? await client.GET(OVERVIEW_PATH, {
        params: { path: { tenantCode, dashboardCode }, query: {} },
      })
    : await client.GET(DEFAULT_OVERVIEW_PATH, {
        params: { path: { tenantCode }, query: {} },
      });
  if (!result.data) throw toApiError(result.error, result.response.status);
  return parseDashboardOverview(result.data);
}

export async function loadDashboardList(tenantCode: string) {
  const client = await createServerApiClient();
  const result = await client.GET(LIST_PATH, {
    params: { path: { tenantCode } },
  });
  if (!result.data) throw toApiError(result.error, result.response.status);
  return result.data;
}
