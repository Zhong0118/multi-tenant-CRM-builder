# CRM Product Experience V2 — First Slice Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本文件记录批准的实现范围；当前实现已提交，浏览器验收仍有明确缺口，PR 未合并。

**Goal:** 先修复记录页面已复现的状态丢失，再统一产品外框与记录列表，让 Admin/Employee 在三档屏宽完成已有操作。

**Architecture:** 沿用 WorkspaceShell/AppShell、PageHeader、FilterBar、StatePanel、RecordList 和 URL 驱动的 RecordQuery。复用现有领域 API、权限投影、Ant Design 与 CSS tokens；不新增状态管理库、后端接口或通用页面引擎。

**Tech Stack:** Node >=24、pnpm 11.19.0、Next/React、Ant Design、TanStack Query、TypeScript、Vitest/Testing Library。

**Spec:** [V2 Stage Design](../specs/2026-10-03-crm-product-experience-v2-design.md)；现状及缺陷证据见 [本轮审计](../../audits/2026-10-03/project-review.md)。

**Status:** SLICE 1 IMPLEMENTED — ACCEPTANCE INCOMPLETE — DRAFT PR CLOSEOUT。`origin/main` 本次 fetch 基线为 `70884f5`；实现、验收、PR 待合并与已合并必须分别记录。Slice 2–4 未启动。

## Global Constraints

- 保留 teal `#167568`、现有字体、现有 tokens；不引入新的组件库。
- 只整理已有呈现、动作、数据；**BACKEND CHANGES REQUIRED: NO**。
- 列表搜索/筛选/排序/分页以 URL 为准；个人视图仍“仅此浏览器”，保持 tenant/member/object 隔离和原 storage key。
- 保留发布字段、HIDDEN/READ_ONLY、OWN/ALL、canCreate/canUpdate/canDelete 等服务端投影；前端不重新计算权限。
- 保留详情深链、筛选返回、批量、导入/导出、列设置、发布默认排序和当前分页语义。
- AI V1A/V1B、Workflow、Action Engine 已完成；本计划不重写它们。真实 Provider 验证是独立事项。
- 检查宽度 **1440 / 900 / 390 CSS px**；浏览器高度 900。jsdom 不验证响应式布局。
- 不把已有但 CSS 隐藏的 table/card 两份 DOM 直接判为重复可见；以实际可见性和键盘焦点验收。
- 不在本轮顺手升级依赖、修改 CI、数据库迁移、后台任务或发布 Dashboard 定义。
- 不从旧根目录 main 开始；不自动删除工作树，不带入用户未提交文件。

## 1. 顺序、PR 边界与完成标准

| 交付 | 内容 | 完成标准 |
| --- | --- | --- |
| A：Task 0 状态修复 | B01/B02/B03 | 三条复现由红转绿、原 records tests 通过，适合独立合并 |
| B：Task 1–3 第一切片 | Shell/Header + Record List 控制层整理 + 体验验收 | 两角色×三宽度验收通过、既有能力无损、受影响测试与项目门禁通过 |
| 后续 Slice 2 | Detail + Follow-up / Activity | 只在第一切片结果可用后细化实现，不与 B 混做 |
| 后续 Slice 3 | Employee Workbench | 个人任务优先、Dashboard 语义不变 |
| 后续 Slice 4 | Admin Configuration | 保存/发布含义明确、复杂编辑响应边界统一 |

先修状态是因为 V2 会移动搜索与视图入口，已有 bug 会混淆体验回归；不是把整个后端重新审计设成 UI 开发前置。

## 2. 执行起点

- [ ] 在 V2 文档工作树阅读本计划、Spec、审计；用以下命令确认现场：

```bash
git fetch origin
git status --short --branch
git worktree list
git log -1 --oneline origin/main
git diff origin/main -- apps packages
```

- [ ] 从当前最新主线创建独立 `codex/` 实现分支，带入这次文档改动；保留根目录和其他工作树原样。本计划没有要求 rebase/squash 历史分支。
- [ ] 确认依赖与内部包 build 可用。Prisma generate/typecheck 需要 `DATABASE_ADMIN_URL` 存在，即使不连数据库；不要把生产 URL 用作占位值。

```bash
pnpm install --frozen-lockfile
DATABASE_ADMIN_URL=postgresql://unused:unused@127.0.0.1:1/unused \
  pnpm --filter @crm/contracts --filter @crm/database build
```

## Task 0: 修复记录查询状态与返回上下文

**Files — Modify:**

- `apps/web/src/features/records/record-list.tsx`
- `apps/web/src/features/records/record-workspace.tsx`
- `apps/web/src/features/records/record-list.test.tsx`
- `apps/web/src/features/records/record-workspace.test.tsx`

