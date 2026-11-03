import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { CallHistory } from "@/features/telephony/call-history";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function CallsPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  return (
    <Page width="reading">
      <PageHeader
        title="通话记录"
        description={
          workspace.role === "TENANT_ADMIN"
            ? "查看公司外呼结果，返回业务记录继续跟进"
            : "查看我的外呼结果，返回业务记录继续跟进"
        }
      />
      <CallHistory
        tenantCode={tenantCode}
        currentMemberId={workspace.memberId}
        isAdmin={workspace.role === "TENANT_ADMIN"}
      />
    </Page>
  );
}
