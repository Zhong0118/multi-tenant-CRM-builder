# 平台超级管理员 AppShell 与公司管理页设计

版本：1.0
日期：2026-08-25
状态：待实现

## 1. 目标

把 V3 交互规范落到一套可复用的 AppShell 上，并用它重做平台超级管理员已经存在的页面。完成后：

- 平台端和工作区共用同一套侧栏 / 顶栏 / User Menu / 登出 / 收起，尺寸和 Token 来自 V3 Canonical。
- 超级管理员能在新壳里看平台总览、管理公司列表、开通公司和查看公司详情。
- 工作区只换壳，不改对象、记录、成员页的内容和交互。

视觉参考：用户提供的超级管理员模拟图（结构采用，像素和假数据不采用），以及 [`docs/design/04-交互与样式约束-v3-final.md`](../../design/04-交互与样式约束-v3-final.md)、[`docs/design/06-页面设计-v3-final.md`](../../design/06-页面设计-v3-final.md)、[`docs/design/08-超级管理员页面规范.md`](../../design/08-超级管理员页面规范.md)。

产品规则仍以已实现代码和第一切片契约为准。08 与模拟图中尚未落地的能力不当成本切片范围。

## 2. 已确认方案

- 一套 `AppShell`，`PlatformShell` 与 `WorkspaceShell` 注入不同导航和 Header 左侧内容。
- 08 当视觉目标，产品规则优先：不开通五步向导、不代设管理员密码、不造待审核/套餐/模块开关。
- 模拟图采用其信息架构（侧栏 + Header + User Menu + 表格为主），不采用其 248/72 尺寸、`#1677FF` 主色、彩色圆底 KPI、搜索/通知、真人头像。
- 路由保持 `/platform/tenants*`。UI 文案使用「公司 / 工作空间」，代码和 API 继续使用 `tenant`。
- 本切片唯一新 API：`GET /api/v1/platform/tenants/summary`，返回按状态计数。总览四个数字走它；公司列表仍走现有分页。
- 字体和图标库本切片不更换：继续现有界面字体 + `@ant-design/icons`。不引入 Inter，不引入 Lucide。

## 3. 切片范围

### 3.1 包含

- 将 `globals.css` 与 `providers.tsx` 的设计 Token 对齐 V3 Canonical，两处数值必须一致。
- 抽取 `AppShell`、`Sidebar`、`TopHeader`、`UserMenu`、`PageHeader`。
- 平台导航公司化，并套进新壳：总览、公司管理、模板、后台任务、日志中心、系统设置。
- 重做平台总览、公司列表、新增公司、公司详情的布局与视觉，字段和动作仍绑定现有租户 API。
- 工作区 `WorkspaceShell` 改用 AppShell；保留业务对象 / 系统导航分组。
- 侧栏收起状态写入 `localStorage` 键 `crm.sidebar.collapsed`。
- OpenAPI 契约更新、Web 生成客户端、组件测试、API 单元测试；平台页由项目负责人手工验收。

### 3.2 不包含

- 全局搜索、通知铃、帮助入口。
- 重置管理员密码、代管模式 Banner、进入公司工作空间。
- 五步开通向导，以及行业、模板选择、模块开通、子域名、地址、套餐限额。
- 权限配置、Dashboard 配置、飞书集成页面和导航项。
- 模板 / 后台任务 / 审计 / 设置的真实数据；这些页只换壳并保持「尚未实现」。
- 公司管理员页、员工页、百杰业务页的内容重做。
- 登录 / 注册 / waiting / 工作空间选择页的视觉重做。
- 更换字体家族或图标库。
- Playwright。不修改、暂存或提交 `apps/web/src/app/(auth)/register/page.tsx` 与 `chat会话.md`。

## 4. 领域与产品规则

### 4.1 角色边界

超级管理员管理公司工作空间的开通与运行状态，默认不进入获客、跟单、客户等业务数据。本切片不提供代管入口。

公司状态仍是 `DRAFT | ACTIVE | SUSPENDED | CLOSED`，界面文案：

| 状态 | 文案 |
|---|---|
| DRAFT | 草稿 |
| ACTIVE | 运行中 |
| SUSPENDED | 已暂停 |
| CLOSED | 已关闭 |

不用「已启用 / 待审核」。

开通公司仍只收集：公司名称、工作空间代码、首位管理员手机号。平台不代设密码。激活门槛不变：草稿已建立、首位管理员已接受邀请、至少一位活跃管理员。

