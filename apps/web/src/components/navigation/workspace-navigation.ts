export interface WorkspaceNavigationItem {
  href: string;
  label: string;
  icon: string;
}

/**
 * System destinations only. Business objects come from the published schema at
 * request time, so they are never hard-coded here — that keeps the platform
 * free of any one tenant's object names.
 */
export function workspaceNavigation(
  tenantCode: string,
  role: "TENANT_ADMIN" | "EMPLOYEE",
): WorkspaceNavigationItem[] {
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

  if (role === "EMPLOYEE") return shared;

  return [
    ...shared,
    { href: `${root}/members`, label: "成员管理", icon: "members" },
    { href: `${root}/audit`, label: "公司审计", icon: "audit" },
    { href: `${root}/settings`, label: "设置", icon: "settings" },
  ];
}
