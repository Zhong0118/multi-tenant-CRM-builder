import { notFound } from "next/navigation";
import { BriefSettings } from "@/features/daily-brief/settings";
import { requireWorkspace } from "@/lib/auth/require-workspace";
export default async function DailyBriefSettingsPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();
  return (
    <BriefSettings
      tenantCode={tenantCode}
      memberId={workspace.memberId}
      key={workspace.memberId + tenantCode}
    />
  );
}
