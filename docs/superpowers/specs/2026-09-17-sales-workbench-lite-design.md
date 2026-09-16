# Sales Workbench Lite — Design

> 日期：2026-09-17  
> 类型：Product / Architecture Design  
> 状态：DESIGN APPROVED IN CHAT — WRITTEN SPEC READY FOR REVIEW  
> Stage Brief：`docs/superpowers/briefs/2026-09-16-sales-workbench-lite-stage-brief.md`  
> 当前基线：`main` @ `aa505d37766816fc751a91280f6cd82d1153eae5`  
> 前置条件：Engineering Gate Lite 已完成；`main` protection 已对管理员生效；五个 required checks 已就位。  
> 后续顺序：Sales Workbench Lite → Engineering Gate Hardening → AI Assistant V1A。

## 1. 目标

Sales Workbench Lite 的目标是：

> 员工进入 CRM 首页后，不需要公司管理员额外配置，就能立即回答“我今天应该做什么？”

本阶段复用已经存在的 Follow-up Domain，不创建第二套 Task System，不把个人执行数据塞进 Dashboard publication schema。

最终员工首页新增固定的 **Personal Follow-up Workbench**，展示：

- 全部待办数量；
- 今日到期数量与预览；
- 已逾期数量与预览；
- 未来 7 天数量与预览；
- 可直接完成自己有权限管理的 Follow-up；
- 可跳转到关联 Record；
- 可进入现有完整 Follow-up 页面继续改期、转派、取消等操作。

## 2. 已确认的核心设计决策

### 2.1 固定个人区块，不新增 Dashboard widget type

采用：

```text
Employee Home
→ Personal Follow-up Workbench（固定、按当前 Actor 运行）
→ Published Dashboard
→ Shortcuts / Business Objects
```

明确不采用：

```text
Dashboard Builder
→ FOLLOW_UP_LIST widget
→ Dashboard publication
→ Runtime evaluation
```

原因：

1. Follow-up 是个人执行数据，不是管理员发布的分析组件；
2. 员工是否能看到自己的待办，不应依赖公司管理员是否配置/发布 Dashboard；
3. 新增 Dashboard widget 会扩展 Dashboard schema、publication、builder、renderer、validation，超出 Lite 范围；
4. 当前仓库已经有固定 `FollowUpSummary` 入口，演进路径自然。

### 2.2 新增专用 Workbench read model

新增：

```http
GET /workspaces/:tenantCode/follow-ups/workbench
```

它不是新的业务 Domain，而是现有 Follow-up Domain 的个人首页读取模型。

### 2.3 “近期”的精确定义

采用：

```text
未来 7 个租户日历日，不含今天
```

服务端按租户时区切分，不按浏览器时区或 UTC 直接切日期。

## 3. 当前代码基线

### 3.1 已存在的 Follow-up 能力

当前 API 已存在：

```text
GET    /workspaces/:tenantCode/follow-ups
POST   /workspaces/:tenantCode/follow-ups
GET    /workspaces/:tenantCode/follow-ups/:id/recipients
PATCH  /workspaces/:tenantCode/follow-ups/:id
```

现有 Follow-up 已具备：

- `assigneeMemberId`
- `dueAt`
- `OPEN / DONE / CANCELLED`
- `overdue`
- optimistic version
- reassignment
- reschedule
- completion
- cancellation
- Record linkage
- Audit
- Tenant/RLS
- 当前 Actor 的 Record access 检查

### 3.2 已存在的员工入口

员工首页当前有：

```text
FollowUpSummary
→ DashboardRenderer
→ EmployeeShortcuts
→ BusinessObjectBar
```

但 `FollowUpSummary` 目前只是跳转到 `/follow-ups` 的静态入口，还不能直接回答“今天该做什么”。

### 3.3 已存在的完整 Follow-up 页面

当前 `/workspace/:tenantCode/follow-ups` 已支持：

