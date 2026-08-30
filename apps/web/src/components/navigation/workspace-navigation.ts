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

  if (role === "EMPLOYEE") {
    return [{ href: root, label: "我的工作台", icon: "home" }];
  }

  return [
    { href: root, label: "管理工作台", icon: "home" },
    { href: `${root}/members`, label: "成员管理", icon: "members" },
    { href: `${root}/settings`, label: "设置", icon: "settings" },
  ];
}