**Interfaces:** 消费既有 `RecordQuery`、`RuntimeObjectSchema.defaultView.sort`、`recordQuerySearch(query, defaults?)`；输出仍为现有对象列表/详情 URL，不增加 query 参数或 API。

- [ ] 运行已经提供的真实组件复现，并把脚本内 B01/B02/B03 测试移入对应正式测试文件，复用本地已有 fixture。当前应得到 3 个断言失败：

```bash
python3 docs/audits/2026-10-03/reproduce-record-navigation.py
```

三个测试代码完整保存在上述脚本，不另造 fixture。核心断言分别为：

```tsx
expect(screen.getByRole("textbox", { name: /搜索/ })).toHaveValue("新关键词");
expect(navigate).not.toHaveBeenCalled(); // 输入后卸载，再等待 debounce 窗口
expect({ sort: restored.sort, direction: restored.direction }).toEqual({
  sort: "updatedAt", direction: "desc",
});
```

- [ ] B01：在 `query.search` 改变时同步搜索草稿，保持输入防抖体验；不能以 `key={整个query}` 重挂载完整列表解决，否则会丢失批量选择和弹层状态。
- [ ] B02：组件卸载时 `clearTimeout(debounce.current)`；立即提交/应用其他查询前取消旧搜索。复用已有 `debounce` ref，不引入全局调度器。新增检查“输入尚未到300ms→立即 Enter/选视图→旧计时器不再覆盖导航”。
- [ ] B03：关闭详情与列表链接序列化使用一致默认值。最小改动示例（已有 `DEFAULT_RECORD_QUERY` 需从同模块导入）：

```tsx
const search = recordQuerySearch(query, {
  ...DEFAULT_RECORD_QUERY,
  sort: schema.defaultView.sort.field,
  direction: schema.defaultView.sort.direction,
});
router.replace(`${listPath}${search ? `?${search}` : ""}`);
```

- [ ] 验证聚焦修复；测试失败时只处理本次状态问题，不重构完整 RecordList。

```bash
pnpm --filter @crm/web exec vitest run \
  src/features/records/record-list.test.tsx \
  src/features/records/record-workspace.test.tsx \
  src/features/records/record-query-state.test.ts \
  src/features/records/saved-record-filters.test.tsx
python3 docs/audits/2026-10-03/reproduce-record-navigation.py
```

**Exit:** 正式回归和复现脚本全部绿色；URL 与可见搜索词一致；卸载无旧导航；自定义默认排序下往返不变。保留独立提交，例如 `fix(web): preserve record query state across navigation`。

## Task 1: 产品外框与标题语言

**Files — Modify:**

- `apps/web/src/components/layout/workspace-shell.tsx`
- `apps/web/src/components/layout/app-shell.tsx`、`app-shell.module.css`
- `apps/web/src/components/layout/page-header.tsx`（仅现有 props 不够时修改）
- `apps/web/src/components/navigation/workspace-navigation.ts`
- `apps/web/src/components/layout/workspace-shell.test.tsx`、`app-shell.test.tsx`

**Interfaces:** 保留 `workspaceNavigation(tenantCode, role)` 的现有使用兼容；Shell 使用既有 `ShellNavGroup[]`，业务对象仍来自 `businessObjects`。PageHeader 保持 `title/description/status/extra`。

- [ ] 先在现有 shell tests 增加行为断言：员工只含工作/授权业务对象；管理员另含管理入口；租户与账号仍可到达；移动导航开关可用。按组查询，避免全局同名链接歧义。
- [ ] 依次呈现“工作”“业务数据”“管理”。通过角色与现有导航定义分组，不按中文 label 猜业务类型，不硬编码租户对象名称；员工组里不得出现管理员路由。
- [ ] 用已有 PageHeader 呈现当前页面标题和动作，先让记录列表真实消费该组件。沿用 `extra` 主动作，例如：

```tsx
<PageHeader
  title={owned ? `我的${schema.object.name}` : schema.object.name}
  description={schema.object.description ?? undefined}
  extra={schema.actions.canCreate ? (
    <Button type="primary" onClick={() => go(`${listPath}/new`)}>
      新建{schema.object.name}
    </Button>
  ) : undefined}
/>
```

- [ ] 900px 附近默认使用紧凑导航，同时保留已有手动展开/宽度偏好。自动响应不得把临时小屏状态写入用户桌面偏好；390px 沿用移动导航。先用现有 CSS 断点解决能解决的部分，不新增全局屏幕状态框架。
- [ ] 验证现有共享 PageHeader 页面（工作台、设置等）不会因公共 CSS 修改溢出；AI 页只做 Shell smoke，不改会话内容样式。