- OPEN
- OVERDUE
- DONE
- CANCELLED
- 分页
- 完成
- 改期
- 转派
- 取消
- 关联 Record 跳转

因此本阶段不重做完整 Task Center。

## 4. 架构

### 4.1 数据流

```text
Employee Workbench
        ↓
GET /workspaces/:tenantCode/follow-ups/workbench
        ↓
SessionAuthGuard
        ↓
WorkspaceGuard
        ↓
Current TenantContext（server-derived）
        ↓
PublishedObjectService / Effective Access
        ↓
Follow-up query service
        ↓
Follow-up repository
        ↓
Tenant + current assignee + Record visibility + RLS
        ↓
Safe Workbench DTO
```

### 4.2 Read 与 Write 分离

Workbench endpoint 只负责读取首页数据。

完成操作仍然调用已有：

```http
PATCH /workspaces/:tenantCode/follow-ups/:id
```

并提交：

```json
{
  "version": 3,
  "status": "DONE"
}
```

因此首页不会新增“快速完成”后门，不绕过：

- version check；
- current Actor；
- Record 权限；
- Tenant；
- RLS；
- Audit；
- Follow-up 状态校验。

## 5. 权限与安全边界

### 5.1 “我的”由服务端解析

`/follow-ups/workbench` 永远表示：

> 当前登录成员自己的 Follow-up Workbench。

客户端不得传：

```text
memberId
assigneeMemberId
userId
tenantId
role
```

来改变查询 Actor。

即使当前 Actor 是 `TENANT_ADMIN`，该 endpoint 如果未来被复用，也仍表示管理员“自己的”事项，而不是团队待办。

### 5.2 查询边界

读取链固定为：

```text
Current Actor
→ 当前 Tenant
→ Published Object
→ Effective Access
→ readScope
→ Follow-up.assigneeMemberId = context.memberId
→ Record 仍存在
→ Record 仍对 Actor 可见
→ RLS
```

### 5.3 Record visibility fail closed

如果 Follow-up 关联的 Record：

- 被删除；
- Object 对 Actor 不再可见；
- `readScope=OWN` 且 Record owner 已改变；
- 其他权限变化导致 Actor 不再有权读取；

则该 Follow-up 直接从 Workbench 消失。

禁止返回：

```text
“你有一个无权查看的待办”
hidden record id
hidden title
hidden object name
hidden count by inaccessible object
```

避免 metadata side channel。

### 5.4 Read 权限不等于 Update 权限

Workbench item 可以被读取，但只有：

```text
canManage = true
```

时才显示“完成”按钮。

真正 PATCH 时服务端再次做完整权限和 version 校验。

## 6. 时间模型

### 6.1 Tenant timezone 是唯一业务时间基准

Workbench 日期分区使用租户时区。

禁止：

- 浏览器本地时区决定“今天”；
- UTC 00:00 直接决定“今天”；
- timezone 无效时 fallback 到 UTC。

租户 timezone 无效时 fail closed，返回现有系统错误语义。

### 6.2 单次请求只读取一次 now

一次 Workbench 请求中：

```text
now
todayStart
tomorrowStart
day8Start
```

必须从同一时间锚点计算，避免跨午夜时 counts 与 preview 使用不同边界。

### 6.3 Bucket 定义

只纳入：

```text
status = OPEN
```

定义：

```text
overdue:
dueAt < todayStart

today:
todayStart <= dueAt < tomorrowStart

upcoming:
tomorrowStart <= dueAt < day8Start
```

其中 `day8Start` 表示“今天开始后的第 8 个租户日历日 00:00”，所以 upcoming 恰好覆盖未来 7 个完整日历日。

### 6.4 DST

租户日历加天必须按 timezone/calendar 语义计算。

禁止：

```text
todayStart + 8 * 24h
```

作为唯一实现，因为 DST 切换可能导致本地日历边界错位。

## 7. API Design

### 7.1 Endpoint

```http
GET /workspaces/:tenantCode/follow-ups/workbench
```

