import { notFound } from "next/navigation";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { TelephonySettings } from "@/features/telephony/telephony-settings";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function TelephonySettingsPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();
  return (
    <Page width="settings">
      <PageHeader
        title="电话外呼"
        description="配置公司接入、成员坐席与业务表电话字段"
      />
      <TelephonySettings
        tenantCode={tenantCode}
        tenantId={workspace.tenantId}
      />
    </Page>
  );
}
