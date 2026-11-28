import { PlatformMail } from "@/features/platform/platform-mail";
import { PlatformAiSettings } from "@/features/platform/ai-governance/settings";
import { PlatformTelephonySummary } from "@/features/platform/telephony/line-settings";
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
  const [stats, me] = await Promise.all([
    client.GET("/api/v1/platform/mail/statistics"),
    client.GET("/api/v1/me"),
  ]);
  return (
    <PlatformSettingsView
      status={result.data}
      governance={
        <>
          <PlatformMail
            ready={result.data.mail.ready}
            verified={me.data?.emailStatus === "VERIFIED"}
            items={stats.data?.items ?? null}
          />
          <PlatformAiSettings />
          <PlatformTelephonySummary />
        </>
      }
      checkedAt={new Date().toISOString()}
    />
  );
}
