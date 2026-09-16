# 多租户 CRM Builder 接手说明

更新时间：2026-09-16

`main` 与 `origin/main` 是当前开发基线。**不要把某次 `git log -1` 的输出写死进本文。**
Workflow V1 与 Action Engine V1 **均已合并进入 `main`**。Action Engine V1 通过 PR #1 合并，合并提交 `e590c23da6aa9c5fe0d0c3cd71250270ea265ebd`（该 SHA 只作为这一次历史事实记录，不是"main 永远等于它"）。Workflow Required Field Visibility Hardening 已通过 PR #2 合并（详见下方）。

验收见 `docs/audits/2026-09-15/workflow-v1-acceptance.md` 与
`docs/audits/2026-09-16/action-engine-v1-acceptance.md`。未部署生产环境。
不要自行开始 V2.2 Sales Execution。

Workflow Required Field Visibility Hardening **已通过 PR #2 合并进入 `main`**，合并提交
`0612d8ad521895c7ca7bd9efe2ef2f942cd28b40`（同样只作历史事实记录）。它修掉了
「对 Actor 隐藏的必填字段 key 会从 Runtime GET 与 direct execute 泄露」的 metadata
side channel，验收见 `docs/audits/2026-09-16/workflow-required-field-visibility-hardening.md`。
独立评审另发现**普通 records CREATE 路径存在同类但不同路径**的泄露（对员工 HIDDEN 的
required 字段会以 `FIELD_REQUIRED` + `fieldErrors.<hiddenKey>` 暴露），**本轮未修，需另开
独立 bounded 任务**，不要顺手在别的任务里改。

`codex/crm-polish-followups` 已快进合并进入 `main`。
2026-09-15 完成一轮人工验收并修复（清单见第 7 节）。

## 路线图层级（2026-09-16 起）

| 文档 | 角色 |
|---|---|
| `docs/superpowers/plans/2026-09-15-crm-process-roadmap.md` | **Full Capability Roadmap**：长期需求池与完整能力地图，标记为 `PLANNED` 的阶段不构成实现批准 |
| `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md` | **Lean Execution Roadmap**：近期实际执行路线，同一时间只激活一个主要产品 Task |

对照关系：Full Roadmap 上的长期需求不因 Lean Roadmap 而消失；只有从 Full Roadmap 提升出来的阶段才进入 Lean Roadmap 并成为 `ACTIVE`。两份文档与本文冲突时，以本文的当前事实为准。

AI Assistant 的方向见 `docs/superpowers/specs/2026-09-16-ai-assistant-v1-design.md`，分两阶段：

- **V1A Ask / Analyze**：只读，受当前登录用户权限约束（先裁剪、再交给 AI）；
- **V1B Confirmed Edit**：AI 只产出 Proposal，用户确认后服务端重新校验权限与版本，再执行 Typed Command 并写审计。

**当前不要开始 AI 开发**：V1A 与 V1B 都还只是方向，需要各自批准的设计规格与实现计划；V1B 应在 V1A 实际验证之后再开发。Sales Workbench、Automation、Production Essentials 同样尚未批准。

本文只记录当前事实。已完成与未完成对照见
`docs/superpowers/plans/2026-09-01-productization-follow-up.md`。

## 1. 接手时必须遵守

1. 不重新初始化项目、不更换技术栈、不把百杰业务规则写进通用 CRM 核心。
2. 不修改、恢复、格式化、暂存或提交以下用户文件：
   - `apps/web/src/app/(auth)/register/page.tsx`
   - `chat会话.md`
   - `.superpowers/sdd/2026-08-26-platform-business-template-designer/progress.md`
3. `main` 与 `origin/main` 已同步，含 Workflow V1 与 Action Engine V1。不要 reset、rebase、强推或部署。推送要等用户明确要求。
   `feat/action-engine-v1` 是**历史开发分支**（已通过 PR #1 合并进 `main`），不再作为当前开发基线。
4. 仓库存在 `.codegraph/`，理解代码时先运行 `codegraph explore "问题或符号"`。
5. 用户要求快速实现。每个 Bug 只保留一个能复现用户症状的聚焦验证；不要反复跑全仓测试或多轮审查。

接手后先执行：

```bash
git status --short --branch
git log -10 --oneline
```

## 2. 产品边界

产品分两层：

- 通用多租户 CRM：公司管理员创建业务对象、字段、默认视图和权限，发布后员工使用。
- 平台业务模板：超级管理员维护可复用的对象与工作台蓝图，并可将模板初始化给一家公司。

模板不是使用业务表的前置条件。没有平台模板时，公司管理员仍可在公司启用后手工创建并发布业务表。模板只是初始化加速器。

百杰的线索阶段、转换、期刊、电话 Bot、飞书自动化等具体规则不得写死进通用对象、记录、导航或权限模块。

