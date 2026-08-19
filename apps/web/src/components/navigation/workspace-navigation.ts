export function workspaceNavigation(tenantCode: string) {
  const root = `/workspace/${tenantCode}`;

  return [
    { href: root, label: "工作台" },
    { href: `${root}/statistics`, label: "统计" },
    { href: `${root}/members`, label: "成员管理" },
    { href: `${root}/import-export`, label: "导入导出" },
    { href: `${root}/audit`, label: "审计" },
    { href: `${root}/settings`, label: "设置" },
  ] as const;
}
