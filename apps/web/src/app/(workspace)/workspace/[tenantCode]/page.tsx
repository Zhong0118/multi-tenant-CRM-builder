import { loadDashboardOverview } from "@/features/dashboard/dashboard-server";
import { requireRuntimeObjects } from "@/lib/auth/require-runtime-objects";
import { requireUser } from "@/lib/auth/require-user";
import { requireWorkspace } from "@/lib/auth/require-workspace";

import { WorkspaceHomeView } from "./workspace-home-view";

export interface WorkspacePageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const { tenantCode } = await params;
  const [user, workspace, businessObjects, overview] = await Promise.all([
    requireUser(`/workspace/${encodeURIComponent(tenantCode)}`),
    requireWorkspace(tenantCode),
    requireRuntimeObjects(tenantCode),
    loadDashboardOverview(tenantCode),
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
