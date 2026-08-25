"use client";

import type { ReactNode } from "react";

import { workspaceNavigation } from "@/components/navigation/workspace-navigation";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import { AppShell, type ShellUser } from "./app-shell";

export interface WorkspaceShellProps {
  children: ReactNode;
  tenantCode: string;
  tenantName: string;
  role: "TENANT_ADMIN" | "EMPLOYEE";
  user: ShellUser;
  businessObjects: RuntimeObjectNavigation[];
}

export function WorkspaceShell({
  children,
  tenantCode,
  tenantName,
  role,
  user,
  businessObjects,
}: WorkspaceShellProps) {
  const objectItems = businessObjects.map((object) => ({
    href: `/workspace/${tenantCode}/objects/${object.code}`,
    label: object.name,
  }));

  return (
    <AppShell
      brand={tenantName}
      brandHref={`/workspace/${tenantCode}`}
      navGroups={[
        {
          ariaLabel: "业务对象",
          items: objectItems,
          emptyLabel: "尚无已授权的业务对象",
        },
        {
          ariaLabel: "工作空间",
          items: workspaceNavigation(tenantCode),
        },
      ]}
      headerLeft={<span>{tenantName}</span>}
      user={user}
      roleLabel={role === "TENANT_ADMIN" ? "公司管理员" : "员工"}
      showWorkspaceSwitch
    >
      {children}
    </AppShell>
  );
}
