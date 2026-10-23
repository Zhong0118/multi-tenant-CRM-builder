export interface WorkspaceNavigationItem {
  href: string;
  label: string;
  icon: string;
}

export interface WorkspaceNavigationGroup {
  label: string;
  items: WorkspaceNavigationItem[];
}

/**
 * System destinations only. Business objects come from the published schema at
 * request time, so they are never hard-coded here — that keeps the platform
 * free of any one tenant's object names.
 */
export function workspaceNavigationGroups(
  tenantCode: string,
  role: "TENANT_ADMIN" | "EMPLOYEE",
): { work: WorkspaceNavigationItem[]; admin: WorkspaceNavigationItem[] } {
  const root = `/workspace/${tenantCode}`;

  const shared: WorkspaceNavigationItem[] = [
    {
      href: root,
      label: role === "EMPLOYEE" ? "我的工作台" : "管理工作台",
      icon: "home",
    },
    { href: `${root}/follow-ups`, label: "跟进待办", icon: "calendar" },
    { href: `${root}/ai`, label: "AI 助手", icon: "ai" },
  ];

  return {
    work: shared,
    // Administration is one entry; inside it the sidebar lists its pages.
    admin: role === "EMPLOYEE" ? [] : [
      { href: `${root}/settings`, label: "设置", icon: "settings" },
    ],
  };
}

/** The administration pages, grouped the way the settings sidebar shows them. */
export function workspaceSettingsNavigation(
  tenantCode: string,
): WorkspaceNavigationGroup[] {
  const root = `/workspace/${tenantCode}`;
  return [
    {
      label: "设置",
      items: [{ href: `${root}/settings`, label: "概览", icon: "overview" }],
    },
    {
      label: "成员与权限",
      items: [{ href: `${root}/members`, label: "成员", icon: "members" }],
    },
    {
      label: "数据",
      items: [
        { href: `${root}/settings/objects`, label: "业务表", icon: "object" },
        { href: `${root}/settings/relationships`, label: "关系与自动化", icon: "relation" },
        { href: `${root}/settings/dashboards/home`, label: "工作台配置", icon: "stats" },
      ],
    },
    {
      label: "安全",
      items: [{ href: `${root}/audit`, label: "公司审计", icon: "audit" }],
    },
  ];
}

/** Whether a path belongs to the administration area rather than daily work. */
export function isWorkspaceSettingsPath(tenantCode: string, pathname: string): boolean {
  const root = `/workspace/${tenantCode}`;
  return ["/settings", "/members", "/audit"].some(
    (section) => pathname === `${root}${section}` || pathname.startsWith(`${root}${section}/`),
  );
}

export function workspaceNavigation(
  tenantCode: string,
  role: "TENANT_ADMIN" | "EMPLOYEE",
): WorkspaceNavigationItem[] {
  const groups = workspaceNavigationGroups(tenantCode, role);
  return [
    ...groups.work,
    ...(role === "TENANT_ADMIN"
      ? workspaceSettingsNavigation(tenantCode).flatMap((group) => group.items)
      : []),
  ];
}
