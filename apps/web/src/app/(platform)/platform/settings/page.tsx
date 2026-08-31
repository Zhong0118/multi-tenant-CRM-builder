import { PlatformSettingsView } from "@/features/platform/platform-operations";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export default async function PlatformSettingsPage() {
  const client = await createServerApiClient();
  const result = await client.GET("/api/v1/platform/runtime-status");
  if (!result.data) {
    const apiError = toApiError(result.error, result.response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }
  return <PlatformSettingsView status={result.data} />;
}
