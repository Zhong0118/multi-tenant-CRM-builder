import { PlatformOperationsView } from "@/features/platform/platform-operations";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const parsed = Number(rawPage);
  const page = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  const client = await createServerApiClient();
  const result = await client.GET("/api/v1/platform/operations", {
    params: { query: { page, limit: 20 } },
  });
  if (!result.data) {
    const apiError = toApiError(result.error, result.response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }
  return <PlatformOperationsView data={result.data} />;
}
