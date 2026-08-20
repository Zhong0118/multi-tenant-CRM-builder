import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/layout/workspace-shell";
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

  return (
    <WorkspaceShell
      tenantCode={workspace.tenantCode}
      tenantName={workspace.tenantName}
      role={workspace.role}
    >
      {children}
    </WorkspaceShell>
  );
}
