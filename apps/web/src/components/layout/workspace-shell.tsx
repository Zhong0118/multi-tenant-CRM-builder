"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { NotificationBell } from "@/features/notifications/notification-bell";
import { NavIcon } from "@/components/navigation/nav-icon";
import { ObjectIcon } from "@/components/navigation/object-icon";
import {
  isWorkspaceSettingsPath,
  workspaceNavigationGroups,
  workspaceSettingsNavigation,
} from "@/components/navigation/workspace-navigation";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import { AppShell, type ShellNavGroup, type ShellUser } from "./app-shell";

export interface WorkspaceShellProps {
  children: ReactNode;
  tenantCode: string;
  tenantName: string;
  role: "TENANT_ADMIN" | "EMPLOYEE";
  user: ShellUser;
  businessObjects: RuntimeObjectNavigation[];
}

/**
 * Daily work and company administration use two navigations, as in Linear and
 * Attio: the work sidebar lists the business tables, and "设置" swaps it for
 * the administration pages with a way back.
 */
export function WorkspaceShell({
  children,
  tenantCode,
  tenantName,
  role,
  user,
  businessObjects,
}: WorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const root = `/workspace/${tenantCode}`;
  const navigation = workspaceNavigationGroups(tenantCode, role);
  const systemItems = (items: typeof navigation.work) => items.map((item) => ({
    href: item.href,
    label: item.label,
    icon: <NavIcon name={item.icon} />,
  }));
  const inSettings = role === "TENANT_ADMIN" && isWorkspaceSettingsPath(tenantCode, pathname);

  const workGroups: ShellNavGroup[] = [
    {
      ariaLabel: "工作",
      items: [
        systemItems(navigation.work)[0],
        {
          key: "messages",
          label: "消息",
          render: (state) => <NotificationBell tenantCode={tenantCode} nav={state} />,
        },
        ...systemItems(navigation.work).slice(1),
      ],
    },
    {
      ariaLabel: "业务数据",
      items: businessObjects.map((object) => ({
        href: `${root}/objects/${object.code}`,
        label: object.name,
        icon: <ObjectIcon name={object.icon} />,
      })),
      emptyLabel:
        role === "TENANT_ADMIN"
          ? "还没有已发布的业务表"
          : "尚无已授权的业务对象",
      emptyHref:
        role === "TENANT_ADMIN"
          ? `${root}/settings/objects/new`
          : undefined,
      emptyActionLabel:
        role === "TENANT_ADMIN" ? "创建第一张业务表" : undefined,
    },
  ];

  const settingsGroups: ShellNavGroup[] = [
    {
      ariaLabel: "返回",
      hideLabel: true,
      items: [{
        href: root,
        label: "返回工作区",
        icon: <ArrowLeftOutlined />,
        subtle: true,
      }],
    },
    ...workspaceSettingsNavigation(tenantCode).map((group, index) => ({
      ariaLabel: group.label,
      // The overview needs no heading of its own above it.
      hideLabel: index === 0,
      items: systemItems(group.items),
    })),
  ];

  return (
    <AppShell
      brand={tenantName}
      brandHref={root}
      navGroups={inSettings ? settingsGroups : workGroups}
      footerItems={!inSettings && navigation.admin.length ? systemItems(navigation.admin) : []}
      user={user}
      roleLabel={role === "TENANT_ADMIN" ? "公司管理员" : "员工"}
      showWorkspaceSwitch
    >
      {children}
    </AppShell>
  );
}
