export const DASHBOARD_CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const DEFAULT_DASHBOARD_CODE = 'home';
export const DEFAULT_DASHBOARD_NAME = '工作台';

export function slugDashboardCode(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (DASHBOARD_CODE_PATTERN.test(slug)) return slug;
  return DEFAULT_DASHBOARD_CODE;
}

export function nextDashboardCode(base: string, taken: Set<string>): string {
  const root = DASHBOARD_CODE_PATTERN.test(base) ? base : DEFAULT_DASHBOARD_CODE;
  if (!taken.has(root)) return root;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${root.slice(0, 60)}-${index}`.slice(0, 64);
    if (!taken.has(candidate) && DASHBOARD_CODE_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return `${root}-copy`.slice(0, 64);
}

export function isDashboardVisibleTo(
  dashboard: { status: 'ACTIVE' | 'ARCHIVED'; audience: 'ALL' | 'TENANT_ADMIN' | 'EMPLOYEE' },
  role: 'TENANT_ADMIN' | 'EMPLOYEE',
): boolean {
  if (dashboard.status !== 'ACTIVE') return false;
  if (dashboard.audience === 'ALL') return true;
  return dashboard.audience === role;
}
