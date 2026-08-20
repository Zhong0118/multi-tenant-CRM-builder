import "server-only";

import type { components } from "@crm/contracts";
import { redirect } from "next/navigation";
import { cache } from "react";

import { deniedWorkspaceRoute } from "@/features/workspaces/workspace-access";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export type VerifiedWorkspace =
  components["schemas"]["WorkspaceSummaryResponseDto"];

async function loadWorkspace(tenantCode: string): Promise<VerifiedWorkspace> {
  const returnTo = `/workspace/${encodeURIComponent(tenantCode)}`;
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET(
    "/api/v1/workspaces/{tenantCode}",
    { params: { path: { tenantCode } } },
  );

  if (response.status === 401) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (data) return data;
  if (response.status >= 500) {
    const apiError = toApiError(error, response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }

  const workspaceResult = await client.GET("/api/v1/me/workspaces");
  if (workspaceResult.response.status === 401) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!workspaceResult.data && workspaceResult.response.status >= 500) {
    const apiError = toApiError(
      workspaceResult.error,
      workspaceResult.response.status,
    );
    throw Object.assign(new Error(apiError.message), apiError);
  }
  redirect(deniedWorkspaceRoute(workspaceResult.data ?? []));
}

export const requireWorkspace = cache(loadWorkspace);
