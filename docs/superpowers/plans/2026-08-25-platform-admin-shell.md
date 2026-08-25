# Platform Admin AppShell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one V3 AppShell shared by platform and workspace, then restyle the existing company-management pages and add a tenant-status summary endpoint for the platform overview.

**Architecture:** CSS variables in `globals.css` and Ant Design tokens in `providers.tsx` stay a single palette. `AppShell` owns sidebar width, collapse, header, User Menu, and logout. `PlatformShell` and `WorkspaceShell` only inject navigation, brand, header-left, and the current user. Company pages keep the first-slice tenant API; overview counts come from one new `GET /platform/tenants/summary`.

**Tech Stack:** Next.js 16, React 19, Ant Design 6, `@ant-design/icons`, TanStack Query, NestJS 11, Prisma 7, OpenAPI / `@crm/contracts`, Vitest, Jest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-platform-admin-shell-design.md`

## Global Constraints

- Work inline on `main`; do not create a worktree.
- Never modify, stage, format, or commit `apps/web/src/app/(auth)/register/page.tsx` or `chat会话.md`.
- Do not reset, rebase, or force-push `main`.
- UI copy uses 公司 / 工作空间 / 平台超级管理员; code and routes keep `tenant` and `/platform/tenants*`.
- Do not introduce Inter, Lucide, global search, notification bell, impersonation, password reset for tenant admins, or a five-step create wizard.
- `@ApiProperty` must set `type`. After any DTO or route change run `pnpm contracts:generate`.
- Deep modules stay untouched: object publication, effective access, record-value engine.
- Stage only files this task names. No `git add .`.
- Every task ends with a focused commit.

---

## Planned File Structure

```text
apps/api/src/modules/tenants/
├── dto/platform-tenant.dto.ts          + PlatformTenantSummaryDto
├── tenants.controller.ts               GET summary before :tenantId
├── tenants.service.ts                  summarize()
├── tenants.repository.ts               count tenants grouped by status
└── tenants.service.spec.ts             summary grouping