Guards：

```text
SessionAuthGuard
WorkspaceGuard
```

### 7.2 Response

```ts
interface FollowUpWorkbenchResponse {
  timezone: string;

  counts: {
    allOpen: number;
    overdue: number;
    today: number;
    upcoming: number;
  };

  preview: {
    overdue: FollowUpWorkbenchItem[];
    today: FollowUpWorkbenchItem[];
    upcoming: FollowUpWorkbenchItem[];
  };
}
```

### 7.3 Item shape

```ts
interface FollowUpWorkbenchItem {
  id: string;
  recordId: string;
  recordTitle: string;
  objectCode: string;
  objectName: string;
  title: string;
  dueAt: string;
  version: number;
  overdue: boolean;
  canManage: boolean;
}
```

不返回：

```text
tenantId
userId
assigneeMemberId
internal objectId
Record.values
hidden fields
effective access internals
role
```

### 7.4 Preview limit

每个 bucket：

```text
limit = 5
order = dueAt ASC, id ASC
```

### 7.5 Counts

`counts` 是完整集合统计，不受 preview limit 影响。

语义：

```text
allOpen = 所有当前可见且分配给当前 Actor 的 OPEN Follow-up

overdue = overdue bucket 总数
today = today bucket 总数
upcoming = upcoming bucket 总数
```

`allOpen` 可能大于：

```text
overdue + today + upcoming
```

因为它还包含未来 7 天之后的 OPEN Follow-up。

### 7.6 Endpoint 原子语义

Workbench 查询应作为一个逻辑请求返回。

如果任意核心查询失败：

```text
整个 endpoint 失败
```

不要返回半截业务结果。

## 8. Service / Repository Design

### 8.1 FollowUpsService

建议在现有 `FollowUpsService` 增加：

```ts
workbench(context: TenantContext)
```

职责：

1. load tenant timezone；
2. derive current Actor accessible object scopes；
3. 计算 calendar boundaries；
4. 调用 repository workbench query；
5. 返回 safe DTO。

应尽量抽取并复用当前 `list()` 已有的 scope resolution，避免 list/workbench 两套权限逻辑长期漂移。

### 8.2 FollowUpsRepository

新增专用 query：

```ts
workbench(context, scopes, range)
```

repository 不接受任意 assigneeMemberId。

内部固定：

```text
assigneeMemberId = context.memberId
tenantId = context.tenantId
```

Record 条件复用现有 scope 规则：

```text
objectId
ownerMemberId（readScope=OWN 时）
deletedAt = null
```

### 8.3 数据库访问次数

Lite 目标是简单、清晰、正确。

允许在同一 tenant context 中执行：

```text
counts
+ overdue preview
+ today preview
+ upcoming preview
```

不为了减少少量 SQL 引入复杂 raw SQL 聚合。

## 9. UI Design

### 9.1 Personal Follow-up Workbench

用固定个人区块替代当前静态 `FollowUpSummary`。

推荐组件：

```text
apps/web/src/features/follow-ups/follow-up-workbench.tsx
```

首页大致：

```text
我的跟进

全部待办 12    今日 3    已逾期 2    未来7天 5

已逾期
  回访客户 A
  客户 A · 线索
  09/16 09:00                  [完成]

今日
  确认报价
  客户 B · 商机
  今天 15:00                   [完成]

近期
  二次沟通
  客户 C · 客户
  明天 10:00

查看全部跟进
```

### 9.2 Preview 分区

首页仅列：

```text
overdue
today
upcoming
```

不再列 `allOpen` 全量 preview，避免重复。

### 9.3 空状态

单个 bucket 为空时：

- 不显示大型 Empty 插画；
- 可折叠该区块，或显示简洁“暂无”。

整个 Workbench 没有待办时，可显示：

```text
今天没有需要处理的跟进事项
```

并保留“查看全部跟进”入口。

### 9.4 点击行为

点击 item 的主链接进入：