### 4.2 UI 语言与内部命名

面向用户：公司、工作空间、公司管理员、员工、平台超级管理员。
代码 / API / 数据库：`tenant`、`tenantId`、`tenantCode`、`/platform/tenants`。

同一动作全流程使用同一动词：按钮「新增公司」，成功「公司已创建」；按钮「激活公司」，成功「公司已激活」。

### 4.3 导航

平台侧栏只挂真实存在的路由：

```text
总览            /platform
公司管理        /platform/tenants
模板            /platform/templates      （占位）
后台任务        /platform/jobs           （占位）
日志中心        /platform/audit          （占位）
系统设置        /platform/settings       （占位）
```

不挂权限配置、Dashboard 配置、飞书集成。一级页不堆「首页 / …」面包屑。详情页：`公司管理 / {公司名}`。开通页：`公司管理 / 新增公司`。

工作区侧栏仍分两组：已发布且当前成员可读的业务对象（服务端注入，不写死百杰名称）+ 系统项（工作台、统计、成员管理、导入导出、审计、设置）。无 READ 权限的对象不出现。

## 5. Design Tokens 与 AppShell

### 5.1 Canonical 数值

`apps/web/src/app/globals.css` 的 CSS 变量与 `apps/web/src/app/providers.tsx` 的 Ant Design Token 必须使用同一组值：

| Token | Value | 用途 |
|---|---|---|
| `--color-primary` | `#2563EB` | 主按钮、链接、焦点、选中 |
| `--color-primary-hover` | `#1D4ED8` | Hover |
| `--color-primary-active` | `#1E40AF` | Active |
| `--color-primary-soft` | `#EFF6FF` | 选中背景 |
| `--text-primary` | `#0F172A` | 标题、主文本 |
| `--text-secondary` | `#475569` | 次级说明 |
| `--text-tertiary` | `#64748B` | 辅助信息 |
| `--border-default` | `#E2E8F0` | 普通边框 |
| `--bg-page` | `#F8FAFC` | 页面背景 |
| `--bg-surface` | `#FFFFFF` | 表格、表单、卡片 |
| `--bg-hover` | `#F1F5F9` | Hover |
| `--color-success` | `#0F766E` | 已完成、运行中 |
| `--color-warning` | `#B45309` | 草稿、警告 |
| `--color-danger` | `#B42318` | 错误、暂停/关闭、危险 |

尺寸：

| 元素 | 值 |
|---|---|
| Sidebar 展开 | 240px |
| Sidebar 收起 | 64px |
| Header | 64px |
| Logo 区高度 | 64px |
| 菜单项高度 | 40px |
| 菜单项水平 padding | 12px |
| 侧栏水平 margin | 8px |
| 项间距 | 4px |
| 控件 / 主按钮高度 | 36px |
| 控件圆角 | 6px |
| 容器圆角 | 8px |
| 页面 padding ≥1440 | 24px |
| 页面 padding 1024–1439 | 20px |
| 页面 padding <1024 | 16px |
| 表格行高 | 44px |
| 表头高 | 40px |

禁止：大面积渐变、玻璃拟态、彩色圆底图标、AI/照片装饰头像、普通卡片阴影、16px 以上圆角、每个模块一种颜色。普通 Card / Table 使用白底 + 1px `#E2E8F0` 边框，无 box-shadow。

Ant Design Table 行 Hover 使用 `#F8FAFC`，选中使用 `#EFF6FF`。主按钮背景 `#2563EB`，Hover `#1D4ED8`，Active `#1E40AF`。

### 5.2 组件边界

```text
AppShell
├── Sidebar
│   ├── Brand / Workspace label
│   ├── Nav groups (injected)
│   ├── Collapse control
│   └── Logout control
├── TopHeader
│   ├── Breadcrumb or workspace name
│   └── UserMenu
└── children (page)

PageHeader     页面标题 + 一句说明 + 最多一个 Primary
```

`PlatformShell` / `WorkspaceShell` 只组装导航、当前用户和 Header 左侧，不各自实现侧栏宽度、菜单状态或登出。

侧栏菜单状态：

- Default：图标 `#64748B`，文字 `#334155`，背景透明。
- Hover：背景 `#F1F5F9`，文字 `#0F172A`，120ms。
- Active：背景 `#EFF6FF`，图标/文字 `#2563EB` / `#1D4ED8`，字重 500。
- Pressed：背景 `#DBEAFE`。不缩放、不弹跳。

