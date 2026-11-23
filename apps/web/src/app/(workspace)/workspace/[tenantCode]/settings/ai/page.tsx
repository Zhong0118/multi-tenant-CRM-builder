import { notFound } from "next/navigation";
import { WorkspaceAiSettings } from "@/features/ai-governance/settings-panel";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function CompanyAiPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();
  return (
    <WorkspaceAiSettings
      memberId={workspace.memberId}
      key={workspace.memberId + tenantCode}
      tenantCode={tenantCode}
    />
  );
}
