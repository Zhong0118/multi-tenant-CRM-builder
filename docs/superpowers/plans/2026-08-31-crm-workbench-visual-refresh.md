# CRM Workbench Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将确认的运营驾驶舱视觉方向落到现有管理员、员工工作台和共享认证外壳中。

**Architecture:** 保留现有 Dashboard API 和权限边界，只重排现有真实数据模块。管理员和员工继续复用 `workbench-elements` 与图表组件，视觉变化集中在工作台组件和 CSS Module 中。

**Tech Stack:** Next.js 16、React 19、Ant Design 6、@ant-design/charts、CSS Modules、Vitest。

**Spec:** `docs/superpowers/specs/2026-08-31-crm-workbench-visual-refresh-design.md`

## Global Constraints

- 不修改 Dashboard API、数据库和指标口径。
- 不修改 `apps/web/src/app/(auth)/register/page.tsx`。
- 不新增伪造同比、目标值或静态业务数据。
- 仅执行一次聚焦测试、一次 Web 类型检查和一轮关键页面浏览。

---

### Task 1: 工作台信息结构

**Files:**

- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx`
- Modify: `apps/web/src/features/dashboard/admin-workbench.tsx`
- Modify: `apps/web/src/features/dashboard/employee-workbench.tsx`
- Modify: `apps/web/src/features/dashboard/workbench-elements.tsx`
- Modify: `apps/web/src/features/dashboard/workbench-charts.tsx`

**Interfaces:**

- Consumes: 现有 `DashboardOverview`、`RuntimeObjectNavigation` 和对象权限。
- Produces: 管理员“运营驾驶舱”和员工“我的工作台”布局。

- [ ] **Step 1: 写结构断言**

  在 `workspace-home-view.test.tsx` 中断言管理员页面出现“销售与回款趋势”“销售漏斗”“异常与待办”，员工页面仍不出现团队排行。

- [ ] **Step 2: 运行聚焦测试并确认失败**

  Run: `pnpm --filter @crm/web test:unit -- 'src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx'`
  Expected: 新标题尚未实现，测试失败。

- [ ] **Step 3: 重排真实数据模块**

  将趋势作为主图，漏斗和待办放入右侧分析栏；管理员排行改为全宽，主操作链接到业务对象新建页。

- [ ] **Step 4: 运行聚焦测试并确认通过**

  Run: `pnpm --filter @crm/web test:unit -- 'src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx'`
  Expected: PASS。

### Task 2: 工作台与壳层视觉

**Files:**

- Modify: `apps/web/src/features/dashboard/workbench.module.css`
- Modify: `apps/web/src/components/layout/app-shell.module.css`

**Interfaces:**

- Consumes: 现有全局 token 与 Ant Design 组件结构。
- Produces: 全宽桌面画布、独立滚动侧栏、混合圆角和工具型数据区。

- [ ] **Step 1: 更新桌面网格与数据密度**

  使用 `minmax(0, 1fr)` 防止内容撑破，主分析区采用宽主图加窄侧栏，排行榜与明细使用全宽表格。

- [ ] **Step 2: 完善响应式布局**

  在 1180px 以下把分析区收为单列；移动端保留现有抽屉导航和可用按钮。

### Task 3: 认证页面尺度与验证

**Files:**

- Modify: `apps/web/src/features/auth/auth.module.css`
- Create: `design-qa.md`

**Interfaces:**

- Consumes: 现有 `AuthShell`、登录/注册/找回密码表单。
- Produces: 更均衡的认证页面和至少 46px 的关键控件。

- [ ] **Step 1: 调整共享认证外壳**

  放大表单区，优化左右比例、标题尺度和表单控件高度；不修改注册页逻辑。

- [ ] **Step 2: 运行一次 Web 类型检查**

  Run: `pnpm --filter @crm/web typecheck`
  Expected: PASS。

- [ ] **Step 3: 浏览器核对**

  在 1440 × 1024 下检查登录页与管理员工作台，验证主操作、侧栏选中状态和页面滚动，并检查控制台错误。

- [ ] **Step 4: 写设计 QA 报告**

  将选定稿和实现截图并排检查，记录视觉差异；只有无 P0/P1/P2 问题时写入 `final result: passed`。
