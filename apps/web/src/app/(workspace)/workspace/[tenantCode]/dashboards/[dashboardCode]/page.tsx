import { loadDashboardOverview, dashboardOverviewQuery } from "@/features/dashboard/dashboard-server";
import { requireRuntimeObjects } from "@/lib/auth/require-runtime-objects";
import { requireUser } from "@/lib/auth/require-user";
import { requireWorkspace } from "@/lib/auth/require-workspace";

import { WorkspaceHomeView } from "../../workspace-home-view";

export interface NamedDashboardPageProps {
  params: Promise<{ tenantCode: string; dashboardCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NamedDashboardPage({
  params,
  searchParams,
}: NamedDashboardPageProps) {
  const { tenantCode, dashboardCode } = await params;
  const period = dashboardOverviewQuery(await searchParams);
  const [user, workspace, businessObjects, overview] = await Promise.all([
    requireUser(`/workspace/${encodeURIComponent(tenantCode)}/dashboards/${encodeURIComponent(dashboardCode)}`),
    requireWorkspace(tenantCode),
    requireRuntimeObjects(tenantCode),
    loadDashboardOverview(tenantCode, dashboardCode, period),
  ]);

  return (
    <WorkspaceHomeView
      tenantCode={workspace.tenantCode}
      tenantName={workspace.tenantName}
      userName={user.displayName}
      role={workspace.role}
      businessObjects={businessObjects}
      overview={overview}
    />
  );
}