## 3. 角色和公司生命周期

### 超级管理员

- 创建公司并邀请首位公司管理员。
- 在平台模板库维护业务模板和可选的默认工作台。
- 把已发布模板应用到尚未初始化的草稿公司。
- 启用、暂停或关闭公司。
- 不直接处理某家公司的日常 CRM 记录。

### 公司开通顺序

```text
超级管理员创建公司（DRAFT）并邀请首位管理员
  → 被邀请人使用目标手机号注册或登录
  → 在等待页接受邀请，形成 ACTIVE 的 TENANT_ADMIN 成员关系
  → 超级管理员启用公司（ACTIVE）
  → 公司管理员进入工作空间，检查/创建并发布业务表和工作台
```

后端禁止在没有至少一名有效公司管理员时把公司切到 `ACTIVE`。

### 公司管理员

- 创建、修改、排序、归档业务对象。
- 配置字段、默认列表、员工默认权限并发布对象。
- 邀请、停用成员，配置单个员工的业务表权限覆盖。
- 创建、编辑、预览、发布、切换、重命名、排序和归档本公司的工作台。

### 员工

- 只使用已发布的业务对象和工作台。
- 数据由 `ALL / OWN / NONE` 范围和字段权限裁剪。
- 不能进入对象设计器或工作台设计器。

## 4. 当前已经实现的功能

### 账号、邀请与工作空间

- 手机号注册、登录、退出、找回密码、修改密码。
- 登录会话列表、撤销会话和历史清理。
- 独立用户等待页、邀请接受/拒绝；接受后若公司仍为 DRAFT，会提示等待平台启用。
- 单/多工作空间入口。
- 超级管理员创建公司并邀请首位管理员。
- 公司详情展示开通进度：创建 → 邀请 → 接受 → 启用 → 业务表。
- 空公司可应用模板，也可明确选择由管理员手工创建第一张业务表。
- 公司管理员邀请、重发、撤销邀请及停用成员。
- 公司名称允许重复；创建时给出重复警告，不阻断。

### 业务对象与动态记录

- 公司管理员创建通用业务对象，配置 12 类运行时字段、默认表格视图和员工权限。
- 动态字段枚举中保留 `ATTACHMENT`，但该**动态字段类型**尚未与记录附件实体联动，草稿之外不接受。
- 记录详情已提供**独立附件面板**：真实上传（PDF / PNG / JPEG / TXT / CSV / DOCX / XLSX）、下载、删除，路由走 `SessionAuthGuard + WorkspaceGuard` 并做记录权限检查。
- 附件字节当前存于 PostgreSQL `bytea`，单文件上限 5 MB；生产环境应迁移到私有对象存储。
- 草稿可编辑；发布后生成不可变快照；运行时只读当前发布快照。
- 动态记录支持新增、查询、查看、编辑和软删除。
- 记录列表支持标题及可见文本字段关键词搜索；负责人和 `SINGLE_SELECT` / `MULTI_SELECT` / `MEMBER` / `DATE` / `DATETIME` / `NUMBER` / `MONEY` / `BOOLEAN` / 文本包含 / 空值筛选；系统列与可排序业务列的三态排序。
- 记录列表可导出当前筛选结果为 UTF-8 BOM CSV（Excel 可直接打开），列跟随个人列设置，上限 5000 条。
- 记录列表可导入 CSV：浏览器解析并映射到可写字段，服务端逐行创建并回执失败行。上限 500 行。不接受 xlsx，不更新已有记录。成员字段不能导入。
- 成员可为每张业务表设置个人显示列，保存在本机，不改发布默认视图；隐藏字段不能被勾选。
- 记录列表可勾选当前页记录做批量修改：只改勾选的可写字段，逐条校验权限和乐观锁，部分失败不回滚已成功行。一次最多 50 条。
- 窄屏下记录列表切换为卡片，不另建接口。
- 服务端执行字段校验、隐藏字段裁剪、只读拒绝、乐观锁、租户隔离和 RLS。
- 任意动态对象可配置 Workflow 草稿（状态、动作、角色、必填字段）。保存仍是草稿；随对象 Publish 冻结进 publication snapshot。
- 运行时状态复用 `records.status_key`（API 名 `workflowStateKey`）。新记录写入当前发布的初始状态；旧记录 `null` 需显式「进入流程」。
- Record Detail 展示当前状态、当前用户可执行 Transition 和流程历史。普通 PATCH 不能改流程状态。
- 独立测试对象 `workflow-check` 已在本地 nebula-demo 发布。管理员与员工（赵晨）均已走通新建记录 → 初始状态 → 执行 Transition。员工默认必须打开「可以查看」才会出现在导航中。

### Workflow Action Engine（**已在 `main`，通过 PR #1 合并；未部署**）

