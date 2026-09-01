# 多租户 CRM Builder 接手说明

更新时间：2026-09-01

当前功能基线：本地 `main`，最近一项完整功能提交为 `3359f54`（组件化工作台 DST 与冲突草稿恢复）

状态：仅本地开发与验证，未推送、未部署

本文只记录当前事实。后续任务与优先级见
`docs/superpowers/plans/2026-09-01-productization-follow-up.md`。

## 1. 接手时必须遵守

1. 不重新初始化项目、不更换技术栈、不把百杰业务规则写进通用 CRM 核心。
2. 不修改、恢复、格式化、暂存或提交以下用户文件：
   - `apps/web/src/app/(auth)/register/page.tsx`
   - `chat会话.md`
   - `.superpowers/sdd/2026-08-26-platform-business-template-designer/progress.md`
3. 本地 `main` 领先远端且从未推送。不要 reset、rebase、强推或擅自部署。
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
- 编辑、预览并发布本公司的工作台。

### 员工

- 只使用已发布的业务对象和工作台。
- 数据由 `ALL / OWN / NONE` 范围和字段权限裁剪。
- 不能进入对象设计器或工作台设计器。

## 4. 当前已经实现的功能

### 账号、邀请与工作空间

- 手机号注册、登录、退出、找回密码、修改密码。
- 登录会话列表、撤销会话和历史清理。
- 独立用户等待页、邀请接受/拒绝。
- 单/多工作空间入口。
- 超级管理员创建公司并邀请首位管理员。
- 公司管理员邀请、重发、撤销邀请及停用成员。

### 业务对象与动态记录

- 公司管理员创建通用业务对象，配置 13 类字段、默认表格视图和员工权限。
- 草稿可编辑；发布后生成不可变快照；运行时只读当前发布快照。
- 动态记录支持新增、查询、查看、编辑和软删除。
- 记录列表已有标题搜索、负责人筛选、单选状态多选筛选、分页和部分系统字段排序。
- 服务端执行字段校验、隐藏字段裁剪、只读拒绝、乐观锁、租户隔离和 RLS。

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

### 组件化工作台

- 每家公司一套工作台草稿和一个当前发布版本。
- 支持指标卡、状态分布/漏斗、趋势图、员工业绩排行、记录列表五类组件。
- 组件显式绑定已发布业务对象和字段，不根据“线索/商机”等名称猜业务语义。
- 公司管理员可编辑、保存、预览和发布；员工只读取发布版本。
- 运行时根据组件受众、对象权限、字段权限和 `ALL / OWN / NONE` 范围执行真实查询。
- 模板可以携带默认工作台草稿。
- 已处理 PostgreSQL 15 日期兼容、租户时区、DST、工作台版本冲突恢复和发布状态刷新。

重要限制：工作台的数据与发布链路已经存在，但当前视觉结构、信息密度和 CRM 操作感仍然简陋，不能视为最终成品设计。

## 5. 编码和唯一性

| 标识 | 当前数据库规则 |
|---|---|
| 公司代码 `tenant.code` | 全平台唯一 |
| 公司名称 `tenant.name` | 当前允许重复 |
| 业务模板代码 | 全平台唯一 |
| 业务对象代码 | 同一公司内唯一，不同公司可重复 |
| 字段键 | 同一公司、同一对象内唯一 |
| 员工编号 | 同一公司内唯一；允许多个未填写值 |
| 登录手机号 | 全平台唯一 |
| 显示姓名 | 可重复 |
| 独立用户名 | 当前不存在 |

业务对象的稳定定位是 `(tenantCode, objectCode)`，HTTP 路径形如
`/api/v1/workspaces/{tenantCode}/objects/{objectCode}`。

## 6. 当前本地环境与演示账号

最近一次实际验证使用的是用户本机服务，不是 Docker 数据库：

- Web：`http://localhost:3000/`
- API：`http://localhost:3001/`
- PostgreSQL：Homebrew PostgreSQL 15.19，端口 5432，数据库 `crm`
- Redis：端口 6379
- 已应用迁移：`0009_componentized_dashboards`

