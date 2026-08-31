import { PlatformAuditView } from "@/features/platform/platform-operations";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = positiveInteger(first(params.page), 1);
  const filters = {
    tenantId: first(params.tenantId),
    action: first(params.action),
    resourceType: first(params.resourceType),
  };
  const client = await createServerApiClient();
  const [auditResult, tenantResult] = await Promise.all([
    client.GET("/api/v1/platform/audit", {
      params: { query: { page, limit: 20, ...defined(filters) } },
    }),
    client.GET("/api/v1/platform/tenants", {
      params: { query: { page: 1, limit: 100 } },
    }),
  ]);
  if (!auditResult.data || !tenantResult.data) {
    const failed = auditResult.data ? tenantResult : auditResult;
    throwApi(failed.error, failed.response.status);
  }
  return (
    <PlatformAuditView
      data={auditResult.data}
      tenants={tenantResult.data.items.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
      }))}
      filters={filters}
    />
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defined<T extends Record<string, string | undefined>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
}

function throwApi(error: unknown, status: number): never {
  const apiError = toApiError(error, status);
  throw Object.assign(new Error(apiError.message), apiError);
}