Transition 不再只是改状态，还能产生结构化业务动作：

- Transition 草稿带 typed `actions[]`（五类），有一套严格草稿校验；Actions 随对象 Publish 一起冻结进 publication snapshot，旧 publication 读取时补成空数组，保持向后兼容。
- 迁移 `0018_workflow_actions` 只给既有表加一列（JSONB，数组 CHECK），**不新增表、不新增 RLS Policy、不新增 GRANT**，也没有 ActionExecution 表。它只被应用到独立测试库 5433。
- 事务架构：一次 Transition 是**一个租户事务**；Action Engine 自己不开事务、也不写 Source，它只累积 Source patch，由调用方在**一次**写入里连同下一个流程状态和 `version + 1` 一起落库。Source 的这次写入走 `RecordsStore.applyTransition`（**不加** ACTIVE-owner 锁），普通记录更新走 `applyRecordPatch`（**会**加锁）—— 两者共用同一条写语句，**故意保持为两个意图，不要合并**。
- 五类 Action：`CREATE_RECORD`、`UPDATE_RECORD`（只改当前 Source）、`CREATE_RELATION`、`CREATE_FOLLOW_UP`、`ASSIGN_OWNER`（Source 的负责人改为执行人）。引用只能指向 `SOURCE_RECORD` 或前序 Action 的输出。
- 对象设计器里可编辑 Action；员工点带 Action 的 Transition 先看到静态效果清单确认，再执行；执行失败时文案用人类标签点名失败的步骤，并明确「所有变更均未保存」。
- 同一次 Transition 的全部变更**同时成功或全部回滚**；成功的 audit 共享一个 `workflowExecutionId`。
- 已用真实 PostgreSQL 证明：中途失败零残留回滚、权限继承与 Member Override 拒绝整条回滚、同一记录并发得到一个成功一个 `RECORD_VERSION_CONFLICT`、真实 `40P01` 死锁被有界重试消化且只提交一次、跨租户 RLS 隔离；并用真实浏览器走通成功 / 回滚 / 员工 / 错误四项。
- 验收事实、偏差与已知缺口见 `docs/audits/2026-09-16/action-engine-v1-acceptance.md`。

### 权限事实

- “员工默认”是对象发布快照中的 `EMPLOYEE` 角色策略。
- “成员覆盖”写入 `object_permissions` 的 `MEMBER` 记录，针对某个员工和某张业务表整条替换默认动作权限及数据范围。
- 切回“继承默认”会删除成员覆盖记录。
- 记录 Schema 和 CRUD 服务都会计算有效权限，不是只做了前端显示。
- 当前成员覆盖不改变字段权限；字段 `EDIT / READ_ONLY / HIDDEN` 仍来自发布快照。
- 当前成员覆盖不单独授予删除权限。

### 平台业务模板

- 模板列表、新建、多对象编辑、保存草稿、发布分析、不可变版本和应用记录。
- 已发布模板可初始化空白草稿公司的对象、字段、视图、默认权限和可选工作台草稿。
- 模板应用后是租户自己的副本，后续修改不会反向影响模板。
- 公司管理员仍需发布对象和工作台，员工才能使用。

### 组件化与多工作台

- 一家公司可有多套命名工作台，每套有稳定 `dashboardCode`、草稿和当前发布版本。
- 可设置管理员默认工作台和员工默认工作台；员工只看到已发布且受众允许的工作台。
- 支持指标卡、状态分布/漏斗、趋势图、员工业绩排行、记录列表五类组件。
- 组件显式绑定已发布业务对象和字段，不根据“线索/商机”等名称猜业务语义。
- 公司管理员可创建、复制、重命名、排序、归档、编辑、预览和发布；员工只读取发布版本。
- 运行时根据组件受众、对象权限、字段权限和 `ALL / OWN / NONE` 范围执行真实查询。
- 模板可以携带默认工作台草稿。
- 已处理 PostgreSQL 15 日期兼容、租户时区、DST、工作台版本冲突恢复、命名发布回填和首页分区布局。

工作台已有个人跟进待办入口，可筛选待跟进、逾期、已完成和已取消。异常队列、团队派单和主动通知仍未实现。

### 平台运营页

- 平台审计可分页筛选。
- 平台操作记录只展示已成功的模板应用，明确没有异步任务队列。
- 系统设置展示数据库、Redis、短信和 Web Origin 状态；生产短信为未配置。

## 5. 编码和唯一性

