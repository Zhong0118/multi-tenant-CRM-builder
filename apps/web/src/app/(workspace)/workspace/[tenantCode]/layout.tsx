import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { requireRuntimeObjects } from "@/lib/auth/require-runtime-objects";
import { requireUser } from "@/lib/auth/require-user";
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
  const [workspace, user] = await Promise.all([
    requireWorkspace(tenantCode),
    requireUser(`/workspace/${encodeURIComponent(tenantCode)}`),
  ]);
  const businessObjects = await requireRuntimeObjects(workspace.tenantCode);

  return (
    <WorkspaceShell
      tenantCode={workspace.tenantCode}
      tenantName={workspace.tenantName}
      role={workspace.role}
      user={{
        displayName: user.displayName,
        phone: user.phone,
        isPlatformAdmin: user.isPlatformAdmin,
      }}
      businessObjects={businessObjects}
    >
      {children}
    </WorkspaceShell>
  );
}
