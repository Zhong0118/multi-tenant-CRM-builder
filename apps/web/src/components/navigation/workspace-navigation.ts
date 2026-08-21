export interface WorkspaceNavigationItem {
  href: string;
  label: string;
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
    { href: root, label: "工作台" },
    { href: `${root}/statistics`, label: "统计" },
    { href: `${root}/members`, label: "成员管理" },
    { href: `${root}/import-export`, label: "导入导出" },
    { href: `${root}/audit`, label: "审计" },
    { href: `${root}/settings`, label: "设置" },
  ];
}
