import { WorkspaceAiAccess } from "@/features/ai-governance/access";
import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { createServerApiClient } from "@/lib/api/server-client";
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
  const [businessObjects, telephony] = await Promise.all([
    requireRuntimeObjects(workspace.tenantCode),
    // Calling is optional: a failed read just leaves the call log out of the menu.
    createServerApiClient()
      .then((client) =>
        client.GET("/api/v1/workspaces/{tenantCode}/telephony/runtime", {
          params: { path: { tenantCode: workspace.tenantCode } },
        }),
      )
      .then((result) => result.data?.enabled ?? false)
      .catch(() => false),
  ]);

  return (
    <WorkspaceAiAccess tenantCode={tenantCode} memberId={workspace.memberId}>
    <WorkspaceShell
      tenantCode={workspace.tenantCode}
      tenantName={workspace.tenantName}
      role={workspace.role}
      user={{
        displayName: user.displayName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
      }}
      businessObjects={businessObjects}
      calls={telephony}
    >
      {children}
    </WorkspaceShell>
    </WorkspaceAiAccess>
  );
}