apps/web/src/
├── app/globals.css                     V3 tokens
├── app/providers.tsx                   matching Ant Design tokens
├── app/(platform)/platform/layout.tsx  pass user into PlatformShell
├── app/(platform)/platform/page.tsx    overview
├── app/(platform)/platform/tenants/**  restyled list / new / detail
├── app/(workspace)/workspace/[tenantCode]/layout.tsx  pass user
├── components/layout/
│   ├── app-shell.tsx
│   ├── sidebar.tsx
│   ├── top-header.tsx
│   ├── user-menu.tsx
│   ├── page-header.tsx
│   ├── platform-shell.tsx              assembles AppShell
│   └── workspace-shell.tsx             assembles AppShell
├── components/navigation/platform-navigation.ts
└── features/tenants/
    ├── mask-phone.ts
    ├── platform-overview.tsx
    └── tenants.module.css
```

## Spec Coverage Map

| Spec requirement | Task |
|---|---|
| V3 tokens in CSS and ConfigProvider | 1 |
| AppShell, Sidebar 240/64, Header 64, collapse, logout | 2 |
| User Menu, phone mask, account security, no search/notify | 2 |
| Platform nav copy; PlatformShell + layout pass user | 2 |
| WorkspaceShell swap; keep object grouping | 3 |
| GET `/platform/tenants/summary` + contracts | 4 |
| Overview KPIs + 8-row table + empty state | 5 |
| Company list / create / detail restyle | 6 |
| Placeholder pages use PageHeader | 6 |
| HANDOFF.md verification commands | 6 commit / human |

---

### Task 1: Align V3 Design Tokens

**Files:**

- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/providers.tsx`
- Test: `apps/web/src/app/providers.test.ts` (create)

**Interfaces:**

- Consumes: current `TOKENS` object and `:root` custom properties.
- Produces: identical V3 values in CSS variables and Ant Design `theme.token`.

- [ ] **Step 1: Write a failing token-contract test**

Create `apps/web/src/app/providers.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { TOKENS } from "./providers";

describe("design tokens", () => {
  it("keeps Ant Design tokens identical to globals.css custom properties", () => {
    const css = readFileSync(resolve(import.meta.dirname, "globals.css"), "utf8");

    expect(TOKENS.textPrimary).toBe("#0F172A");
    expect(TOKENS.primary).toBe("#2563EB");
    expect(TOKENS.page).toBe("#F8FAFC");
    expect(TOKENS.surface).toBe("#FFFFFF");
    expect(TOKENS.border).toBe("#E2E8F0");
    expect(TOKENS.textSecondary).toBe("#475569");
    expect(TOKENS.success).toBe("#0F766E");
    expect(TOKENS.warning).toBe("#B45309");
    expect(TOKENS.danger).toBe("#B42318");

    expect(css).toContain(`--text-primary: ${TOKENS.textPrimary.toLowerCase()}`);
    expect(css).toContain(`--color-primary: ${TOKENS.primary.toLowerCase()}`);
    expect(css).toContain(`--bg-page: ${TOKENS.page.toLowerCase()}`);
    expect(css).toContain(`--border-default: ${TOKENS.border.toLowerCase()}`);
    expect(css).toContain(`--color-success: ${TOKENS.success.toLowerCase()}`);
    expect(css).not.toContain("#172033");
    expect(css).not.toContain("#2457d6");
    expect(css).not.toContain("#f5f7fa");
  });
});
```

Export `TOKENS` from `providers.tsx` (named export). Keep `Providers` as the default-used function.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web test -- src/app/providers.test.ts
```

Expected: FAIL because `TOKENS` is not exported and still uses Ledger Ink / Working Blue values.

- [ ] **Step 3: Replace tokens in both files**

`globals.css` `:root` (keep `--font-ui` / `--font-mono` / `--font-label` as they are):

```css
:root {
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-active: #1e40af;
  --color-primary-soft: #eff6ff;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-tertiary: #64748b;
  --text-disabled: #94a3b8;
  --border-default: #e2e8f0;
  --border-strong: #cbd5e1;
  --bg-page: #f8fafc;
  --bg-surface: #ffffff;
  --bg-hover: #f1f5f9;
  --bg-selected: #eff6ff;
  --color-success: #0f766e;
  --color-warning: #b45309;
  --color-danger: #b42318;

  --font-ui:
    "IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei",
    sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-label: "IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif;

  --background: var(--bg-page);
  --foreground: var(--text-primary);
}
```

Keep `:focus-visible { outline: 2px solid var(--color-primary); }`.

Compatibility aliases so existing CSS modules that still say `var(--ledger-ink)` do not go unstyled this task:

```css
--ledger-ink: var(--text-primary);
--working-blue: var(--color-primary);
--canvas: var(--bg-page);
--paper: var(--bg-surface);
--rule: var(--border-default);
--verified-teal: var(--color-success);
--review-amber: var(--color-warning);
--stop-red: var(--color-danger);
--ink-secondary: var(--text-secondary);
```

`providers.tsx`:

```ts
export const TOKENS = {
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  primary: "#2563EB",
  page: "#F8FAFC",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  hover: "#F1F5F9",
  selected: "#EFF6FF",
  success: "#0F766E",
  warning: "#B45309",
  danger: "#B42318",
  fontUi:
    '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
};
```

Map Ant Design:

```ts
token: {
  borderRadius: 6,
  colorBgLayout: TOKENS.page,
  colorBorder: TOKENS.border,
  colorBorderSecondary: TOKENS.border,
  colorError: TOKENS.danger,
  colorPrimary: TOKENS.primary,
  colorSuccess: TOKENS.success,
  colorText: TOKENS.textPrimary,
  colorTextSecondary: TOKENS.textSecondary,
  colorWarning: TOKENS.warning,
  fontFamily: TOKENS.fontUi,
  fontSize: 14,
  controlHeight: 36,
},
components: {
  Table: {
    cellPaddingBlock: 12,
    cellPaddingInline: 12,
    headerBg: TOKENS.surface,
    headerColor: TOKENS.textSecondary,
    headerSplitColor: "transparent",
    rowHoverBg: TOKENS.page,
  },
  Tag: { defaultBg: TOKENS.page, defaultColor: TOKENS.textSecondary },
  Form: { labelColor: TOKENS.textSecondary, verticalLabelPadding: 0 },
  Drawer: { paddingLG: 20 },
  Segmented: { itemSelectedBg: TOKENS.surface },
},
```

Do not change font-family strings.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm --filter @crm/web test -- src/app/providers.test.ts
pnpm --filter @crm/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/providers.tsx apps/web/src/app/providers.test.ts
git commit -m "style(web): align design tokens with the V3 palette"
```

---

### Task 2: Build AppShell and Wire PlatformShell

**Files:**

- Create: `apps/web/src/components/layout/app-shell.tsx`
- Create: `apps/web/src/components/layout/sidebar.tsx`
- Create: `apps/web/src/components/layout/top-header.tsx`
- Create: `apps/web/src/components/layout/user-menu.tsx`
- Create: `apps/web/src/components/layout/page-header.tsx`
- Create: `apps/web/src/components/layout/app-shell.module.css`
- Create: `apps/web/src/components/layout/app-shell.test.tsx`
- Create: `apps/web/src/features/tenants/mask-phone.ts`
- Create: `apps/web/src/features/tenants/mask-phone.test.ts`
- Modify: `apps/web/src/components/navigation/platform-navigation.ts`
- Modify: `apps/web/src/components/layout/platform-shell.tsx`
- Modify: `apps/web/src/app/(platform)/platform/layout.tsx`
- Modify: `apps/web/src/features/auth/logout-button.tsx` (optional icon-only variant)
- Modify: `apps/web/architecture-contract.test.mjs` only if a required path is renamed — do not remove `platform-shell.tsx`

**Interfaces:**

```ts
export interface ShellUser {
  displayName: string;
  phone: string;
  isPlatformAdmin: boolean;
}

export interface ShellNavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

export interface ShellNavGroup {
  ariaLabel: string;
  items: ShellNavItem[];
  emptyLabel?: string;
}

export interface AppShellProps {
  brand: string;
  brandHref: string;
  navGroups: ShellNavGroup[];
  headerLeft: ReactNode;
  user: ShellUser;
  roleLabel: string;
  showWorkspaceSwitch?: boolean;
  children: ReactNode;
}

export function maskPhone(phone: string): string;
```

- Consumes: `LogoutButton` (`POST /api/v1/auth/logout`), `requireUser` fields `displayName` / `phone` / `isPlatformAdmin`.
- Produces: `AppShell`, `PageHeader`, `maskPhone`, updated `platformNavigation`.

- [ ] **Step 1: Write failing phone-mask and shell tests**

`mask-phone.ts` tests:

```ts
import { describe, expect, it } from "vitest";

import { maskPhone } from "./mask-phone";

describe("maskPhone", () => {
  it("masks an E.164 Chinese mobile as 138****8000", () => {
    expect(maskPhone("+8613800138000")).toBe("138****8000");
  });

  it("masks an already national 11-digit number", () => {
    expect(maskPhone("13900000001")).toBe("139****0001");
  });

  it("returns the original value when it is not 11 digits", () => {
    expect(maskPhone("unknown")).toBe("unknown");
  });
});
```

`app-shell.test.tsx` (mock `next/navigation` `usePathname` → `"/platform/tenants"`, `useRouter` with `replace`/`refresh`):

```ts
it("renders company-management navigation and the platform user menu", () => {
  render(
    <AppShell
      brand="平台后台"
      brandHref="/platform"
      navGroups={[
        {
          ariaLabel: "平台导航",
          items: platformNavigation,
        },
      ]}
      headerLeft={<span>公司管理</span>}
      user={{
        displayName: "王明",
        phone: "+8613800138000",
        isPlatformAdmin: true,
      }}
      roleLabel="平台超级管理员"
    >
      <p>内容</p>
    </AppShell>,
  );

  expect(screen.getByRole("link", { name: "公司管理" })).toHaveAttribute(
    "href",
    "/platform/tenants",
  );
  expect(screen.queryByRole("link", { name: "租户" })).not.toBeInTheDocument();
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /平台超级管理员/ }));
  expect(screen.getByText("138****8000")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "账号与安全" })).toHaveAttribute(
    "href",
    "/account/security",
  );
  expect(
    screen.queryByRole("menuitem", { name: "切换工作空间" }),
  ).not.toBeInTheDocument();
});

it("marks the current platform section and can collapse to icons", () => {
  render(/* same AppShell, pathname /platform/tenants/abc */);
  expect(screen.getByRole("link", { name: "公司管理" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("button", { name: "收起菜单" }));
  expect(screen.getByRole("navigation", { name: "平台导航" })).toHaveAttribute(
    "data-collapsed",
    "true",
  );
});
```

Update `platform-navigation.ts` labels in the same task after RED:

```ts
export const platformNavigation = [
  { href: "/platform", label: "总览" },
  { href: "/platform/tenants", label: "公司管理" },
  { href: "/platform/templates", label: "模板" },
  { href: "/platform/jobs", label: "后台任务" },
  { href: "/platform/audit", label: "日志中心" },
  { href: "/platform/settings", label: "系统设置" },
] as const;
```

Do not add 权限配置 / Dashboard / 飞书.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web test -- src/features/tenants/mask-phone.test.ts src/components/layout/app-shell.test.tsx
```

