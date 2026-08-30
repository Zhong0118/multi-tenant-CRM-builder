# UI Foundation and AppShell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared B×C visual foundation, workbench primitives, and responsive AppShell that the platform-admin, tenant-admin, and employee redesign phases will all consume.

**Architecture:** Keep the existing Next.js App Router, Ant Design, CSS Modules, and server-authenticated shell boundaries. Make `globals.css` and `Providers.TOKENS` the single source of visual truth, add small semantic workbench primitives, and keep role-specific shells as configuration of one `AppShell`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Ant Design 6, CSS Modules, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-30-core-flow-ui-redesign-design.md`

## Program Split

The approved spec covers four independently testable subsystems. Implement them as separate plans in this order:

1. **This plan:** design tokens, workbench primitives, AppShell, responsive navigation.
2. Platform core flow: overview, companies, templates, initialization.
3. Tenant-admin core flow: workbench, members, object studio, publication review.
4. Employee core flow: workbench, records table, filters, detail Drawer, mobile detail.

Do not begin plans 2–4 until this plan's shared interfaces are merged and verified.

## Global Constraints

- Do not change backend APIs, RLS, tenant isolation, permission semantics, or immutable publication snapshots.
- Do not modify `apps/web/src/app/(auth)/register/page.tsx`.
- Do not stage `.superpowers/sdd/**`, `.claude/worktrees/**`, `chat会话.md`, or unrelated design documents.
- Preserve current uncommitted role-navigation, template-application, workspace-home, and independent-scroll work; Task 1 checkpoints it before foundation edits.
- Use the approved palette exactly: Ink `#17232D`, Ink Hover `#22313D`, Page `#F3F6F8`, Surface `#FFFFFF`, Border `#D8E0E5`, Border Strong `#C8D2D9`, Text `#17232D`, Text Secondary `#687681`, Work Teal `#167568`, Teal Soft `#E7F3F0`, Action Amber `#C66C18`, Amber Soft `#FFF3E5`, Danger `#B42318`.
- Use radius tiers exactly: reading `10px`, controls `6px`, status tags `4px`, data tools `0–2px`.
- Expanded sidebar is `224px`, collapsed sidebar `64px`, top header `56px`, shell height `100dvh`.
- Do not add dependencies, gradients, decorative charts, fake metrics, or fake records.
- Prefer semantic props and user language; do not expose `tenant`, `OWN`, or internal publication terminology in ordinary UI copy.
- Run only each task's focused tests. Run Web typecheck once in the final task.
- Stage exact task files for every commit; never use `git add .`.

---

### Task 1: Checkpoint the already-approved role split and scroll fixes

**Files:**
- Existing changes only:
  - `apps/web/src/app/(platform)/platform/tenants/[tenantId]/page.tsx`
  - `apps/web/src/app/(workspace)/workspace/[tenantCode]/page.tsx`
  - `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home.module.css`
  - `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx`
  - `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx`
  - `apps/web/src/components/layout/app-shell.module.css`
  - `apps/web/src/components/layout/sidebar.tsx`
  - `apps/web/src/components/layout/workspace-shell.tsx`
  - `apps/web/src/components/layout/workspace-shell.test.tsx`
  - `apps/web/src/components/navigation/workspace-navigation.ts`
  - `apps/web/src/features/templates/template-application.tsx`
  - `apps/web/src/features/templates/template-application.test.tsx`
  - `apps/web/src/features/templates/templates.module.css`

**Interfaces:**
- Consumes: current working-tree behavior already approved by the user.
- Produces: a clean committed baseline where employees see only their workbench and authorized objects, admins see management links, company initialization is prominent, and shell areas scroll independently.

- [ ] **Step 1: Confirm protected files are not staged**

Run:

```bash
git status --short
git diff --cached --name-only
```

Expected: `register/page.tsx`, `.superpowers/sdd/**`, `.claude/worktrees/**`, and `chat会话.md` are absent from the staged list.

- [ ] **Step 2: Re-run only the existing focused regression group**

Run:

```bash
pnpm --filter @crm/web exec vitest run \
  src/components/layout/workspace-shell.test.tsx \
  'src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx' \
  src/features/templates/template-application.test.tsx
```

Expected: 3 files pass, 17 tests pass. The jsdom pseudo-element warning is allowed.

- [ ] **Step 3: Stage only the listed baseline files**

Run one explicit `git add` command containing exactly the 13 paths in this task. Then run:

```bash
git diff --cached --name-only
```

Expected: only the 13 paths above are staged.

- [ ] **Step 4: Commit the baseline**

```bash
git commit -m "feat(web): clarify role workspaces and company setup"
```

---

### Task 2: Replace the visual token source and Ant Design theme

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/providers.tsx`
- Modify: `apps/web/src/app/providers.test.ts`

**Interfaces:**
- Consumes: existing `TOKENS` export and CSS custom-property names.
- Produces: `TOKENS` with existing keys preserved plus `ink`, `inkHover`, `borderStrong`, `primarySoft`, and `warningSoft`; matching CSS variables consumed by all later tasks.

- [ ] **Step 1: Write the failing token synchronization test**

Replace the token assertions in `providers.test.ts` with explicit approved values:

```ts
expect(TOKENS.ink).toBe("#17232D");
expect(TOKENS.inkHover).toBe("#22313D");
expect(TOKENS.textPrimary).toBe("#17232D");
expect(TOKENS.textSecondary).toBe("#687681");
expect(TOKENS.primary).toBe("#167568");
expect(TOKENS.primarySoft).toBe("#E7F3F0");
expect(TOKENS.page).toBe("#F3F6F8");
expect(TOKENS.surface).toBe("#FFFFFF");
expect(TOKENS.border).toBe("#D8E0E5");
expect(TOKENS.borderStrong).toBe("#C8D2D9");
expect(TOKENS.warning).toBe("#C66C18");
expect(TOKENS.warningSoft).toBe("#FFF3E5");
expect(TOKENS.danger).toBe("#B42318");
```

Also assert the CSS contains `--shell-ink`, `--radius-reading`, `--radius-control`, `--radius-status`, `--radius-data`, `--sidebar-width`, and `--header-height` with the approved values.

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @crm/web exec vitest run src/app/providers.test.ts
```

Expected: FAIL because `TOKENS.ink` and the new CSS variables do not exist.

- [ ] **Step 3: Implement the token object**

Keep existing property names for consumers and add the missing semantic values:

```ts
export const TOKENS = {
  ink: "#17232D",
  inkHover: "#22313D",
  textPrimary: "#17232D",
  textSecondary: "#687681",
  primary: "#167568",
  primarySoft: "#E7F3F0",
  page: "#F3F6F8",
  surface: "#FFFFFF",
  border: "#D8E0E5",
  borderStrong: "#C8D2D9",
  hover: "#EEF2F4",
  selected: "#E7F3F0",
  success: "#167568",
  warning: "#C66C18",
  warningSoft: "#FFF3E5",
  danger: "#B42318",
  fontUi:
    '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
};
```

Configure Ant Design with `borderRadius: 6`, `borderRadiusLG: 10`, `controlHeight: 34`, table header `#F7F9FA`, compact 11px/13px table padding, and the same semantic colors. Do not theme feature-specific business colors here.

- [ ] **Step 4: Implement matching CSS variables**

Make `globals.css` define at minimum:

```css
:root {
  --shell-ink: #17232d;
  --shell-ink-hover: #22313d;
  --color-primary: #167568;
  --color-primary-hover: #115f55;
  --color-primary-active: #0d5149;
  --color-primary-soft: #e7f3f0;
  --color-warning: #c66c18;
  --color-warning-soft: #fff3e5;
  --color-danger: #b42318;
  --text-primary: #17232d;
  --text-secondary: #687681;
  --text-tertiary: #7c8992;
  --text-disabled: #9ba6ad;
  --border-default: #d8e0e5;
  --border-strong: #c8d2d9;
  --bg-page: #f3f6f8;
  --bg-surface: #ffffff;
  --bg-hover: #eef2f4;
  --bg-selected: #e7f3f0;
  --radius-reading: 10px;
  --radius-control: 6px;
  --radius-status: 4px;
  --radius-data: 2px;
  --sidebar-width: 224px;
  --sidebar-collapsed-width: 64px;
  --header-height: 56px;
}
```

Retain typography aliases used by existing modules so this task does not break unrelated pages.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm --filter @crm/web exec vitest run src/app/providers.test.ts
git add apps/web/src/app/globals.css apps/web/src/app/providers.tsx apps/web/src/app/providers.test.ts
git commit -m "feat(web): establish hybrid workbench tokens"
```

Expected: the focused test passes.

---

### Task 3: Add semantic surfaces and status tags

**Files:**
- Create: `apps/web/src/components/workbench/surface.tsx`
- Create: `apps/web/src/components/workbench/surface.module.css`
- Create: `apps/web/src/components/workbench/status-tag.tsx`
- Create: `apps/web/src/components/workbench/status-tag.module.css`
- Create: `apps/web/src/components/workbench/surface.test.tsx`

**Interfaces:**
- Consumes: approved global CSS variables from Task 2.
- Produces:

```ts
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
export function DataPanel(props: SurfaceProps): ReactNode;
export function ReadingPanel(props: SurfaceProps): ReactNode;
export function StatusTag(props: { children: ReactNode; tone?: StatusTone }): ReactNode;
```

`SurfaceProps` is `{ children: ReactNode; className?: string; ariaLabel?: string }`.

- [ ] **Step 1: Write the failing semantic rendering tests**

```tsx
it("separates data tools from reading surfaces", () => {
  render(
    <>
      <DataPanel ariaLabel="业务表"><span>表格</span></DataPanel>
      <ReadingPanel ariaLabel="下一步"><span>说明</span></ReadingPanel>
    </>,
  );
  expect(screen.getByRole("region", { name: "业务表" })).toHaveAttribute(
    "data-surface",
    "data",
  );
  expect(screen.getByRole("region", { name: "下一步" })).toHaveAttribute(
    "data-surface",
    "reading",
  );
});

it("renders status tone without relying on color-only text", () => {
  render(<StatusTag tone="warning">草稿</StatusTag>);
  expect(screen.getByText("草稿")).toHaveAttribute("data-tone", "warning");
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web exec vitest run src/components/workbench/surface.test.tsx
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement focused components**

Use semantic `<section>` elements for surfaces, merge optional `className` without a dependency, and render `StatusTag` as `<span data-tone={tone}>`. CSS requirements:

```css
.dataPanel {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-data);
  background: var(--bg-surface);
}

.readingPanel {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-reading);
  background: var(--bg-surface);
}
```

Status tags use 4px radius and include text; warning uses amber, success uses teal, danger uses red, and neutral uses gray.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @crm/web exec vitest run src/components/workbench/surface.test.tsx
git add apps/web/src/components/workbench/surface.tsx apps/web/src/components/workbench/surface.module.css apps/web/src/components/workbench/status-tag.tsx apps/web/src/components/workbench/status-tag.module.css apps/web/src/components/workbench/surface.test.tsx
git commit -m "feat(web): add semantic workbench surfaces"
```

---

### Task 4: Add the cross-role process rail

**Files:**
- Create: `apps/web/src/components/workbench/process-rail.tsx`
- Create: `apps/web/src/components/workbench/process-rail.module.css`
- Create: `apps/web/src/components/workbench/process-rail.test.tsx`

**Interfaces:**
- Consumes: Task 2 tokens.
- Produces:

```ts
export type ProcessStepState = "complete" | "current" | "upcoming";
export interface ProcessStep {
  key: string;
  label: string;
  description: string;
  state: ProcessStepState;
}
export function ProcessRail(props: {
  ariaLabel: string;
  steps: ProcessStep[];
}): ReactNode;
```

- [ ] **Step 1: Write the failing behavior test**

```tsx
it("announces the current step and preserves ordered progress", () => {
  render(
    <ProcessRail
      ariaLabel="公司配置进度"
      steps={[
        { key: "company", label: "公司已创建", description: "邀请已发送", state: "complete" },
        { key: "tables", label: "初始化业务表", description: "选择表方案", state: "current" },
        { key: "publish", label: "管理员发布", description: "权限检查后启用", state: "upcoming" },
      ]}
    />,
  );
  const list = screen.getByRole("list", { name: "公司配置进度" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByText("初始化业务表").closest("li")).toHaveAttribute(
    "aria-current",
    "step",
  );
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web exec vitest run src/components/workbench/process-rail.test.tsx
```

- [ ] **Step 3: Implement the process rail**

Render an ordered list, mark only the current item with `aria-current="step"`, display a checkmark for complete steps and a one-based index otherwise. Use a 10px outer radius, square internal separators, teal complete/current state, and text plus icon so color is never the only signal.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @crm/web exec vitest run src/components/workbench/process-rail.test.tsx
git add apps/web/src/components/workbench/process-rail.tsx apps/web/src/components/workbench/process-rail.module.css apps/web/src/components/workbench/process-rail.test.tsx
git commit -m "feat(web): add cross-role process rail"
```

---

### Task 5: Rebuild AppShell for desktop and mobile

**Files:**
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify: `apps/web/src/components/layout/top-header.tsx`
- Modify: `apps/web/src/components/layout/app-shell.module.css`
- Modify: `apps/web/src/components/layout/app-shell.test.tsx`
- Modify: `apps/web/src/components/layout/workspace-shell.test.tsx`

**Interfaces:**
- Consumes: existing `AppShellProps`, `ShellNavGroup`, and role-specific shell callers.
- Produces: unchanged public `AppShellProps`; internal mobile navigation state; `Sidebar` receives `mobileOpen` and `onMobileClose`; `TopHeader` receives `onOpenNavigation`.

- [ ] **Step 1: Add failing shell interaction tests**

Extend `app-shell.test.tsx`:

```tsx
it("opens and closes the temporary navigation", () => {
  renderShell();
  fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
  expect(screen.getByRole("complementary")).toHaveAttribute(
    "data-mobile-open",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭导航" }));
  expect(screen.getByRole("complementary")).not.toHaveAttribute(
    "data-mobile-open",
    "true",
  );
});

it("keeps the shell scroll regions explicit", () => {
  renderShell();
  expect(screen.getByRole("main")).toHaveAttribute("data-scroll-region", "main");
  expect(screen.getByTestId("sidebar-navigation-scroll")).toHaveAttribute(
    "data-scroll-region",
    "navigation",
  );
});
```

Keep all existing navigation, role, workspace-switch, and collapse tests.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web exec vitest run src/components/layout/app-shell.test.tsx src/components/layout/workspace-shell.test.tsx
```

Expected: FAIL because the mobile buttons and scroll-region attributes are absent.

- [ ] **Step 3: Implement the responsive shell state**

In `AppShell`, add `const [mobileOpen, setMobileOpen] = useState(false)`. Pass `onOpenNavigation={() => setMobileOpen(true)}` to `TopHeader`, and pass `mobileOpen` plus `onMobileClose={() => setMobileOpen(false)}` to `Sidebar`. Render a backdrop button only while open:

```tsx
{mobileOpen ? (
  <button
    type="button"
    className={styles.backdrop}
    aria-label="关闭导航"
    onClick={() => setMobileOpen(false)}
  />
) : null}
```

Add `data-scroll-region="main"` to `<main>` and `data-scroll-region="navigation"` plus `data-testid="sidebar-navigation-scroll"` to the sidebar navigation wrapper.

- [ ] **Step 4: Implement the approved shell CSS**

Required desktop behavior:

```css
.shell { height: 100dvh; overflow: hidden; }
.sidebar {
  width: var(--sidebar-width);
  flex: 0 0 var(--sidebar-width);
  height: 100%;
  color: #c9d4dc;
  background: var(--shell-ink);
}
.header { height: var(--header-height); flex: 0 0 var(--header-height); }
.main { min-height: 0; overflow: auto; background: var(--bg-page); }
.navScroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
```

Use a dark sidebar, teal active marker, 6px control radius, 56px header, and 224px width. Keep the brand readable in both expanded and collapsed states.

At `<768px`, position the sidebar fixed over content, translate it off-canvas unless `data-mobile-open="true"`, show the header menu button, and show a backdrop. At `768–1179px`, default to the 64px collapsed presentation without creating another page scroll.

Respect `prefers-reduced-motion` by disabling transform transitions.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm --filter @crm/web exec vitest run src/components/layout/app-shell.test.tsx src/components/layout/workspace-shell.test.tsx
git add apps/web/src/components/layout/app-shell.tsx apps/web/src/components/layout/sidebar.tsx apps/web/src/components/layout/top-header.tsx apps/web/src/components/layout/app-shell.module.css apps/web/src/components/layout/app-shell.test.tsx apps/web/src/components/layout/workspace-shell.test.tsx
git commit -m "feat(web): rebuild the responsive application shell"
```

---

### Task 6: Add page header, filter bar, and actionable state patterns

**Files:**
- Modify: `apps/web/src/components/layout/page-header.tsx`
- Create: `apps/web/src/components/workbench/filter-bar.tsx`
- Create: `apps/web/src/components/workbench/filter-bar.module.css`
- Create: `apps/web/src/components/workbench/state-panel.tsx`
- Create: `apps/web/src/components/workbench/state-panel.module.css`
- Create: `apps/web/src/components/workbench/page-patterns.test.tsx`

**Interfaces:**
- Consumes: `StatusTag` and `ReadingPanel` from Task 3.
- Produces:

```ts
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  extra?: ReactNode;
}
export function FilterBar(props: {
  children: ReactNode;
  search?: ReactNode;
  batchActions?: ReactNode;
  ariaLabel?: string;
}): ReactNode;
export function StatePanel(props: {
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "empty" | "error" | "blocked";
}): ReactNode;
```

- [ ] **Step 1: Write failing composition tests**

```tsx
it("groups page status with the title and keeps actions separate", () => {
  render(
    <PageHeader
      title="销售线索"
      description="查看和跟进由你负责的线索"
      status={<StatusTag tone="warning">草稿</StatusTag>}
      extra={<button>新建线索</button>}
    />,
  );
  expect(screen.getByRole("heading", { name: "销售线索" })).toBeInTheDocument();
  expect(screen.getByText("草稿")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新建线索" })).toBeInTheDocument();
});

it("gives empty states an explicit next action", () => {
  render(
    <StatePanel
      title="还没有业务表"
      description="创建并发布后，员工才能开始使用。"
      action={<a href="/objects/new">创建业务表</a>}
    />,
  );
  expect(screen.getByRole("link", { name: "创建业务表" })).toHaveAttribute(
    "href",
    "/objects/new",
  );
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web exec vitest run src/components/workbench/page-patterns.test.tsx
```

- [ ] **Step 3: Implement the three patterns**

`PageHeader` keeps backward compatibility for current callers. Put title and status in one flex row, description beneath, and actions in a separate right area. `FilterBar` uses a 2px data radius and wraps at narrow widths. `StatePanel` uses a 10px reading radius, plain language, and a single next action; error tone adds a red left border but retains the same structure.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @crm/web exec vitest run src/components/workbench/page-patterns.test.tsx
git add apps/web/src/components/layout/page-header.tsx apps/web/src/components/workbench/filter-bar.tsx apps/web/src/components/workbench/filter-bar.module.css apps/web/src/components/workbench/state-panel.tsx apps/web/src/components/workbench/state-panel.module.css apps/web/src/components/workbench/page-patterns.test.tsx
git commit -m "feat(web): add reusable workbench page patterns"
```

---

### Task 7: Adopt the foundation on the current workbench and placeholders

**Files:**
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home.module.css`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx`
- Modify: `apps/web/src/components/layout/page-placeholder.tsx`
- Modify: `apps/web/src/components/layout/page-placeholder.module.css`
- Modify: `apps/web/src/components/layout/page-placeholder.test.tsx`

**Interfaces:**
- Consumes: `DataPanel`, `ReadingPanel`, `StatusTag`, and `StatePanel` from Tasks 3 and 6.
- Produces: the first real pages using the approved foundation without changing their data inputs or role behavior.

- [ ] **Step 1: Extend tests around semantic surfaces and honest empty states**

Add to `workspace-home-view.test.tsx`:

```tsx
expect(screen.getByRole("region", { name: "常用管理" })).toHaveAttribute(
  "data-surface",
  "reading",
);
expect(screen.getByRole("region", { name: "已上线业务表" })).toHaveAttribute(
  "data-surface",
  "data",
);
```

Add to `page-placeholder.test.tsx`:

```tsx
expect(screen.getByText("该能力尚未实现。")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "返回总览" })).toBeInTheDocument();
expect(screen.queryByRole("table")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web exec vitest run \
  'src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx' \
  src/components/layout/page-placeholder.test.tsx
```

Expected: FAIL because current sections do not expose the semantic surface attributes.

- [ ] **Step 3: Adopt shared primitives without changing data behavior**

Use `ReadingPanel ariaLabel="常用管理"` for admin actions, `DataPanel ariaLabel="已上线业务表"` or `"我可以使用的业务表"` for runtime objects, and `StatePanel` for the no-object case. Use `StatePanel` inside `PagePlaceholder`; retain the exact “尚未实现” copy and real return link.

Remove only styles that the shared primitives now own. Keep page-specific grid and responsive rules local.

- [ ] **Step 4: Run the final focused component group**

```bash
pnpm --filter @crm/web exec vitest run \
  src/app/providers.test.ts \
  src/components/layout/app-shell.test.tsx \
  src/components/layout/workspace-shell.test.tsx \
  src/components/workbench/surface.test.tsx \
  src/components/workbench/process-rail.test.tsx \
  src/components/workbench/page-patterns.test.tsx \
  'src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx' \
  src/components/layout/page-placeholder.test.tsx
```

Expected: all listed files pass. Do not run the whole repo suite.

- [ ] **Step 5: Run Web typecheck once**

```bash
pnpm --filter @crm/web typecheck
```

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 6: Check the live layout with Playwright**

Start only the API and Web development processes. Check one platform shell and both workspace roles at:

- 1280px desktop;
- 900px narrow desktop;
- 390px mobile.

Verify:

- sidebar/navigation and main content scroll independently;
- desktop sidebar is 224px and header is 56px;
- mobile navigation opens and closes without covering an unreachable action;
- company admin retains management actions;
- employee does not see member/settings navigation;
- no horizontal body overflow;
- no new console errors.

Do not submit real mutations during this foundation check.

- [ ] **Step 7: Commit the adoption**

```bash
git add 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx' 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home.module.css' 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx' apps/web/src/components/layout/page-placeholder.tsx apps/web/src/components/layout/page-placeholder.module.css apps/web/src/components/layout/page-placeholder.test.tsx
git commit -m "feat(web): adopt the shared workbench foundation"
```

## Phase Completion Gate

Before starting the platform-core-flow plan:

```bash
git diff --check
git status --short
```

Expected:

- no whitespace errors;
- no newly modified foundation files left uncommitted;
- protected and unrelated user files remain untouched and unstaged;
- focused tests and Web typecheck have fresh passing output;
- Playwright evidence covers desktop, narrow desktop, and mobile shell behavior.
