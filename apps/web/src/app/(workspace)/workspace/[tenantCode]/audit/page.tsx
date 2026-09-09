import { PlatformAuditView } from "@/features/platform/platform-operations";
import { createServerApiClient } from "@/lib/api/server-client";
import { toApiError } from "@/lib/api/api-error";

export default async function WorkspaceAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantCode } = await params;
  const search = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const pageValue = Number(first(search.page));
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const filters = {
    action: first(search.action),
    resourceType: first(search.resourceType),
  };
  const client = await createServerApiClient();
  const result = await client.GET("/api/v1/workspaces/{tenantCode}/audit", {
    params: { path: { tenantCode }, query: { page, limit: 20, ...filters } },
  });
  if (!result.data) {
    const error = toApiError(result.error, result.response.status);
    throw Object.assign(new Error(error.message), error);
  }
  return (
    <PlatformAuditView
      data={result.data}
      tenants={[]}
      filters={filters}
      basePath={`/workspace/${tenantCode}/audit`}
      company
    />
  );
}