```bash
pnpm --filter @crm/web exec vitest run \
  src/components/layout/workspace-shell.test.tsx \
  src/components/layout/app-shell.test.tsx \
  src/components/layout/sidebar-width.test.ts
```

**Exit:** 两角色导航项和授权过滤保持正确；工作入口靠前；键盘能开关导航、关闭后焦点返回触发按钮；宽屏手动偏好经缩放保留。提交时只包含此 Task 的组件和测试。

## Task 2: 记录列表控制层收敛

**Files — Modify:**

- `apps/web/src/features/records/record-list.tsx`、`records.module.css`
- `apps/web/src/features/records/saved-record-filters.tsx`、`saved-record-filters.test.tsx`
- `apps/web/src/features/records/record-list.test.tsx`
- `apps/web/src/components/workbench/filter-bar.tsx`、`filter-bar.module.css`（只有共享布局确需变化时）

**Interfaces:** `SavedRecordFilters` 保留 `tenantCode/memberId/objectCode/query/onApply`；仍通过 `onApply(RecordQuery)` 调用已有 `apply`。不改变 `savedFilterKey`，不更换存储版本，不请求服务端保存视图。

- [ ] 先在现有 tests 中覆盖“打开视图管理→命名保存→选择应用→删除”；继续运行已有跨成员隔离/SSR 不访问 storage 测试。
- [ ] 主层保留视图选择、搜索、常用筛选、结果数和主新建入口。把命名输入、保存、删除放入一个明确的“管理筛选视图”二级入口，继续显示“仅此浏览器”。优先已有 Ant Popover/Drawer，不制造新路由。
- [ ] 高级筛选保持明确按钮和当前条件摘要；清除字段筛选不能误清搜索/排序/负责人。应用视图、改变筛选仍从第1页开始。
- [ ] 批量/导入/导出/列设置仍在明确操作菜单；选择记录数可见；无权限动作不因换容器而出现。保留导出当前筛选与列的已有调用契约。
- [ ] 桌面行与手机卡片共用原数据和列权限；不把发布时间/版本/代码提升为主信息。表格水平滚动限制在表格容器，不让整个 document 溢出。
- [ ] 空态区分“无记录”和“筛选无结果”；后者提供清除条件恢复路径。API error 复用已有错误/重试，不能把错误伪装成零结果。
- [ ] 用现有 fixture 验证新控制层。例如增加下列角色断言（其余 schema/API fixture 直接复用）：

```tsx
renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
  schema: { ...schema, actions: { ...schema.actions, canCreate: false } },
});
expect(screen.queryByRole("button", { name: "新建客户" })).not.toBeInTheDocument();
```

- [ ] 跑 records 测试；然后在真实浏览器检查保存视图弹层、搜索与结果一致、过滤/分页/排序往返、批量、导入导出、手机卡片详情返回。

```bash
pnpm --filter @crm/web exec vitest run src/features/records
```

**Exit:** 首层不再常驻命名保存/删除表单；原有能力仍可发现且可键盘到达；Task 0 的状态回归保持绿色。只抽取本任务确实重复的 JSX，不拆完整 records 模块。

## Task 3: 第一切片验收与文档收口

**Files:** 新建 `docs/audits/2026-10-03/crm-product-experience-v2-slice-1-acceptance.md`（实现时填写）；更新 `HANDOFF.md` 与 Lean Roadmap 的实际状态。本轮不创建虚假的 PASS 验收记录。

**Interfaces:** 消费 Task 0–2 的产品行为和测试输出；产出可定位的 commit、浏览器证据与剩余限制。

- [ ] 建立独立可丢弃浏览环境，不复用来源不清的业务数据库。记录 API/Web 端口、commit、租户、角色、视口；使用已发布非默认排序对象及至少两页记录。
- [ ] 按下表逐项填结果。失败项写出步骤与实际表现，不以截图存在代替功能通过。

| 验收项 | 1440 | 900 | 390 |
| --- | --- | --- | --- |
| Admin/Employee 导航、租户身份、可达操作正确 | 必查 | 必查 | 必查 |
| 已发布默认列、HIDDEN字段不出现、OWN列表无他人数据 | 必查 | 抽查 | 必查 |
| 搜索/视图/筛选/排序/分页→详情→返回保持状态 | 必查 | 必查 | 必查 |
| 空结果清除、接口失败重试、长字段/长标题 | 必查 | 必查 | 必查 |
| 页面无水平溢出，表格只在自身横向滚动 | 必查 | 必查 | 卡片布局 |
| 键盘操作、弹层关闭回焦点、移动导航回焦点 | 必查 | 必查 | 必查 |
| 新建/编辑/批量/导入导出能力保持 | 必查 | 抽查 | 保持原移动能力 |

