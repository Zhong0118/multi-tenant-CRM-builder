import { notFound } from "next/navigation";

import { ObjectList } from "@/features/objects/object-list";
import type { ObjectDraft } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface ObjectSettingsPageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function ObjectSettingsPage({
  params,
}: ObjectSettingsPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);

  // Object configuration is a tenant-admin capability. An employee reaching
  // this URL directly gets a not-found rather than a hint that it exists.
  if (workspace.role !== "TENANT_ADMIN") notFound();

  const client = await createServerApiClient();
  const result = await client.GET(
    "/api/v1/workspaces/{tenantCode}/object-definitions",
    { params: { path: { tenantCode } } },
  );
  if (!result.data) {
    if (result.response.status === 403 || result.response.status === 404) {
      notFound();
    }
    const apiError = toApiError(result.error, result.response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }

  return (
    <ObjectList
      tenantCode={tenantCode}
      initialDrafts={result.data as ObjectDraft[]}
    />
  );
}
