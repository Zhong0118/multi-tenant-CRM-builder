import { AiAssistantPage } from "@/features/ai/ai-assistant-page";
import { requireRuntimeObjects } from "@/lib/auth/require-runtime-objects";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function AiPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  await requireWorkspace(tenantCode);
  const businessObjects = await requireRuntimeObjects(tenantCode);
  return (
    <AiAssistantPage tenantCode={tenantCode} businessObjects={businessObjects} />
  );
}