```text
/workspace/:tenantCode/objects/:objectCode/:recordId
```

### 9.5 首页允许的写操作

首页只允许：

```text
完成
```

不允许：

```text
改期
转派
取消
新建
批量操作
```

这些继续留在现有完整 Follow-up 页面或 Record Detail。

### 9.6 完成后的刷新

成功 PATCH 后：

```text
invalidate Personal Workbench query
invalidate existing follow-up list query prefix
```

使首页和 `/follow-ups` 页面保持一致。

### 9.7 Version conflict

如果完成时返回：

```text
409 RECORD_VERSION_CONFLICT
```

前端：

1. 显示简短错误；
2. 重新拉 Workbench；
3. 不自动覆盖；
4. 不自动 retry write。

### 9.8 Workbench 查询失败

个人区块显示：

```text
跟进事项暂时无法加载
[重试]
```

但不阻塞下面 Dashboard renderer。

## 10. Dashboard UNCONFIGURED 行为

### 10.1 Employee

当前员工没有已发布 Dashboard 时，Personal Follow-up Workbench 仍必须可用。

目标结构：

```text
Personal Follow-up Workbench
↓
StatePanel：公司工作台尚未启用
↓
Business Objects / navigation
```

个人执行数据不依赖 Dashboard publication。

### 10.2 Tenant Admin

管理员 UNCONFIGURED 行为保持现在的 Dashboard 配置引导。

本阶段不在管理员首页增加 Personal Follow-up Workbench。

## 11. Contract / OpenAPI

新增 endpoint 和 response DTO 会正常进入 OpenAPI。

预计生成：

```text
packages/contracts/openapi.json
packages/contracts/src/generated/openapi.ts
```

这些属于正常 contract generation，不手写 generated 文件。

`pnpm contracts:check` 必须通过。

## 12. 预计改动面

### API

```text
apps/api/src/modules/follow-ups/
  follow-ups.controller.ts
  follow-ups.dto.ts
  follow-ups.service.ts
  follow-ups.repository.ts
  follow-ups.service.spec.ts
  follow-ups.repository.spec.ts
```

可能新增：

```text
follow-up-workbench-time.ts
follow-up-workbench-time.spec.ts
```

如果 timezone/calendar helper 已有适合 API 复用的通用位置，应复用，不重复实现。

### Web

```text
apps/web/src/features/follow-ups/
  follow-up-api.ts
  follow-up-workbench.tsx
  follow-up-workbench.test.tsx
  follow-ups.module.css

apps/web/src/features/dashboard/
  employee-workbench.tsx

apps/web/src/app/(workspace)/workspace/[tenantCode]/
  workspace-home-view.tsx
  workspace-home-view.test.tsx
```

旧：

```text
follow-up-summary.tsx
```

可以删除并由 Workbench 替代，或保留为 Workbench 内部小组件；不得保留两个重复首页入口。

### Contracts

```text
packages/contracts/openapi.json
packages/contracts/src/generated/openapi.ts
```

## 13. 明确不修改

正常实现不应修改：

```text
DashboardWidgetType
Dashboard Definition V2
Dashboard publication schema
Dashboard Builder
Prisma schema
migrations
Workflow
Action Engine
Worker
Redis
CI workflow
branch protection
```

如果实现过程中发现必须修改数据库 schema，视为设计假设失效，必须停下来重新评审，不允许直接扩范围。

## 14. Testing Strategy

### 14.1 API unit / repository tests

至少覆盖：

1. Employee A 只看到 A 的 Follow-up；
2. Employee B 不看到 A；
3. Tenant B 不看到 Tenant A；
4. `readScope=OWN` 只显示 Actor 仍有权读取的 Record；
5. `readScope=ALL` 仍只返回 `assignee=currentMember`；
6. Object/Record 不可访问时 item 完全消失；
7. DONE 不进入 Workbench；
8. CANCELLED 不进入 Workbench；
9. overdue 边界正确；
10. today 起始边界正确；
11. tomorrow 起始边界正确；
12. future 7-day 结束边界正确；
13. preview 每 bucket 最多 5；
14. preview `dueAt ASC, id ASC`；
15. counts 不受 preview limit 影响；
16. allOpen 包含 future-7-days 之外的 OPEN；
17. invalid tenant timezone fail closed；
18. DST 日历边界测试至少一个。