收起后只显示图标，Hover 出 Tooltip，当前项仍显示 Active，Logo 只留图形，登出只留图标，不改变菜单顺序。收起状态键：`localStorage["crm.sidebar.collapsed"]`，值为 `"true"` / `"false"`。服务端首屏默认展开；客户端 mount 后读取 localStorage，避免 SSR 无窗口对象。接受一次从展开到收起的切换，不引入 cookie 预读。缺省展开。

登出：调用现有 `POST /api/v1/auth/logout`，成功后 `replace("/login")` 并 refresh。默认中性色，Hover 变 Danger。本切片平台页没有脏表单登记；未保存确认留给后续表单页接入同一登出入口。失败保留在当前页并提示「退出失败，请稍后重试。」

### 5.3 User Menu

触发器：32px 首字母头像 + 角色文案 + ▾。头像背景中性，文字取显示名第一个字符；无显示名时用「平」。禁止照片和卡通。

超级管理员下拉：

```text
{displayName}
{掩码手机号}
平台超级管理员
────────────
账号与安全          → /account/security
────────────
退出登录
```

工作区下拉：角色为「公司管理员」或「员工」。若调用方传入 `showWorkspaceSwitch`，增加「切换工作空间」→ `/workspaces`。切换后必须进入工作空间选择页，不能保留旧公司 URL。

手机号掩码：先按现有 `normalizeChineseMobile` 的逆过程得到 11 位国内号（`+8613800138000` → `13800138000`），再渲染 `138****8000`（前 3 + `****` + 后 4）。不足 11 位时原样显示、不编造掩码。本切片不新增「个人资料」页，菜单不挂死链。

Header 右侧本切片只放 User Menu。不放搜索、通知、帮助。

### 5.4 工作区换壳

`WorkspaceShell` 继续接收 `tenantCode`、`tenantName`、`role`、`businessObjects`，并新增当前用户 `{ displayName, phone }`。Header 左侧持续显示公司名；侧栏 Logo 区也显示公司名。角色只出现在 User Menu（「公司管理员」/「员工」），不再作为侧栏 Tag。工作空间代码不作为侧栏或 Header 主文案。

现有 `workspace-shell.test.tsx` 必须继续覆盖：业务对象与系统导航分组、服务端给定的对象顺序、空对象说明、公司名可见。角色可见性改到 User Menu 断言；不再要求 `tenantCode` 出现在侧栏。测试夹具要传入 user。

平台布局服务端已 `requireUser`，把 `displayName`、`phone`、`isPlatformAdmin` 传入 PlatformShell。工作区 `workspace/[tenantCode]/layout.tsx` 增加一次 `requireUser`，与 `requireWorkspace` 并行，把用户资料传入 WorkspaceShell。`showWorkspaceSwitch` 在工作区恒为 true（选择页本身能处理单空间）。

## 6. 平台页面

所有平台内容页使用 `PageHeader` + 页面 padding Token。不要英文 eyebrow（`COMPANY REGISTRY` 等），不要 42px 标题，不要卡片阴影。

### 6.1 平台总览 `/platform`

目的：30 秒内看到有多少公司、哪些在运行、最近开通了谁。不是销售 Dashboard。

```text
平台总览
多公司工作空间的开通与运行状态                    [新增公司]

公司总数   运行中   草稿   已暂停/已关闭
  total    active   draft  suspended + closed

公司                                            [查看全部]
名称     工作空间代码   状态    活跃管理员   创建时间
（最多 8 行；单击进入详情）
```

四个数字来自 `GET /api/v1/platform/tenants/summary`。表格来自现有 `GET /api/v1/platform/tenants?page=1&limit=8`，按接口返回顺序取前 8 行，不在客户端再分页。「查看全部」到 `/platform/tenants`。主按钮「新增公司」到 `/platform/tenants/new`。

空状态：`summary.total === 0` 时不渲染 KPI 行，只保留页头、一句说明和主按钮「新增公司」。文案：「创建第一家公司草稿，并邀请首位公司管理员。」summary 接口仍返回全 0，前端用 `total === 0` 切换空状态，不用四个 0 卡假装运营数据。

