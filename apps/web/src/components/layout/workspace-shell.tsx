"use client";

import type { ReactNode } from "react";

import { NavIcon } from "@/components/navigation/nav-icon";
import { workspaceNavigationGroups } from "@/components/navigation/workspace-navigation";
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
    icon: <NavIcon name="object" />,
  }));

  const navigation = workspaceNavigationGroups(tenantCode, role);
  const systemItems = (items: typeof navigation.work) => items.map((item) => ({
    href: item.href,
    label: item.label,
    icon: <NavIcon name={item.icon} />,
  }));

  return (
    <AppShell
      brand={tenantName}
      brandHref={`/workspace/${tenantCode}`}
      navGroups={[
        {
          ariaLabel: "工作",
          items: systemItems(navigation.work),
        },
        {
          ariaLabel: "业务数据",
          items: objectItems,
          emptyLabel:
            role === "TENANT_ADMIN"
              ? "还没有已发布的业务表"
              : "尚无已授权的业务对象",
          emptyHref:
            role === "TENANT_ADMIN"
              ? `/workspace/${tenantCode}/settings/objects/new`
              : undefined,
          emptyActionLabel:
            role === "TENANT_ADMIN" ? "创建第一张业务表" : undefined,
        },
        ...(navigation.admin.length ? [{
          ariaLabel: "管理",
          items: systemItems(navigation.admin),
        }] : []),
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