| 标识                   | 当前数据库规则                   |
| ---------------------- | -------------------------------- |
| 公司代码 `tenant.code` | 全平台唯一                       |
| 公司名称 `tenant.name` | 允许重复，创建时警告             |
| 业务模板代码           | 全平台唯一                       |
| 业务对象代码           | 同一公司内唯一，不同公司可重复   |
| 字段键                 | 同一公司、同一对象内唯一         |
| 员工编号               | 同一公司内唯一；允许多个未填写值 |
| 登录手机号             | 全平台唯一                       |
| 显示姓名               | 可重复                           |
| 独立用户名             | 当前不存在                       |

业务对象的稳定定位是 `(tenantCode, objectCode)`，HTTP 路径形如
`/api/v1/workspaces/{tenantCode}/objects/{objectCode}`。

## 6. 当前本地环境与演示账号

最近一次实际验证使用的是用户本机服务，不是 Docker 数据库：

- Web：`http://localhost:3000/`
- API：`http://localhost:3001/`
- PostgreSQL：本机 5432（Homebrew 与 Docker 都可能占用该端口，以当前 `.env` 为准）
- Redis：端口 6379
- 迁移：`main` 上最新是 `0017_workflow_state_machine`（本地 Homebrew 5432）。Action Engine 分支新增 `0018_workflow_actions`，**只应用到了独立测试库 5433**（`TEST_DATABASE_ADMIN_URL`）；本轮没有连接 5432，所以 `0018` 在 5432 上的状态未经验证。

独立测试库 5433（`compose.test.yaml`，库名 `crm_test`）当前保存着 Action Engine 的**已发布验收夹具**，不是空库：

- 演示租户 `nebula-demo`（ACTIVE）与 4 个已发布对象：`process-source`、`process-source-employee`、`process-target-a`、`process-target-b`。
- 一件**刻意保留**的夹具：员工周岚（`18800001007`）在 `process-target-b` 上有 Member Override `可以新建记录 = 关`，用于复现回滚走查。要还原，打开 `/workspace/nebula-demo/members/e4f8811a-cab4-4f2e-9492-7b7a2e4c48ba/access`，对 `process-target-b` 选「使用员工默认」并保存。
- 一个**孤儿用户** `+8613911112222`（`memberships = 0`），来自一次失败的 auth spec 复现，无害但可清理。

确定性演示租户：

- 公司代码：`nebula-demo`
- 公司名称：星云科技演示公司

| 角色       | 手机号                                     | 姓名                                                             |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------- |
| 公司管理员 | `18800001001`                              | 陈静                                                             |
| 普通员工   | `18800001003`                              | 赵晨 / EMP001                                                    |
| 普通员工   | `18800001002`、`18800001004`–`18800001010` | 刘洋、钱宇、孙悦、李昂、周岚、吴桐、郑凯、王宁                   |
| 平台管理员 | `15562266465`、`13966660001`               | admin、Task 9 平台管理员                                         |
| 平台管理员 | `13800000999`                              | 验收平台管理员（2026-09-15 走查时注册并 `platform-admin:grant`） |

口令不写进本仓库（仓库是公开的）。演示口令由
`apps/api/src/scripts/demo-company-fixture.ts` 的 `DEMO_PASSWORD` 决定——种子脚本必须知道它，
所以这个口令本质上就是公开的：**不要在任何真实环境复用它，需要时改常量后重新种子。**

演示租户 `nebula-demo` 的种子数据：6 张业务对象，16 条商机（`closeDate` 从 2026-08-17
到 2026-09-13），工作台发布 #7。

开发验证码来自 `.env` 的 `DEV_VERIFICATION_CODE`，目前通常为 `123456`，仅限本地。

## 7. 当前真实缺口与已知问题

`docs/audits/2026-09-09/role-completion.md` 是**历史验收记录**（三角色补齐阶段），不是当前事实来源；当前事实以本文为准。该轮结论：默认 UUID 与邀请状态竞态已修复；独立数据库开通、并发邀请、业务交接共 10 项 E2E 通过；已补角色升降/管理员移交/离职交接、首管纠错、公司审计、真实健康探测、任务转派、浏览器常用筛选、关联与附件；迁移增加至 0016。当时尚不能宣称生产验收完成，之后的修复与人工验收都已汇总到本文第 7 节。

2026-09-14 合并前独立复验（不依赖上述审计自述）：`pnpm typecheck` 6 个 workspace 全过；API 聚焦 103 测试通过；Web 全量 63 文件 352 测试通过；`pnpm contracts:check` 无漂移；本地 16 个迁移已应用。

已知既有失败已全部清零。此前 `apps/api/src/architecture.spec.ts` 因 `dashboards.repository.ts` 运行时导入 ESM 的 `@crm/database` 而报 `SyntaxError: Unexpected token 'export'`，现在该 spec 用 `jest.mock('@crm/database', …)` 处理（Prisma 是运行时值，`import type` 和 `moduleNameMapper` 都不成立）。

2026-09-15 全量 `pnpm test` 退出码 0：API 51 套件 403 测试、Web 63 文件 360 测试、contracts 7、database 6、tenant-templates 2、worker 2。