不做：日期范围、趋势折线、行业分布、待处理事项、假「今日新增记录 / 活跃用户」、彩色圆底图标。

Loading：KPI 与表格使用与最终布局同宽的骨架，不使用全屏 Spinner。

Error：保留页头，内联说明失败原因和请求编号，提供重试。

### 6.2 公司管理 `/platform/tenants`

List Pattern。字段仅限现有 `PlatformTenantResponseDto`：

| 列 | 来源 |
|---|---|
| 公司名称 | `name`，主字段，链接到详情 |
| 工作空间代码 | `code`，等宽或 tabular |
| 状态 | 上表中文 |
| 活跃管理员 | `activeAdminCount` |
| 创建时间 | `createdAt`，中文中等日期 |

单击行进入详情。名称链接与行点击目标相同。不在本页放导出、更多菜单、搜索、行业筛选、模块筛选。分页沿用现有 `?page=`，`limit` 保持接口默认 20，不把契约改成 50。

空状态：尚未开通公司，引导「新增公司」。本切片没有筛选，因此不需要 Filtered Empty。

主按钮一个：`+ 新增公司`。

### 6.3 新增公司 `/platform/tenants/new`

单页表单，不是 Wizard。面包屑：`公司管理 / 新增公司`。

字段与现有 `CreatePlatformTenantDto` 一致：

- 公司名称：必填，1–200。
- 工作空间代码：小写字母、数字、单个连字符；创建后不可改。帮助文案解释用途，不重复标签。
- 首位管理员手机号：11 位中国大陆手机号。帮助文案：系统发送邀请，不代设密码。

主按钮「创建公司」。提交中禁用重复提交，文案「正在创建…」。失败保留输入，聚焦首个错误。成功继续使用 Result：已创建草稿、邀请已发出、前往公司详情。

右侧可保留开通检查点（创建草稿 → 首管接受邀请 → 平台激活），作为说明，不是可点步骤条。

### 6.4 公司详情 `/platform/tenants/[tenantId]`

全页，不是抽屉。面包屑：`公司管理 / {name}`。

```text
{name}                         {状态 Tag}
工作空间代码 {code} · 创建于 {createdAt}

基本信息
名称 / 代码 / 状态 / 激活时间 / 创建时间

首位管理员
手机号 / 邀请状态 / 活跃管理员人数

激活判定
公司草稿已建立
首位管理员已接受邀请
至少一位管理员处于活跃状态

状态操作
原因（可选）
[激活公司]          仅 DRAFT 或 SUSPENDED，且 activeAdminCount > 0
更多：暂停公司、关闭公司（确认弹窗）
```

危险动作不放页头大红按钮。暂停 / 关闭进入确认弹窗，说明成员将无法进入工作空间。关闭是高风险，确认文案必须写明。每次变更记录操作者、原因和请求编号（现有审计路径，不改语义）。

无「重置管理员密码」「保存配置」「模块开通 Tab」「套餐进度条」「操作日志时间线」。

公司不存在或跨资源：沿用现有错误映射，不泄露枚举信息。

### 6.5 占位页

模板、后台任务、日志中心、系统设置：同一 `PageHeader` + 一句「该能力尚未实现」，可继续使用 `PagePlaceholder`，但去掉 Ant Design 默认 info Alert 的骨架感文案冲突（「页面骨架已建立」可保留为诚实说明）。不插入假表格或假 KPI。

## 7. 新 API

```text
GET /api/v1/platform/tenants/summary
```

Guard：与现有平台租户接口相同（Session + PlatformAdmin）。

响应：

```ts
interface PlatformTenantSummaryDto {
  total: number;
  draft: number;
  active: number;
  suspended: number;
  closed: number;
}
```

不变量：`total === draft + active + suspended + closed`。全部为非负整数。按 `tenants.status` 分组计数，不扫描业务记录，不返回租户明细。

`@ApiProperty` 必须写 `type: Number`。Web 不得手写平行类型，从 OpenAPI 生成后使用。改完 DTO 必须跑 `pnpm contracts:generate`。

实现放在现有 `TenantsService` / `PrismaPlatformTenantRepository`，平台连接角色保持 `NOBYPASSRLS`。平台租户表本身按平台管理员查询，不切换 `app.tenant_id` 到某一公司。

路由必须注册在 `GET :tenantId` 之前，避免 `summary` 被当成 id。推荐独立路径 `@Get('summary')` 声明在 `detail` 之前。

