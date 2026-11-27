import { notFound } from "next/navigation";

import { TelephonySettingsPage } from "@/features/telephony/telephony-settings";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function CompanyTelephonyPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();
  return (
    <TelephonySettingsPage
      key={workspace.memberId + tenantCode}
      memberId={workspace.memberId}
      tenantCode={tenantCode}
    />
  );
}