### Action Engine V1 已知缺口（已合并在 `main`）

- **已由 `c8acbf1` 修复，并已在 `main` 中**（PR #2 合并提交 `0612d8ad521895c7ca7bd9efe2ef2f942cd28b40`，完整提交 `c8acbf1` / `3773834` / `dfe568c` / `b5c28ce`）——Workflow Required Field Visibility Hardening：required field 为 `HIDDEN`（或不在 `access.fields` 中）时，整个 Transition 对该 Actor 不可执行 —— GET 不返回该 Transition，direct execute 返回通用 `WORKFLOW_TRANSITION_FORBIDDEN` (403)，不带 key / label / `fieldErrors`。可见 required field 的 `WORKFLOW_REQUIRED_FIELDS_MISSING` 行为不变。运行时判断基于 `EffectiveObjectAccess.fields`（`Object.hasOwn` fail-closed，防 `constructor` / `__proto__` / `toString` 原型链绕过）。验收见 `docs/audits/2026-09-16/workflow-required-field-visibility-hardening.md`。
- **publish 分析没有真正处理「只读 / 隐藏」和「有效默认值」**：对某个角色的 Transition 而言，一个实际只读或隐藏的必填字段仍然会被要求映射，映射与不映射两种配法**都发不出去**；且任何非空默认值都被当作有效。属「publish 说没问题、runtime 才会失败」的形状。
- **六个结构性 `WORKFLOW_ACTION_*` 错误码没有定位信息**（只有一条 message，没有 transitionKey / actionKey / fieldKey）。同样是既有截断行为，本特性只是让它更有后果。
- **`executionSummary` 目前没有任何消费者**，属可删的额外面。
- **「重试耗尽」的确定性证明来自单元测试**，e2e 的并发 A/B 用例没走到那条分支。重试上界仍是 3 次且无退避/抖动。
- **合并已完成，不再需要接手者决定。** Action Engine V1 已通过 PR #1 合并进 `main`。
- **普通 records CREATE 路径的同类 metadata 泄露（独立评审 H1，本轮未修）**：某个 required 非标题字段对员工是 `HIDDEN` 时，创建记录会抛 `FIELD_REQUIRED` 并带 `fieldErrors.<hiddenFieldKey>`；且 publish 期没有规则把「required + HIDDEN」判成配置错误，员工永远无法自己补上该字段。属**另一条路径的另一类问题**（写侧校验 + publish 规则），需要独立 bounded 任务（含 blocking publish issue），不要塞进无关任务顺手改。
- **Action 失败重抛的 `actions.<actionKey>.<fieldKey>` 通道**（`action-engine.ts`）：仅 legacy / 手写快照可达（新的 publish 分析已挡住），属残留，**不要因为本轮的 hardening 就认为该类问题已彻底关闭**。
- **验收与偏差清单**（含 100 条累积 Minor finding 的索引）在 `docs/audits/2026-09-16/action-engine-v1-acceptance.md`，逐条台账在 `.superpowers/sdd/progress.md`。

**与本分支无关的既有红灯**：`apps/api/test/auth.e2e-spec.ts` 有一条用例期望 `GET /api/v1/me/sessions` 返回数组、而接口返回分页对象（已核实早于本特性）；全仓 lint 有 57 个既有的 API 错误，而本分支自己的文件是 lint 干净的。此外 `pnpm test` **不跑 e2e**，e2e 必须单独按路径执行。

### 2026-09-15 验收修复（提交范围 `f0b3cc6..227e8d9`）

以真实浏览器操作逐页走查得来，不依赖审计自述：