### 14.2 Existing write path regression

首页完成使用现有 PATCH，因此至少保留/补充聚焦测试证明：

- version conflict 仍 409；
- 无管理权限不能完成；
- completion 写 Audit；
- 完成后 status 不再 OPEN。

不要复制已有 Follow-up command 的大量测试，只补 Workbench integration 所需回归。

### 14.3 Web tests

至少覆盖：

1. counts 展示；
2. overdue/today/upcoming 三组展示；
3. allOpen 不重复显示列表；
4. 每 item Record link 正确；
5. `canManage=false` 不显示完成按钮；
6. `canManage=true` 可完成；
7. 完成成功刷新 Workbench；
8. 完成成功 invalidates follow-up list query；
9. 409 显示错误并 refetch；
10. Workbench query error 不阻塞 Dashboard；
11. Employee + UNCONFIGURED 仍显示 Workbench；
12. TENANT_ADMIN + UNCONFIGURED 保持旧行为；
13. 窄屏结构可纵向使用。

### 14.4 Required CI

PR 必须通过当前：

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
```

本 Task 不修改 CI required checks。

## 15. Acceptance

Sales Workbench Lite 完成至少证明：

```text
Employee A
→ 首页只看到自己的可见 Follow-up

Employee B
→ 看不到 A 的事项

Tenant B
→ 看不到 Tenant A

Employee
→ 首页直接看到 today / overdue / upcoming

Employee
→ 完成可管理的事项后，该事项立即从对应 bucket 消失

Employee
→ 点击事项可以进入关联 Record

Record 失去可见性
→ Follow-up 不再出现在 Workbench，且不泄露 metadata

Dashboard 未配置
→ Employee 仍可使用 Personal Follow-up Workbench

Tenant Admin
→ 首页行为未被本阶段改变

CI
→ 五个 required checks 全绿
```

## 16. 非目标

本阶段明确不做：

- Team Task Center；
- 主管工作台；
- 按 member 查询 Workbench；
- 团队 Follow-up 聚合；
- 无负责人池；
- 自动升级；
- SLA；
- 自动派单；
- round-robin；
- Task dependency；
- subtask；
- 新 Task 数据模型；
- Follow-up notification；
- 邮件提醒；
- AI reminder；
- Event/Trigger Automation；
- 新 Dashboard widget；
- Dashboard Builder 配置个人 Follow-up；
- 管理员首页个人 Follow-up；
- 批量完成；
- 批量转派；
- Critical API E2E required gate。

## 17. 与 Roadmap 的关系

当前顺序保持：

```text
Engineering Gate Lite          ✅ COMPLETED
→ Sales Workbench Lite         ← 当前阶段
→ Engineering Gate Hardening
→ AI Assistant V1A
→ AI Assistant V1B
→ Production Essentials
→ Optional Email Adapter
```

Sales Workbench Lite 完成后：

> 不直接进入 AI V1A。

下一阶段必须先完成 **Engineering Gate Hardening**，把 Critical API E2E 稳定并提升为第六个 required check。

## 18. 完成定义

Sales Workbench Lite 的产品完成定义：

> 员工进入 CRM 首页，不依赖管理员额外配置，就能看到自己的已逾期、今日和未来 7 天 Follow-up，并可以安全地完成有权限管理的事项；整个实现继续复用唯一的 Follow-up Domain，没有新增第二套任务系统。

本 Design Spec 获得书面确认后，下一步才进入：

```text
docs/superpowers/plans/2026-09-17-sales-workbench-lite-implementation.md
```

此时仍未授权实现代码。
