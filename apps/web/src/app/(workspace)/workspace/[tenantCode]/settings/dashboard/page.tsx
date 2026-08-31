import { notFound } from "next/navigation";

import { DashboardBuilder } from "@/features/dashboard/dashboard-builder";
import { loadDashboardConfiguration } from "@/features/dashboard/dashboard-server";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface WorkspaceDashboardSettingsPageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function WorkspaceDashboardSettingsPage({
  params,
}: WorkspaceDashboardSettingsPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  const configuration = await loadDashboardConfiguration(tenantCode);
  return (
    <DashboardBuilder
      tenantCode={tenantCode}
      initial={configuration}
    />
  );
}