- `07b0e16` 会话时区固定为 UTC。pg 适配器原本按会话时区渲染 `timestamptz` 再按 UTC 读回墙钟，写入 −8h、读回 +8h；DB `now()` 生成的值统一偏移 +8h（附件时间显示成 `2026/9/15`）。已回填 101 条历史记录的偏移。
- `db8175d` 个人列设置在挂载后写入 state，消除水合不一致。
- `f9cc4f4`、`eaf4053` ValidationPipe 与 CSV 导入回执都带上失败字段路径，不再只说“请求参数不合法”。
- `d37f15a` 拒绝 `canRead: true` + `readScope: 'NONE'` 这类自相矛盾的权限组合。
- `7277343` 对象设计器按保存的列顺序渲染列清单。
- `3046bab` 对象编码沿用服务端连字符规则，不再让前端先放行再被后端拒绝。
- `cb196dd` 设计器每类保存都给出具名成功提示（此前成功只是清空错误横幅）。
- `0be1dee` 未发布的草稿可以真正删除（此前误删 `object_publications` 报 42501）。
- `8380095` 被停用成员访问 `/me/workspaces` 不再 500（RLS 会隐藏非 ACTIVE 成员关系的 tenant 行，`flatMap` 跳过）。
- `172dace` 趋势图分桶标签裁剪到所选区间。31 天滚动窗口配 MONTH 粒度时，第一个桶标为 `2026-08-01`，落在页头声明的区间之外。注意 `GROUP BY` 必须用序号而不是重述表达式：Prisma 给每个 `?` 单独绑定参数，重述的表达式与 `GROUP BY` 里的不再是同一文本，PostgreSQL 报 42803。
- `3b43896` 工作台区间导航三处同源缺陷：预设从不被高亮（用当前时钟反查精确相等，只可能毫秒级命中）、渲染期读 `new Date()` 导致每次加载都报水合不一致、后端隐含窗口是 31 天而唯一的相关预设是 30 天。改为从区间自身反推预设，并把 API 默认窗口对齐到 30 天。
- `cc0266f` 成员覆盖保存给出具名成功提示。切回“继承默认”会收起面板，此前完全没有可见结果。
- `1142c65` 归档工作台先确认再执行；同一提交给 `DndContext` 一个显式 id，消除设计器每次加载的 dnd-kit 水合不一致（服务端与客户端各自生成 `DndDescribedBy-0` / `-1`）。
- `6c95f00` 平台审计补齐 7 个此前没有中文名的动作码（`dashboard.defaults_updated`、`object.draft_deleted`、`platform.admin.granted` 等）。原回退逻辑把下划线换成空格，于是表格里显示半英半中的「dashboard.defaults updated」；没有下划线的动作码则同一个码显示两遍。回退现在直接返回原码，第二行只在有额外信息时渲染。
- `227e8d9` 公司列表不再把「运行中且已有管理员」的公司显示成「尚未邀请」。

同轮人工验收（未改代码即通过）：

- 权限边界正确：员工看到 2 条线索而管理员看到 16 条；员工访问 `members` 与 `object-definitions` 均 403；员工导航隐藏成员、审计和设置。
- 成员覆盖生效并整条替换：把赵晨的线索查看范围放到“全部”，可见线索 0 → 16，而客户与商机仍为 0；改回继承后 6 张业务表全部回到 `INHERIT`。
- 真实执行过一次离职交接（赵晨 → 陈静，12 条记录，0 个未结待办），随后把赵晨恢复为 ACTIVE。**记录没有搬回**：交接本身不可逆，恢复成员身份不会回滚已转移的记录。

### 已完成（相对 2026-09-01 交接清单）

- 记录列表三态排序。
- 公司开通进度、空状态引导、邀请反馈和术语清理。
- 侧边栏桌面拖拽宽度。
- 窄屏记录卡片。
- 多工作台创建、切换、默认、归档。
- 类型化搜索、筛选和业务字段排序的查询链路。
- 公司名称重复警告。
- 工作台分区布局与 KPI 条。

### 2026-09-09 修复与增量

- 员工编辑不再意外变更负责人；隐藏标题发布校验与运行时拒绝保护。
- CSV 导出防公式执行，导入失败重试不重复创建成功行。
- 演示看板进行中/成交过滤已修正，并通过正常发布流程修复本地配置（进行中 10，已成交金额 244500）。
- 统一圆角（控件 8 / 卡片 12）、柔和配色、字段标签、金额格式、表格与手机记录卡片。
- 平台公司筛选、开通步骤和操作指引完善；首位管理员邀请可受控续期，有审计与并发保护。
- 个人跟进待办：记录详情创建、改期、完成、取消；到期未完成为逾期；权限重检、记录锁与版本冲突保护。
- 用户明确延后短信与 AI。本轮交付记录见 `docs/audits/2026-09-09/implementation.md`。

### 进行中 / 半成品

- P7 第一刀：记录活动时间线。成员可对可见且可更新的记录追加 `NOTE / CALL / MESSAGE / MEETING`；历史不可编辑。独立的个人跟进待办已实现；显式对象记录关联已实现，自动转换尚未实现。

### 产品与 UX 缺口

- 工作台设计器与平台后台已完成第一轮走查（复制、归档、组件顺序、审计、公司列表、模板列表、操作记录、系统设置；全程无控制台报错）。仍未逐项走的：设计器里新增/编辑组件属性、保存草稿、预览、发布这条主链路，以及平台的新增公司表单。
- 被停用成员回到 `/workspaces` 时显示「尚未加入公司」，与「已被停用」不是同一件事，文案不准。
- 附件大小格式化把 25 字节显示成「1 KB」。
- 映射导入创建的记录负责人显示「未指定」；产品上是否应强制指定负责人尚未决策。
- 跟进待办支持转派给有权限的有效成员；未接团队总览、主动提醒或异常队列。
- 普通记录列表目前不开放 `MEMBER` / `BOOLEAN` / `TEXTAREA` / `MULTI_SELECT` 排序。
- 侧边栏只能收起/展开或拖拽宽度，没有更多个性化。
- P0.2 邀请/启用人工走查没有写入仓库的验收记录。
- Web 测试债：36 个文件里有 207 处 `getByRole(..., { name })`。在 jsdom + antd 下每次调用约 2.7s（成本在可访问名计算，不在渲染），是套件慢的主因；已改成 `getByText` / `getByLabelText` 的地方快了约 20 倍。