Expected: FAIL on missing modules / old「租户」label.

- [ ] **Step 3: Implement maskPhone**

```ts
const NATIONAL = /^(?:\+86)?(1[3-9]\d{9})$/;

export function maskPhone(phone: string): string {
  const match = phone.trim().replace(/[\s-]/g, "").match(NATIONAL);
  if (!match) return phone;
  const national = match[1];
  return `${national.slice(0, 3)}****${national.slice(7)}`;
}
```

- [ ] **Step 4: Implement layout CSS and components**

`app-shell.module.css` canonical sizes:

```css
.shell { min-height: 100vh; }
.sidebar {
  display: flex;
  flex-direction: column;
  width: 240px;
  flex: 0 0 240px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-default);
}
.sidebarCollapsed { width: 64px; flex-basis: 64px; }
.brand {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.nav { flex: 1; padding: 8px; }
.navItem {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  color: #334155;
}
.navItem:hover { background: var(--bg-hover); color: var(--text-primary); }
.navItemCurrent {
  background: var(--bg-selected);
  color: #1d4ed8;
  font-weight: 500;
}
.bottom {
  padding: 8px;
  border-top: 1px solid var(--border-default);
}
.header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-default);
}
.main { padding: 24px; background: var(--bg-page); min-width: 0; }
@media (max-width: 1439px) { .main { padding: 20px; } }
@media (max-width: 1023px) { .main { padding: 16px; } }
```

