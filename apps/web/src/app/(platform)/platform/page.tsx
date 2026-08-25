import { PlatformOverview } from "@/features/tenants/platform-overview";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export default async function PlatformPage() {
  const client = await createServerApiClient();
  const [summaryResult, tenantsResult] = await Promise.all([
    client.GET("/api/v1/platform/tenants/summary"),
    client.GET("/api/v1/platform/tenants", {
      params: { query: { page: 1, limit: 8 } },
    }),
  ]);

  if (!summaryResult.data) {
    const apiError = toApiError(
      summaryResult.error,
      summaryResult.response.status,
    );
    throw Object.assign(new Error(apiError.message), apiError);
  }
  if (!tenantsResult.data) {
    const apiError = toApiError(
      tenantsResult.error,
      tenantsResult.response.status,
    );
    throw Object.assign(new Error(apiError.message), apiError);
  }

  return (
    <PlatformOverview
      summary={summaryResult.data}
      tenants={tenantsResult.data}
    />
  );
}