### 尚未实现

- 真实短信供应商。
- 短信、邮件或飞书主动跟进提醒。个人任务页和逾期筛选已落地；旧活动上的 `nextActionAt` 未自动迁移成待办，避免重复任务和修改历史。
- 状态机、自动转换动作，以及重复客户识别、合并和去重。显式记录关联已落地。
- 原生 Excel 工作簿导入。CSV 字段映射、部分失败回执、失败行重试和服务端批次幂等已落地。
- 个人视图跨设备同步。筛选/排序命名保存当前浏览器已落地。
- 附件私有对象存储及动态字段联动。独立记录附件面板的真实上传、下载、权限已落地，当前存储于数据库。
- 真正的后台任务中心（当前操作页只列成功的模板应用）。
- 独立统计页与专门导入导出中心仍是占位；公司审计、记录内 CSV 导入导出已实现。
- 平台管理员受控进入租户协助排错的代管流程。
- 模板升级同步到已初始化公司。
- 生产数据库备份恢复、监控告警、日志脱敏与保留、迁移回滚、域名、HTTPS、Cookie 和跨域配置。
- 附件目前存在 PostgreSQL `bytea`（单文件 5MB）。上生产前必须换成对象存储。
- 仓库是公开的，所以口令不写进本文（见第 6 节）；演示口令本身由公开的种子常量决定，只能视为公开信息，不得复用到任何真实环境。
- 根 `engines` 已从 `>=20.9.0` 提高到 `>=24`：`@crm/database` 是 ESM 包而 `apps/api` 编译为 CJS，需要支持 `require(esm)` 的 Node，而本地只验证过 Node 24.19.0。若确认 22 LTS 可用，可以再放宽下限，但必须实测过再改。
- **没有 CI，也没有分支保护**：`.github/workflows/` 不存在，GitHub Actions 运行数为 0，`origin/main` 的 branch protection 返回 404、required status checks 为空。当前流程是「本地跑测试 → 直接 push main」，主干在服务端没有任何守门。
- `origin/backup/v3-design-tokens`：相对 `main` 落后 139 个提交，只独有 1 个提交 `e8812d8`「align design tokens with the V3 palette」，改的是 `globals.css` / `providers.tsx` / `providers.test.ts`，纯配色、无功能。而且 `main` 此后已自行演进到**另一套**配色（`primary: #167568` 青绿，backup 提的是 `#2563EB` 蓝），方向已经不同。结论：**不合并，也不需要「解冲突」**；它属于已经后置的配色议题，保留归档或直接删分支即可，不要长期挂在待决策清单里。

## 8. 验证边界

组件化工作台与后续产品化提交已有聚焦测试。这些结果证明已覆盖的深层逻辑，不代表所有页面视觉和人工交互都没有 Bug。接下来应以用户实际操作发现的问题为主，每个问题只建立一个最小复现，不要重复跑大套件。

Worker 进程可以连接 Redis，但没有注册业务队列。

## 9. 真实验证码现状

验证码的挑战记录、哈希保存、10 分钟过期、最多五次错误、手机号/IP/设备频率限制和一次性消费已经实现。

当前 `VerificationSender` 只有开发环境固定码实现。生产环境会明确报错 `Production verification sender is not configured`，因此尚不能部署为真实短信登录。

接入前需要用户提供：

- 供应商选择（阿里云短信或腾讯云短信等）。
- AccessKey / Secret，使用环境变量保存，禁止提交仓库。
- 已审核的短信签名。
- 注册验证码模板 ID。
- 找回密码验证码模板 ID。

准备说明见 `docs/deployment/sms-verification.md`。

## 10. 必读文件