`AppShell` client component:

- `useState` collapsed default `false`.
- `useEffect` reads `localStorage.getItem("crm.sidebar.collapsed") === "true"` after mount.
- Toggle writes the same key.
- Current item: `pathname === href` OR (`href` has more than one path segment after the first and `pathname.startsWith(href + "/")`). Special-case `/platform` so it is current only on exact `/platform`.
- Sidebar bottom: button「收起菜单」/「展开菜单」, then logout. Logout uses existing `LogoutButton`. Hover danger can be CSS on `.logout:hover { color: var(--color-danger); }`.
- Collapsed: `data-collapsed="true"` on the nav, hide labels, `Tooltip` on icon buttons. If a nav item has no icon, show the first character of `label`.
- No search input, no notification icon.

`UserMenu`: Ant Design `Dropdown` trigger is a button named `{roleLabel}`. Menu items: disabled header with name + masked phone + role, divider, Link 账号与安全, optional 切换工作空间 (`showWorkspaceSwitch`), divider, 退出登录 calling the same logout helper. Avatar: first character of `displayName` or `平`.

`PageHeader`:

```tsx
export function PageHeader({
  title,
  description,
  extra,
}: {
  title: string;
  description?: string;
  extra?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {extra}
    </header>
  );
}
```

One extra slot, typically the single primary button.

`PlatformShell`:

```tsx
export function PlatformShell({
  children,
  user,
}: {
  children: ReactNode;
  user: ShellUser;
}) {
  const pathname = usePathname();
  return (
    <AppShell
      brand="平台后台"
      brandHref="/platform"
      navGroups={[{ ariaLabel: "平台导航", items: [...platformNavigation] }]}
      headerLeft={<PlatformBreadcrumb pathname={pathname} />}
      user={user}
      roleLabel="平台超级管理员"
    >
      {children}
    </AppShell>
  );
}
```

Breadcrumb rules:

- `/platform` → `总览` (plain text, not a trail)
- `/platform/tenants` exact → `公司管理`
- `/platform/tenants/new` → `公司管理 / 新增公司` (`公司管理` links)
- `/platform/tenants/:id` → `公司管理 / 公司详情` until Task 6 passes the company name; acceptable placeholder: `公司管理` + current page title from children. Prefer reading nothing from the URL id. Task 6 will pass `headerLeft` override if needed. For this task, detail URLs may show `公司管理 / 详情`.
- `/platform/templates` → `模板`, etc.

`layout.tsx`:

```tsx
const user = await requireUser("/platform");
if (!user.isPlatformAdmin) redirect("/workspaces");
return (
  <PlatformShell
    user={{
      displayName: user.displayName,
      phone: user.phone,
      isPlatformAdmin: user.isPlatformAdmin,
    }}
  >
    {children}
  </PlatformShell>
);
```

Keep `LogoutButton` tests passing. If the sidebar needs an icon-only logout, add an optional `iconOnly?: boolean` prop; default remains the labeled button.

- [ ] **Step 5: Verify GREEN**

```bash
pnpm --filter @crm/web test -- src/features/tenants/mask-phone.test.ts src/components/layout/app-shell.test.tsx src/features/auth/logout-button.test.tsx
pnpm --filter @crm/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout apps/web/src/components/navigation/platform-navigation.ts apps/web/src/app/\(platform\)/platform/layout.tsx apps/web/src/features/tenants/mask-phone.ts apps/web/src/features/tenants/mask-phone.test.ts apps/web/src/features/auth/logout-button.tsx
git commit -m "feat(web): add the shared AppShell for platform admin"
```

If `logout-button.tsx` is unchanged, omit it from `git add`.

---

### Task 3: Swap WorkspaceShell onto AppShell

**Files:**

- Modify: `apps/web/src/components/layout/workspace-shell.tsx`
- Modify: `apps/web/src/components/layout/workspace-shell.test.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/layout.tsx`

**Interfaces:**

- Consumes: `AppShell`, `ShellUser`, `workspaceNavigation(tenantCode)`, `RuntimeObjectNavigation`.
- Produces: `WorkspaceShell` with extra `user: ShellUser`.

- [ ] **Step 1: Update workspace-shell tests first (they will fail)**

