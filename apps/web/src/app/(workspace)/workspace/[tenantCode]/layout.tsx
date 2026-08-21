import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { requireRuntimeObjects } from "@/lib/auth/require-runtime-objects";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ tenantCode: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  const businessObjects = await requireRuntimeObjects(workspace.tenantCode);

  return (
    <WorkspaceShell
      tenantCode={workspace.tenantCode}
      tenantName={workspace.tenantName}
      role={workspace.role}
      businessObjects={businessObjects}
    >
      {children}
    </WorkspaceShell>
  );
}