1. `CONTEXT.md`
2. `docs/superpowers/specs/2026-08-21-dynamic-objects-records-design.md`
3. `docs/superpowers/specs/2026-08-26-platform-business-template-designer-design.md`
4. `docs/superpowers/specs/2026-09-01-componentized-dashboard-design.md`
5. `docs/superpowers/plans/2026-09-01-productization-follow-up.md`
6. `docs/superpowers/plans/2026-09-15-crm-process-roadmap.md`
7. `docs/superpowers/specs/2026-09-15-workflow-platform-boundaries.md`
8. `docs/superpowers/specs/2026-09-15-workflow-v1-design.md`
9. `docs/superpowers/plans/2026-09-15-workflow-v1-implementation.md`
10. `docs/audits/2026-09-15/workflow-v1-acceptance.md`
11. `docs/superpowers/specs/2026-09-16-action-engine-v1-design.md`
12. `docs/superpowers/plans/2026-09-16-action-engine-v1-implementation.md`
13. `docs/superpowers/specs/2026-09-16-action-engine-v1-compatibility-review.md`
14. `docs/audits/2026-09-16/action-engine-v1-acceptance.md`
15. `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`（近期执行路线）
16. `docs/superpowers/specs/2026-09-16-ai-assistant-v1-design.md`（AI 方向，未批准开发）

关键实现入口：

- `apps/api/src/modules/objects/effective-access.ts`
- `apps/api/src/modules/objects/object-publication.policy.ts`
- `apps/api/src/modules/workflows/workflow-admin.service.ts`
- `apps/api/src/modules/workflows/workflow-runtime.ts`
- `apps/api/src/modules/workflows/workflow-runtime.service.ts`
- `apps/api/src/modules/actions/action-engine.ts`
- `apps/api/src/modules/actions/action-draft.policy.ts`
- `apps/api/src/modules/actions/action-publication.policy.ts`
- `apps/api/src/modules/actions/action-value-resolver.ts`
- `apps/api/src/modules/records/record-command.ts`
- `apps/api/src/modules/records/records.repository.ts`
- `apps/api/src/modules/records/records.service.ts`
- `apps/api/src/modules/dashboards/dashboard-engine.ts`
- `apps/api/src/modules/dashboards/dashboards.service.ts`
- `apps/web/src/features/records/record-list.tsx`
- `apps/web/src/features/dashboard/dashboard-builder.tsx`
- `apps/web/src/features/dashboard/admin-workbench.tsx`
- `apps/web/src/features/dashboard/employee-workbench.tsx`

## 11. 给下一位 Agent 的启动提示

```text
你接手 /Users/zhongxu/Desktop/0-Inbox/multi-tenant-CRM-builder。

先只读执行 git status --short --branch 和 git log -10 --oneline，随后完整阅读
HANDOFF.md 与 docs/superpowers/plans/2026-09-01-productization-follow-up.md。
仓库存在 .codegraph/，理解代码前先用 codegraph explore。

不要重新设计架构、不要重新初始化、不要切换技术栈，也不要把百杰专属逻辑写进
通用对象、记录、导航或权限模块。

严禁修改、暂存或恢复：
- apps/web/src/app/(auth)/register/page.tsx
- chat会话.md
- .superpowers/sdd/2026-08-26-platform-business-template-designer/progress.md

`main` 与 `origin/main` 已同步，含 Workflow V1 与 Action Engine V1。不要 reset、rebase、强推或部署。
Action Engine V1 已完成、验收，并已通过 PR #1 合并进 `main`：
验收文档见 `docs/audits/2026-09-16/action-engine-v1-acceptance.md`。

P0–P5 主干已经落地。P7 表管理主干已齐。Workflow V1 与 Action Engine V1 的代码都已存在，
不要重新实现它们。**下一个阶段 V2.2 Sales Execution 尚未批准，不要自行开始**（Trigger /
Automation / Dedup / Notification / Template Upgrade / Agent 同样不要开始）。
**AI 开发同样不要开始**：`docs/superpowers/specs/2026-09-16-ai-assistant-v1-design.md` 只是
V1A（只读）/ V1B（人工确认后写）的方向，需要各自的设计规格与实现计划并获批准。
近期实际执行路线看 `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`；
`2026-09-15-crm-process-roadmap.md` 只是长期需求池，不要把它标记为 PLANNED 的阶段当成已批准的开发任务。
短信按用户要求暂缓（腾讯云凭据未提供）。

第一轮页面验收已覆盖：业务对象设计器、记录列表与权限边界、成员覆盖、离职交接、
Dashboard 基础操作（复制 / 归档 / 组件顺序）、平台审计、公司列表、模板列表、
操作记录、系统设置。

**下一轮尚需重点验收**：
1. Dashboard 设计器主链路：新增组件 → 编辑属性 → 保存草稿 → 预览 → 发布。
2. 平台公司创建完整链路：新增公司 → 首管邀请 → 接受邀请 → 启用公司。

不要反复跑全仓测试，每个 Bug 一个聚焦复现；新写的回归测试要先证明「去掉修复就会失败」。
优先用 Playwright 在真实页面上核实，而不是只看编译通过。

读完后先汇报：当前角色边界、公司开通顺序、模板是否必需、权限如何落库，以及你准备
处理的唯一下一刀。得到用户确认后再改代码。
```