确定性演示租户：

- 公司代码：`nebula-demo`
- 公司名称：星云科技演示公司
- 数据：10 名成员、7 张业务表、96 条记录

| 角色 | 手机号 | 密码 | 姓名 |
|---|---|---|---|
| 公司管理员 | `18800001001` | `Demo@123456` | 陈静 |
| 普通员工 | `18800001003` | `Demo@123456` | 赵晨 / EMP001 |

开发验证码来自 `.env` 的 `DEV_VERIFICATION_CODE`，目前通常为 `123456`，仅限本地。

## 7. 当前真实缺口与已知问题

### 已定位并准备修复

- 记录列表第三次点击排序会发出“取消排序”，但前端直接忽略，URL 仍保留倒序，导致无法恢复默认排序。

### 产品与 UX 缺口

- 管理员和员工工作台视觉简陋，缺少成熟 CRM 首页的信息层级、任务入口、异常提醒和足够的业务密度。
- 公司详情页没有清楚展示“创建 → 接受邀请 → 启用 → 初始化业务”的步骤进度。
- 没有模板时的空工作空间缺少明显的“手工创建第一张业务表”引导。
- “管理工作台”与“公司工作空间”的语言不够清楚。
- 侧边栏只能收起/展开，不能拖拽调整宽度。
- 邀请接受后的反馈和 DRAFT 公司尚不能进入的原因不够直观。
- 公司名称当前可重复，与用户预期可能不一致，需要产品规则和界面提示。

### 尚未实现

- 真实短信供应商。
- 记录活动时间线、状态机、对象关系、转换动作。
- Excel 导入预览、字段映射和错误行回执。
- 批量操作、导出、列设置、个人视图。
- 平台日志中心、后台任务中心和完整系统设置。
- 模板升级同步到已初始化公司。

## 8. 验证边界

组件化工作台最近的聚焦结果：

- Dashboard API：75/75。
- Dashboard Web：32/32。
- Contracts：7/7。
- API、Web、contracts 类型检查通过。

这些结果证明已覆盖的深层逻辑，不代表所有页面视觉和人工交互都没有 Bug。接下来应以用户实际操作发现的问题为主，每个问题只建立一个最小复现，不要重复跑大套件。

## 9. 真实验证码现状

验证码的挑战记录、哈希保存、10 分钟过期、最多五次错误、手机号/IP/设备频率限制和一次性消费已经实现。

当前 `VerificationSender` 只有开发环境固定码实现。生产环境会明确报错 `Production verification sender is not configured`，因此尚不能部署为真实短信登录。

接入前需要用户提供：

- 供应商选择（阿里云短信或腾讯云短信等）。
- AccessKey / Secret，使用环境变量保存，禁止提交仓库。
- 已审核的短信签名。
- 注册验证码模板 ID。
- 找回密码验证码模板 ID。

## 10. 必读文件

1. `CONTEXT.md`
2. `docs/superpowers/specs/2026-08-21-dynamic-objects-records-design.md`
3. `docs/superpowers/specs/2026-08-26-platform-business-template-designer-design.md`
4. `docs/superpowers/specs/2026-09-01-componentized-dashboard-design.md`
5. `docs/superpowers/plans/2026-09-01-componentized-dashboard.md`
6. `docs/superpowers/plans/2026-09-01-productization-follow-up.md`

关键实现入口：

- `apps/api/src/modules/objects/effective-access.ts`
- `apps/api/src/modules/objects/object-publication.policy.ts`
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

本地 main 未推送。不要 reset、rebase、强推或部署。

用户当前优先级是：先修可见 Bug 和流程理解问题，再重做工作台视觉，最后在用户提供
供应商凭据后接真实短信。不要反复跑全仓测试；每个 Bug 一个聚焦复现，完成一组任务后
只做一次人工 smoke。

读完后先汇报：当前角色边界、公司开通顺序、模板是否必需、权限如何落库，以及你准备
处理的唯一下一刀。得到用户确认后再改代码。
```
