import "server-only";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import {
  parseDashboardConfigurationView,
  parseDashboardOverview,
  type DashboardRuntimeResult,
} from "./dashboard-types";
const CONFIGURATION_PATH = "/api/v1/workspaces/{tenantCode}/dashboard/configuration" as const;
const OVERVIEW_PATH = "/api/v1/workspaces/{tenantCode}/dashboard/overview" as const;
export async function loadDashboardConfiguration(tenantCode: string) { const client = await createServerApiClient(); const result = await client.GET(CONFIGURATION_PATH, { params: { path: { tenantCode } } }); if (!result.data) throw toApiError(result.error, result.response.status); return parseDashboardConfigurationView(result.data); }
export async function loadDashboardOverview(tenantCode: string): Promise<DashboardRuntimeResult> { const client = await createServerApiClient(); const result = await client.GET(OVERVIEW_PATH, { params: { path: { tenantCode }, query: {} } }); if (!result.data) throw toApiError(result.error, result.response.status); return parseDashboardOverview(result.data); }
