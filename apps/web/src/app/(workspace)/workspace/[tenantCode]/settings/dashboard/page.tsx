import { notFound, redirect } from "next/navigation";

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
  redirect(`/workspace/${tenantCode}/settings/dashboards/home`);
}