Keep grouping / order / empty-state tests. Change identity assertions:

```tsx
<WorkspaceShell
  tenantCode="northwind"
  tenantName="百杰"
  role="TENANT_ADMIN"
  user={{ displayName: "张三", phone: "+8613900000001", isPlatformAdmin: false }}
  businessObjects={[]}
>
```

Assert:

- `getByText("百杰")` still present (brand + header).
- User menu trigger includes `公司管理员`.
- `tenantCode` `northwind` is **not** required in the sidebar.
- Opening the menu shows `切换工作空间` linking to `/workspaces`.
- Employee role label is `员工`.
- Business nav `aria-label` remains `业务对象`; system nav `工作空间`.

Mock `usePathname` as the current tests do not; add `vi.mock("next/navigation")` returning pathname `/workspace/northwind` and a no-op router.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web test -- src/components/layout/workspace-shell.test.tsx
```

Expected: FAIL because `user` is required and the old Tag/code markup is gone.

- [ ] **Step 3: Implement WorkspaceShell as an AppShell assembler**

```tsx
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
```

When `objectItems` is empty, AppShell must still render `emptyLabel` (existing test: no `navigation` named 业务对象, but the empty copy is visible). Implement that in AppShell if Task 2 did not: a group with zero items and `emptyLabel` renders the text, not a `<nav>`.

Layout:

```tsx
const { tenantCode } = await params;
const [workspace, user] = await Promise.all([
  requireWorkspace(tenantCode),
  requireUser(`/workspace/${encodeURIComponent(tenantCode)}`),
]);
const businessObjects = await requireRuntimeObjects(workspace.tenantCode);

return (
  <WorkspaceShell
    tenantCode={workspace.tenantCode}
    tenantName={workspace.tenantName}
    role={workspace.role}
    user={{
      displayName: user.displayName,
      phone: user.phone,
      isPlatformAdmin: user.isPlatformAdmin,
    }}
    businessObjects={businessObjects}
  >
    {children}
  </WorkspaceShell>
);
```

Do not change record pages, member pages, or object designer content.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm --filter @crm/web test -- src/components/layout/workspace-shell.test.tsx src/components/layout/app-shell.test.tsx
pnpm --filter @crm/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/workspace-shell.tsx apps/web/src/components/layout/workspace-shell.test.tsx apps/web/src/app/\(workspace\)/workspace/\[tenantCode\]/layout.tsx apps/web/src/components/layout/app-shell.tsx apps/web/src/components/layout/app-shell.test.tsx
git commit -m "feat(web): reuse AppShell in the workspace layout"
```

Only add `app-shell.*` if Task 3 needed empty-group behavior there.

---

### Task 4: Add Tenant Summary API and Regenerate Contracts

**Files:**

- Modify: `apps/api/src/modules/tenants/dto/platform-tenant.dto.ts`
- Modify: `apps/api/src/modules/tenants/tenants.service.ts`
- Modify: `apps/api/src/modules/tenants/tenants.repository.ts`
- Modify: `apps/api/src/modules/tenants/tenants.controller.ts`
- Modify: `apps/api/src/modules/tenants/tenants.service.spec.ts`
- Modify: `apps/api/test/platform-tenants.e2e-spec.ts`
- Generated: `packages/contracts/openapi.json` and `packages/contracts/src/generated/openapi.ts` via `pnpm contracts:generate`

**Interfaces:**

```ts
export interface PlatformTenantSummary {
  total: number;
  draft: number;
  active: number;
  suspended: number;
  closed: number;
}

// PlatformTenantStore
summarizeTenants(): Promise<PlatformTenantSummary>;

// PlatformTenantRepository
summarize(actorId: string): Promise<PlatformTenantSummary>;

// TenantsService
summarize(actor: AuthenticatedUser): Promise<PlatformTenantSummary>;
```

HTTP: `GET /api/v1/platform/tenants/summary` → `PlatformTenantSummaryDto`. Guards unchanged (`SessionAuthGuard`, `PlatformAdminGuard`).

- [ ] **Step 1: Write the failing service test**

In `tenants.service.spec.ts`, extend `MemoryStore` with:

```ts
summarizeTenants() {
  const counts = { total: 0, draft: 0, active: 0, suspended: 0, closed: 0 };
  for (const tenant of this.tenants) {
    counts.total += 1;
    if (tenant.status === "DRAFT") counts.draft += 1;
    if (tenant.status === "ACTIVE") counts.active += 1;
    if (tenant.status === "SUSPENDED") counts.suspended += 1;
    if (tenant.status === "CLOSED") counts.closed += 1;
  }
  return Promise.resolve(counts);
}
```

And repository fixture:

```ts
summarize: () => store.summarizeTenants(),
```

Test:

