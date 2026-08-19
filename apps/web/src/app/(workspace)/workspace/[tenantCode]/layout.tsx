import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/layout/workspace-shell";

export interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ tenantCode: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { tenantCode } = await params;

  return <WorkspaceShell tenantCode={tenantCode}>{children}</WorkspaceShell>;
}
