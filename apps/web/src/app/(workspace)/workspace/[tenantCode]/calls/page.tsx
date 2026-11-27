import { CallsPage } from "@/features/telephony/calls-page";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function WorkspaceCallsPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  return (
    <CallsPage
      key={workspace.memberId + tenantCode}
      tenantCode={tenantCode}
      memberId={workspace.memberId}
      isAdmin={workspace.role === "TENANT_ADMIN"}
    />
  );
}