```ts
it("summarizes tenant counts by status without returning rows", async () => {
  const { service, store } = fixture();
  store.tenants.push(
    { id: "a", name: "A", code: "a", status: "DRAFT", activeAdminCount: 0 },
    { id: "b", name: "B", code: "b", status: "ACTIVE", activeAdminCount: 1 },
    { id: "c", name: "C", code: "c", status: "ACTIVE", activeAdminCount: 1 },
    { id: "d", name: "D", code: "d", status: "SUSPENDED", activeAdminCount: 1 },
    { id: "e", name: "E", code: "e", status: "CLOSED", activeAdminCount: 0 },
  );
  await expect(service.summarize(platformAdmin)).resolves.toEqual({
    total: 5,
    draft: 1,
    active: 2,
    suspended: 1,
    closed: 1,
  });
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/api test -- tenants.service.spec.ts
```

Expected: FAIL because `summarize` does not exist.

- [ ] **Step 3: Implement DTO, store, service, controller**

DTO (every `@ApiProperty` has `type: Number`):

```ts
export class PlatformTenantSummaryDto {
  @ApiProperty({ type: Number, minimum: 0 }) total!: number;
  @ApiProperty({ type: Number, minimum: 0 }) draft!: number;
  @ApiProperty({ type: Number, minimum: 0 }) active!: number;
  @ApiProperty({ type: Number, minimum: 0 }) suspended!: number;
  @ApiProperty({ type: Number, minimum: 0 }) closed!: number;
}
```

Repository `summarizeTenants`:

```ts
async summarizeTenants(): Promise<PlatformTenantSummary> {
  const rows = await this.transaction.tenant.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts = { total: 0, draft: 0, active: 0, suspended: 0, closed: 0 };
  for (const row of rows) {
    const n = row._count._all;
    counts.total += n;
    if (row.status === "DRAFT") counts.draft = n;
    if (row.status === "ACTIVE") counts.active = n;
    if (row.status === "SUSPENDED") counts.suspended = n;
    if (row.status === "CLOSED") counts.closed = n;
  }
  return counts;
}
```

Do not set `app.tenant_id` for this query. `summarize(actorId)` wraps it in `transaction(actorId, store => store.summarizeTenants())`.

Controller: declare `@Get('summary')` **above** `@Get(':tenantId')`:

```ts
@Get('summary')
@ApiOkResponse({ type: PlatformTenantSummaryDto })
summarize(@CurrentSession() current: SessionPrincipal) {
  return this.tenants.summarize(current.user);
}
```

- [ ] **Step 4: Extend platform-tenants e2e**

In the existing success flow after create (status DRAFT), assert:

```ts
const summary = await platform.get('/api/v1/platform/tenants/summary').expect(200);
expect(summary.body).toMatchObject({
  total: 1,
  draft: 1,
  active: 0,
  suspended: 0,
  closed: 0,
});
await regular.get('/api/v1/platform/tenants/summary').expect(403);
```

After the test later activates the tenant (read the rest of the file and hook the assertion next to the existing ACTIVE expectation), expect `draft: 0, active: 1`. Do not add a second database lifecycle.

- [ ] **Step 5: Generate contracts and verify**

```bash
pnpm --filter @crm/api test -- tenants.service.spec.ts
pnpm contracts:generate
pnpm contracts:check
pnpm --filter @crm/api typecheck
```

If Docker test DB is already up from the environment:

```bash
set -a && source .env && set +a
pnpm --filter @crm/api test:e2e -- platform-tenants.e2e-spec.ts
```

Expected: PASS. Generated OpenAPI includes `/api/v1/platform/tenants/summary` with numeric properties, not `Record<string, never>`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/tenants apps/api/test/platform-tenants.e2e-spec.ts packages/contracts
git commit -m "feat(api): summarize platform tenants by status"
```

---

### Task 5: Build the Platform Overview Page

**Files:**

- Create: `apps/web/src/features/tenants/platform-overview.tsx`
- Create: `apps/web/src/features/tenants/platform-overview.test.tsx`
- Modify: `apps/web/src/app/(platform)/platform/page.tsx`
- Modify: `apps/web/src/features/tenants/create-tenant-form.tsx` only if adding `summarize` to `TenantApi` — prefer calling `browserApiClient` from a small `tenant-api.ts` or extend `TenantApi` with `summarize` and `list`.

**Interfaces:**

Overview is a Server Component page that fetches:

- `GET /api/v1/platform/tenants/summary`
- `GET /api/v1/platform/tenants?page=1&limit=8`

and renders presentational `PlatformOverview`.

```tsx
export function PlatformOverview({
  summary,
  tenants,
}: {
  summary: components["schemas"]["PlatformTenantSummaryDto"];
  tenants: components["schemas"]["PlatformTenantPageResponseDto"];
}): JSX.Element;
```

Do not hand-write DTO shapes.

- [ ] **Step 1: Write failing overview tests**

```tsx
it("shows an empty state instead of zero KPI cards", () => {
  render(
    <PlatformOverview
      summary={{ total: 0, draft: 0, active: 0, suspended: 0, closed: 0 }}
      tenants={{ items: [], page: 1, limit: 8, total: 0 }}
    />,
  );
  expect(screen.getByRole("heading", { name: "平台总览" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "新增公司" })).toHaveAttribute(
    "href",
    "/platform/tenants/new",
  );
  expect(screen.queryByText("公司总数")).not.toBeInTheDocument();
});