- [ ] 页面级几何检查可用 `document.documentElement.scrollWidth <= window.innerWidth`；该数值只证明无横向溢出，还要看实际截图、截断、按钮遮挡与焦点。
- [ ] 运行受影响 tests、Web lint、全仓 typecheck/build/contracts；遵守现有 CI，不为了让 UI PR 变绿修改门禁。全仓 tests 在最终实现后运行一次，不每次改间距就重跑。

```bash
pnpm --filter @crm/web lint
pnpm test
DATABASE_ADMIN_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm typecheck
DATABASE_ADMIN_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm build
DATABASE_ADMIN_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm contracts:check
```

- [ ] 合并前核对 6 个 required checks；远端状态必须实查，不能引用本轮旧结果。Contracts 生成不得留下非预期 diff。若共享组件影响 AI 页面，验证其展示与原确认交互，不调用真实 Provider 冒充已授权验收。
- [x] 记录实现 commit、实测结果、未观察项；实现完成，验收未完整完成；后续切片仍 PLANNED。

## 2.1 第一切片完成记录

- Task 0 与 Slice 1 Tasks 1–2 主体实现已提交：`e3be29f`、`ac18f15`、`0696956`、`1e1a9f0`；Task 3 验收有未观察项，尚未完整完成。本轮补移动焦点约束、卡片分页/排序/选择及取消搜索草稿同步。
- 自动化与浏览器证据见 `docs/audits/2026-10-03/crm-product-experience-v2-slice-1-acceptance.md`。续轮已补真实HIDDEN、表单/CSV、长内容截图、默认排序往返和桌面批量；剩余动作/键盘及AI路径在该记录限制中逐项列出，保持ACCEPTANCE INCOMPLETE/Draft。
- 后续切片仍为 PLANNED；本轮不包含详情重构、员工首页、配置体验、AI runtime、后端 API、权限或数据模型改变。

## 3. 后续切片的范围合同

此处是顺序与验收约束，不是尚未检查代码的伪详细实现。每个切片开工时只细化自身计划，避免一次重写所有页面。

| 切片 | 现有入口 | 本切片验收 | 不包含 |
| --- | --- | --- | --- |
| 2：详情/跟进/活动 | `features/records/record-detail-drawer.tsx`、`features/follow-ups/follow-up-panel.tsx`；复用原活动入口 | 摘要/下一步/历史可快速访问；新增表单按需展开；完成/改期后正确刷新；深链与来源返回不丢；已有流程动作、关联、附件可达 | 合并 Follow-up/Activity 数据模型、新详情应用、新计数 API |
| 3：员工工作台 | `features/dashboard/employee-workbench.tsx`、`features/follow-ups/follow-up-workbench.tsx` | 个人待办在运营时间范围之前；今日/逾期/未来7日仍用既有时区与服务端定义；去重快捷入口；额外验收 Dashboard 未配置/失败时个人任务可达 | 改已发布 Dashboard、主管任务中心、新聚合 |
| 4：管理员配置 | `features/dashboard/dashboard-builder.tsx`、现有 objects/members/workflows 页面 | 草稿保存、对象发布、成员覆盖立即生效三种后果明确；900画布不被组件库压到末尾；390保留可回退路径；无权限直链反馈一致且不放松鉴权 | 图形流程编辑器、新权限、统一发布生命周期 |

Slice 4 的详细文件与手机编辑策略在其开工设计中确定；不能在第一切片偷偷移除 Dashboard 现有移动端操作。Slice 2/3/4 的确切估时以第一切片实测为依据，本计划不给虚假完成百分比。

## 4. 独立事项与停止条件

- AI E2E 固定端口问题（审计 T01）是独立测试可靠性任务；不能通过删掉隔离保护或改用业务库完成。AI 增强前应处理它，纯 UI 第一切片不用等待其 CI 推广。
- Action Engine fieldErrors / MEMBER 默认值为历史待验证事项。若复现出权限泄漏，单独修复并按严重度调整顺序，不混入换肤提交。
- 需要新 API、跨设备视图、新的字段/权限语义或自动任务时，超出当前范围，回到需求定义；不要用前端伪数据补齐。
- 初始阶段只交付审计与计划；随后已获批准实现第一切片并准备 Draft PR。当前验收不完整、尚未合并或部署，后续切片不因提交或 CI 通过而自动批准。
