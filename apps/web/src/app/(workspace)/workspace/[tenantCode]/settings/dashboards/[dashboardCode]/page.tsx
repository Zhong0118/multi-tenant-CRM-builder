import { notFound } from "next/navigation";

import { DashboardBuilder } from "@/features/dashboard/dashboard-builder";
import { loadDashboardConfiguration } from "@/features/dashboard/dashboard-server";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface WorkspaceNamedDashboardSettingsPageProps {
  params: Promise<{ tenantCode: string; dashboardCode: string }>;
}

export default async function WorkspaceNamedDashboardSettingsPage({
  params,
}: WorkspaceNamedDashboardSettingsPageProps) {
  const { tenantCode, dashboardCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  const configuration = await loadDashboardConfiguration(
    tenantCode,
    dashboardCode,
  );
  return (
    <DashboardBuilder
      tenantCode={tenantCode}
      dashboardCode={dashboardCode}
      initial={configuration}
    />
  );
}