it("renders four status counts and at most eight companies", () => {
  render(
    <PlatformOverview
      summary={{ total: 12, draft: 2, active: 7, suspended: 2, closed: 1 }}
      tenants={{ items: eightTenants, page: 1, limit: 8, total: 12 }}
    />,
  );
  expect(screen.getByText("公司总数")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(screen.getByText("运行中")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "查看全部" })).toHaveAttribute(
    "href",
    "/platform/tenants",
  );
  expect(screen.getAllByRole("row")).toHaveLength(9); // header + 8
  expect(screen.queryByText("今日新增记录")).not.toBeInTheDocument();
});
```

`eightTenants` is a handwritten array of 8 `PlatformTenantResponseDto`-shaped objects. Row click / name link goes to `/platform/tenants/{id}`. Status copy: 草稿 / 运行中 / 已暂停 / 已关闭.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web test -- src/features/tenants/platform-overview.test.tsx
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement overview UI**

KPI row: four surface cards, white + 1px border, no shadow, no colored icon circles. Labels: 公司总数 / 运行中 / 草稿 / 已暂停/已关闭. Fourth value = `suspended + closed`.

Table columns: 名称, 工作空间代码, 状态, 活跃管理员, 创建时间. Use existing `TenantTable` only if it can accept a custom pagination-hidden mode; otherwise a small table in `platform-overview.tsx` is fine. Do not show antd pagination on the overview table.

Page fetch in `page.tsx` with `createServerApiClient`, throw mapped `toApiError` on failure (existing platform pages pattern).

Use `PageHeader` title `平台总览`, description `多公司工作空间的开通与运行状态`, extra = Link button 新增公司.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm --filter @crm/web test -- src/features/tenants/platform-overview.test.tsx src/features/tenants/create-tenant-form.test.tsx
pnpm --filter @crm/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/tenants/platform-overview.tsx apps/web/src/features/tenants/platform-overview.test.tsx apps/web/src/app/\(platform\)/platform/page.tsx
git commit -m "feat(web): show platform tenant status on the overview"
```

---

### Task 6: Restyle Company List, Create, Detail, and Placeholders

**Files:**

- Modify: `apps/web/src/app/(platform)/platform/tenants/page.tsx`
- Modify: `apps/web/src/app/(platform)/platform/tenants/new/page.tsx`
- Modify: `apps/web/src/app/(platform)/platform/tenants/[tenantId]/page.tsx`
- Modify: `apps/web/src/features/tenants/tenant-table.tsx`
- Modify: `apps/web/src/features/tenants/tenant-status-actions.tsx`
- Modify: `apps/web/src/features/tenants/tenants.module.css`
- Modify: `apps/web/src/features/tenants/create-tenant-form.test.tsx` (copy only if assertions break)
- Modify: `apps/web/src/app/(platform)/platform/templates/page.tsx`
- Modify: `apps/web/src/app/(platform)/platform/jobs/page.tsx`
- Modify: `apps/web/src/app/(platform)/platform/audit/page.tsx`
- Modify: `apps/web/src/app/(platform)/platform/settings/page.tsx`
- Modify: `apps/web/src/components/layout/page-placeholder.tsx`
- Modify: `apps/web/src/components/layout/page-placeholder.test.tsx`
- Modify: `apps/web/src/components/layout/page-placeholder.module.css` as needed

**Interfaces:**

- No new API. Keep create fields `name`, `code`, `firstAdminPhone`. Keep status actions `ACTIVE` / `SUSPENDED` / `CLOSED`.
- `PagePlaceholder` stays honest: title, description, 「该能力尚未实现。」

- [ ] **Step 1: Adjust tests that encode old chrome**

`create-tenant-form.test.tsx` must still pass: 创建公司, no password field, activation disabled without admin.

Add to `tenant-table` tests in the same file if none exist — add:

```tsx
it("links the company name to the tenant detail page", () => {
  render(
    <TenantTable
      data={{
        items: [
          {
            id: "tenant-a",
            name: "北辰客户服务",
            code: "northwind",
            status: "ACTIVE",
            activeAdminCount: 1,
            createdAt: "2026-08-21T00:00:00.000Z",
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      }}
    />,
  );
  expect(screen.getByRole("link", { name: "北辰客户服务" })).toHaveAttribute(
    "href",
    "/platform/tenants/tenant-a",
  );
  expect(screen.getByText("运行中")).toBeInTheDocument();
  expect(screen.queryByText("行业")).not.toBeInTheDocument();
});
```