## 8. Web 结构

推荐文件（名称可按现有目录习惯微调，职责不可合并回各页面）：

```text
apps/web/src/components/layout/app-shell.tsx
apps/web/src/components/layout/sidebar.tsx
apps/web/src/components/layout/top-header.tsx
apps/web/src/components/layout/user-menu.tsx
apps/web/src/components/layout/page-header.tsx
apps/web/src/components/layout/platform-shell.tsx      （改为组装 AppShell）
apps/web/src/components/layout/workspace-shell.tsx     （改为组装 AppShell）
apps/web/src/components/navigation/platform-navigation.ts
```

平台总览可放 `apps/web/src/features/tenants/platform-overview.tsx`（或 `apps/web/src/app/(platform)/platform/page.tsx` 若保持 Server Component 拉数）。KPI 与表格是展示组件，不在页面里手写 antd Token。

`LogoutButton` 可被 Sidebar 与 User Menu 复用；若视觉需要图标按钮变体，扩展现有组件而不是再写一套 logout fetch。

## 9. 测试策略

### 9.1 单元 / 组件

- Token：不强制测 CSS；typecheck + 目视对照 Canonical 表。
- Sidebar：展开 240 / 收起后只渲染图标按钮；当前路由 `aria-current="page"`；平台导航文案为「公司管理」而不是「租户」。
- User Menu：超级管理员显示角色和掩码手机号；有「账号与安全」；无搜索/通知；工作区多空间时出现「切换工作空间」。
- 登出失败可重试（保留现有 logout-button 测试）。
- WorkspaceShell：业务对象分组、顺序、空态、公司名可见（迁移现有测试）。
- 公司表格列不包含行业/模块/管理员头像。
- 开通表单仍校验三字段（保留现有 create-tenant-form 测试）。
- 状态操作：草稿无活跃管理员时激活禁用；暂停/关闭走确认（保留并按新文案微调）。

### 9.2 API

- `GET /platform/tenants/summary`：平台管理员得到正确分组计数；非平台管理员 403；未登录 401。
- 创建/暂停/关闭公司后 summary 数字变化。
- `summary` 不被 `:tenantId` 吃掉。

若当前平台租户 E2E 已覆盖 list/create/status，summary 优先加在同一套件，避免再起一套数据库生命周期。

### 9.3 手工验收

项目负责人在桌面 ≥1280 宽验收：

1. 平台管理员登录进入 `/platform`，侧栏 240、Header 64、右上 User Menu。
2. 总览四数字与公司列表状态合计一致；空库走空状态。
3. 新增公司三字段成功，详情显示邀请待接受。
4. 激活 / 暂停 / 关闭路径仍可用，危险按钮不在页头。
5. 收起侧栏刷新后保持；登出回到登录。
6. 进入一个公司工作空间，侧栏仍是业务对象 + 系统项，记录页内容未改。
7. 模板等占位页可打开且不假装有数据。

## 10. 验收条件

- 平台端与工作区共用 AppShell，侧栏展开 240、收起 64、Header 64。
- Token 与 V3 Canonical 一致，`providers.tsx` 与 `globals.css` 无第二套近色。
- 超级管理员导航无获客/跟单/客户，无未实现模块的空链（权限/飞书/Dashboard）。
- 总览四数字来自 summary 接口，不是前端对 100 条列表的估算。
- 公司 CRUD 状态机与第一切片行为一致，只换了视觉和文案。
- 工作区对象导航仍由发布 schema 驱动。
- `pnpm contracts:check`、Web 单测、API 单测（及现有 e2e 若触及租户）通过。
- 用户未提交的 `register/page.tsx` 与 `chat会话.md` 保持未暂存。

## 11. 文档事实来源

- 本规格是本切片实现事实来源。与 04/06/08 V3 在尺寸、颜色、组件行为上冲突时，以 04 Canonical 表和本规格的产品裁剪为准。
- [`CONTEXT.md`](../../../CONTEXT.md) 的领域语言：租户、平台管理员、租户管理员、员工。UI 对外显示「公司」，不把「租户」写进页面文案。
- [`docs/superpowers/specs/2026-08-20-account-invitation-workspace-design.md`](./2026-08-20-account-invitation-workspace-design.md) 规定开通、邀请和状态机；本切片不改这些规则。
- 模拟图只约束信息架构，不约束 Token、字段和未实现模块。
