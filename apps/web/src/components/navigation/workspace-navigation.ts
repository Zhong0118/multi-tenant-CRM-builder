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
): WorkspaceNavigationItem[] {
  const root = `/workspace/${tenantCode}`;

  return [
    { href: root, label: "工作台", icon: "home" },
    { href: `${root}/statistics`, label: "统计", icon: "stats" },
    { href: `${root}/members`, label: "成员管理", icon: "members" },
    { href: `${root}/import-export`, label: "导入导出", icon: "import" },
    { href: `${root}/audit`, label: "审计", icon: "audit" },
    { href: `${root}/settings`, label: "设置", icon: "settings" },
  ];
}