`page-placeholder.test.tsx`: change title to `模板` and expected honest sentence to `该能力尚未实现。` if you change the Alert copy.

- [ ] **Step 2: Run the current tests (some FAIL after copy changes)**

```bash
pnpm --filter @crm/web test -- src/features/tenants/create-tenant-form.test.tsx src/components/layout/page-placeholder.test.tsx
```

- [ ] **Step 3: Restyle pages**

List page:

- `PageHeader` title `公司管理`, description `统一管理公司工作空间的开通状态与首位管理员`, extra Link `+ 新增公司`.
- Remove English eyebrow `COMPANY REGISTRY`.
- Empty: `尚未开通公司` + same extra.
- Table: keep columns 公司 / 工作空间代码 / 状态 / 活跃管理员 / 创建时间. Pagination `?page=`. `onRow` click → detail (stop on the name link). `limit` stays 20.

Create page:

- Breadcrumb is already in the shell; page uses `PageHeader` `新增公司` / `先建立隔离的公司空间，再邀请首位管理员。`
- Keep `CreateTenantForm` fields. Submit label remains `创建公司`; loading `正在创建…` via antd `loading`.
- Keep the three checkpoints aside; restyle border to `var(--color-success)` 3px, no shadow.

Detail page:

- `PageHeader` title `{tenant.name}`, description `工作空间代码：{code}`. Status Tag beside the title (草稿 warning / 运行中 success / 已暂停 warning / 已关闭 default).
- Two definition lists: 基本信息 (名称, 代码, 状态, 激活时间, 创建时间) and 首位管理员 (手机号, 邀请状态, 活跃管理员人数).
- Keep Gate checklist.
- `TenantStatusActions`: primary only for 激活公司; 暂停公司 / 关闭公司 stay in confirm popovers, not in the header. Remove any page-level red 停用.

CSS: delete `box-shadow` from `.tenantTable`, `.createPanel`, `.detailPanel`, `.statusActions`. Use `border: 1px solid var(--border-default); border-radius: 8px;`. Page padding comes from AppShell; drop `padding: 48px clamp(...)` and `h1` 42px. Max title size 24px/32px.

Placeholders:

```tsx
<PagePlaceholder title="模板" description="管理可复用的业务模板。尚未实现。" />
```

Same pattern for 后台任务 / 日志中心 / 系统设置. Alert: `该能力尚未实现。`

- [ ] **Step 4: Full web verification**

```bash
pnpm --filter @crm/web test
pnpm --filter @crm/web typecheck
pnpm --filter @crm/web lint
```

Expected: PASS. `git status` still shows unstaged `register/page.tsx` and untracked `chat会话.md`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(platform\)/platform/tenants apps/web/src/app/\(platform\)/platform/templates/page.tsx apps/web/src/app/\(platform\)/platform/jobs/page.tsx apps/web/src/app/\(platform\)/platform/audit/page.tsx apps/web/src/app/\(platform\)/platform/settings/page.tsx apps/web/src/features/tenants apps/web/src/components/layout/page-placeholder.tsx apps/web/src/components/layout/page-placeholder.test.tsx apps/web/src/components/layout/page-placeholder.module.css
git commit -m "feat(web): restyle platform company pages on the AppShell"
```

Do not add V3 design markdown under `docs/design/` unless the user asked; those files stay untracked.

- [ ] **Step 6: Run the slice gate (evidence before claiming done)**

```bash
set -a && source .env && set +a
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @crm/api test:e2e -- platform-tenants.e2e-spec.ts
pnpm contracts:check
git diff --check
git status --short --branch
```

If format/lint fail on files this slice touched, fix and amend only if the last commit is this slice and unpushed; otherwise a follow-up commit. Never stage `register/page.tsx` or `chat会话.md`.

---

## Execution Notes

- Task 2 may leave `shell.module.css` unused by PlatformShell. Delete its platform-only rules only after WorkspaceShell no longer imports it. If WorkspaceShell still imported it in Task 2, delete the file in Task 3 once both shells use `app-shell.module.css`.
- Ant Design 6: `Alert` uses `title` not `message`; `Space` uses `orientation`; `Form.Item` outside `Form` needs `<Form component={false} layout="vertical">`.
- Platform overview must not invent 今日新增记录 or 活跃用户.
- Manual acceptance after Task 6 is on the user: login as platform admin (`DEV_VERIFICATION_CODE=123456`), walk overview → create → detail → collapse → logout → open a workspace and confirm record pages unchanged.
