# Workflow / Automation / Agent 平台架构边界

> 日期：2026-09-15  
> 文档类型：Architecture Boundaries  
> 状态：长期约束  
> 适用范围：Workflow、Action Engine、Automation、Approval、Agent  
> 当前事实来源：`HANDOFF.md`

## 1. 为什么需要这份文档

未来几个版本会连续引入：

- Workflow；
- Action；
- Event / Trigger；
- Approval；
- Agent。

如果每个阶段各自发明一套执行逻辑，最终会出现：

- Workflow 一套权限；
- Automation 一套权限；
- Agent 又一套权限；
- 同一个动作有多个入口；
- Audit 无法统一；
- 多租户边界变得不可证明。

因此本文件定义**长期不轻易改变的架构边界**。

具体 Task 可以调整实现细节，但不得违反这里的原则；如必须违反，先修改本文并说明原因，再开发。

---

# 2. 领域语言

CRM Core 允许使用的长期通用概念：

```text
Tenant
Member

Object
Field
Record
Relation

Workflow
State
Transition

Action
Event
Trigger
Task

Approval
Audit
```

行业/客户语义属于模板或租户配置，例如：

```text
线索
客户
联系人
商机
期刊
候选人
工单
项目
```

这些词不能成为通用 Workflow Core 的类名、硬编码分支或权限规则。

---

# 3. BOUNDARY-01：通用 Core 不写死行业流程

禁止在通用模块出现类似：

```ts
convertLeadToCustomer()
if (objectCode === "opportunity") ...
if (stage === "won") ...
```

正确方向是：

```text
Object
  ↓
Workflow
  ↓
Transition
  ↓
Action[]
```

例如“线索转客户”应由模板描述：

```text
Transition: convert
Actions:
  CREATE_RECORD
  CREATE_RELATION
  CREATE_FOLLOW_UP
```

百杰业务规则同样只能进入：

- Tenant Template；
- Tenant Configuration；
- Integration Adapter。

不得进入通用：

- Records；
- Objects；
- Workflow；
- Effective Access；
- Navigation；
- Audit Core。

---

# 4. BOUNDARY-02：多租户与权限系统始终是权威来源

Workflow、Automation、Agent 都必须复用现有安全边界。

至少包括：

- `SessionAuthGuard`；
- `WorkspaceGuard`；
- `TenantContext`；
- Effective Object Access；
- Field Permission；
- PostgreSQL RLS；
- Active Membership；
- Active Tenant。

任何新入口不得只靠前端隐藏按钮实现安全。

## 4.1 运行时原则

用户执行 Transition 时：

```text
Session
  ↓
WorkspaceGuard
  ↓
TenantContext
  ↓
Record Visibility
  ↓
Effective canUpdate
  ↓
Transition Permission
  ↓
Field/Condition Validation
  ↓
Execute
```

Automation / Agent 即使不是由用户直接点击，也必须有明确的：

- Tenant Context；
- Actor / System Actor；
- Permission Policy；
- Audit Identity。

禁止使用超级数据库权限绕过 RLS 作为业务实现方式。

---

# 5. BOUNDARY-03：Draft 与 Published Runtime 分离

现有 Object Definition 已采用：

```text
Draft Metadata
  ↓
Publish
  ↓
Immutable ObjectPublication Snapshot
  ↓
Runtime
```

Workflow 必须沿用同一模式。

## 5.1 规则

- Admin 编辑的是 Draft Workflow；
- Runtime 不读取半成品 Draft；
- Object Publish 时把 Workflow 编译进入 Object Publication Snapshot；
- 已发布版本不可原地修改；
- Runtime 只根据 Active Publication 执行；
- Draft 修改不得立即改变员工运行时行为。

## 5.2 不建立第二套独立发布时钟

Workflow V1 不应额外建立：

```text
WorkflowPublicationVersion
```

并让它独立于：

```text
ObjectPublicationVersion
```

否则会出现：

```text
Object v7 + Workflow v12
```

这种组合版本，很难审计和回滚。

Workflow 是 Object Runtime Schema 的组成部分，应随 Object Publish 一起冻结。

---

# 6. BOUNDARY-04：流程状态不是普通可随意写入的业务字段

Workflow State 具有强语义：

- 决定当前可执行 Transition；
- 决定流程历史；
- 可能触发未来 Action；
- 未来会成为 Event 来源。

因此 V1 的正式决策是：

```text
数据库物理列：records.status_key
Prisma 字段：Record.statusKey
领域 / API 名称：workflowStateKey
```

这是 2026-08-21 动态记录设计预留给受控状态机的列，不是新加第二列。  
不要再 migration 出 `workflow_state_key`。

它是独立运行时状态，而不是某个普通 `SINGLE_SELECT` 魔法字段。

普通 `Record Update` 不允许直接修改该字段。

只能由：

```text
Workflow Runtime
```

在合法 Transition 内修改。

## 6.1 原因

这样可以避免：

```text
用户 PATCH record
  ↓
status = won
```

绕过：

- Transition Permission；
- Required Fields；
- History；
- Audit；
- Future Action。

## 6.2 对列表与统计的影响

Workflow State 在 V1 可以先作为结构化系统元数据暴露。

后续再统一支持：

- Record List State Column；
- State Filter；
- Dashboard Funnel；
- Stage Aging；
- Conversion Analytics。

不能为了立即复用普通字段筛选而牺牲流程完整性。

---

# 7. BOUNDARY-05：所有副作用最终收敛到结构化 Action

Workflow V1 只做状态迁移。

后续 Action Engine 应定义结构化 Action，例如：

```text
UPDATE_RECORD
CREATE_RECORD
CREATE_RELATION
CREATE_FOLLOW_UP
ASSIGN_OWNER
NOTIFY
```

要求：

- 有稳定 `type`；
- 有可验证 payload；
- 有权限策略；
- 有幂等策略；
- 有 Audit；
- 可以被 Workflow 调用；
- 可以被 Automation 调用；
- 未来可以被 Agent Typed Tool 调用。

禁止长期保留：

```ts
transitionService.convertFoo()
automationService.createBar()
agentService.directWriteBaz()
```

三套并行执行层。

---

# 8. BOUNDARY-06：Event 是事实，Action 是意图

未来 Automation 应明确区分：

## Event

已经发生的事实，例如：

```text
RECORD_CREATED
STATE_CHANGED
FOLLOW_UP_OVERDUE
```

## Trigger

监听什么 Event、满足什么条件。

## Action

接下来执行什么。

目标结构：

```text
Event
  ↓
Trigger
  ↓
Condition
  ↓
Action
```

Event 不应该直接包含大量业务副作用。

---

# 9. BOUNDARY-07：Action / Transition 必须可审计

以下行为必须进入 Audit：

- Workflow Draft 修改；
- Workflow Publish；
- Manual Transition；
- Automated Transition；
- Action Execution；
- Approval；
- Agent Action；
- Merge；
- Assignment；
- Notification（至少记录发送请求与结果）。

Audit 至少要能回答：

```text
谁
在什么 Tenant
对什么资源
在什么时间
执行了什么动作
从什么状态
到什么状态
结果是什么
```

结构化 Transition History 与平台/公司 Audit 解决的是不同问题：

- Transition History：业务流程时间线；
- Audit：安全与运营追踪。

两者都需要。

---

# 10. BOUNDARY-08：并发与幂等不能后补

## 10.1 人工 Transition

必须使用现有 `Record.version` 乐观锁。

请求带：

```text
expectedVersion
```

服务端保证：

```text
currentVersion === expectedVersion
```

否则返回版本冲突，不允许最后写入覆盖。

## 10.2 Automation

未来异步 Action 必须具备：

- idempotency key；
- retry policy；
- duplicate suppression；
- execution record。

Agent/Worker 重试不得重复创建客户、任务、关系或通知。

---

# 11. BOUNDARY-09：旧对象必须向后兼容

没有 Workflow 的已发布 Object：

- CRUD 行为保持原样；
- 不要求补状态；
- 不显示 Workflow UI；
- 不产生 Transition History；
- 现有 API 不因 Workflow 引入而强制 breaking change。

Workflow 是：

```text
optional capability
```

不是所有 Object 的强制前置条件。

---

# 12. BOUNDARY-10：启用 Workflow 不静默改写历史 Record

对于 Workflow 发布前已经存在的 Record：

```text
workflowStateKey = null
```

V1 不允许在 Publish 时静默批量改成初始状态。

原因：

- 可能错误表达历史业务阶段；
- 大租户可能有大量 Record；
- Publish 不应该承担隐式数据迁移；
- 审计无法解释为什么历史数据突然全部变状态。

V1 行为：

- 新 Record：创建时进入 `initialStateKey`；
- 老 Record：显示“未进入流程”；
- 有权限用户通过显式“进入流程”动作进入 Initial State；
- 该动作写 Transition History + Audit。

未来如需要批量迁移，单独设计 Migration / Bulk Transition 能力。

---

# 13. BOUNDARY-11：Published State Key 是稳定业务标识

State / Transition 都使用稳定 key：

```text
new
following
quotation
won
lost
```

Label 可以改变：

```text
报价
正式报价
```

但 key 不是展示文案。

规则：

- key 一旦发布，不应被重新赋予另一种业务含义；
- 当前仍有 Record 使用的 State 不允许从新 Publication 中直接删除；
- Transition History 保存执行时 label snapshot，避免后续改名影响历史阅读；
- Transition 可以在未来 Publication 中撤销，但历史仍然可解释。

---

# 14. BOUNDARY-12：模板负责“配置复制”，Core 负责“能力”

平台模板未来可以携带：

```text
Objects
Fields
Views
Permissions
Dashboard
Workflow
Actions
Automation
```

但模板不能改变 Core 的安全规则。

V1 Workflow 可以先不支持“平台模板携带 Workflow”，只要：

- 租户管理员能配置 Workflow；
- 数据模型和 Publication Snapshot 预留未来序列化能力。

当 Workflow / Action 稳定后，再把它加入 Template Schema，避免重复返工模板升级协议。

---

# 15. BOUNDARY-13：Agent 不直接写数据库

V3 Agent 的硬边界：

```text
Agent
  ↓
Typed Tool
  ↓
Action / Workflow API
  ↓
Permission
  ↓
Approval（如需要）
  ↓
Execute
  ↓
Audit
```

禁止：

```text
Agent
  ↓
SQL / Prisma
  ↓
Record
```

Agent 可以：

- 搜索；
- 阅读；
- 提议；
- 调用有 schema 的 Tool；
- 请求审批。

Agent 不能：

- 绕过权限；
- 绕过 Workflow；
- 绕过 Approval；
- 产生无 Audit 的写操作。

---

# 16. BOUNDARY-14：Approval 是独立层，不混进 Transition Permission

未来 Approval 不是：

```text
Transition allowedRoles
```

的复杂化。

二者职责不同：

- Permission：这个人有没有资格请求动作；
- Approval：这个动作是否需要第二个人批准。

未来高风险动作：

- 大额折扣；
- 批量 Merge；
- 删除；
- 敏感通知；
- Agent 高风险 Action；

可以进入 Approval。

Workflow V1 不做 Approval，但数据模型不得把两者混成一个概念。

---

# 17. BOUNDARY-15：不要过早引入通用表达式 DSL

Workflow V1 条件只支持非常有限且可解释的约束：

```text
requiredFieldKeys
allowedRoles
currentState
```

不要现在实现：

```text
(amount > 100000 && region in (...) && ...)
```

也不要允许 JavaScript / SQL 表达式。

原因：

- 安全；
- 可维护性；
- 发布分析复杂度；
- 模板升级复杂度；
- Agent 可解释性。

真正需要复杂 Condition 时，在 Automation 阶段单独设计安全的 typed condition model。

---

# 18. BOUNDARY-16：同步 Action 继承 Actor 权限并与 Transition 共享同一事务

同步数据库 Action 不是新的权限入口，而是受控 Transition 在同一个事务内产生的副作用。

因此它必须同时满足权限与事务两方面约束。

## 18.1 权限：继承真实 Actor，不允许提权

Action 全部继承 Transition 发起人（真实 Actor）的：

- Tenant Context；
- Active Membership；
- Role；
- Effective Object Access；
- Member Override；
- Field Permission；
- Read / Update Scope；
- PostgreSQL RLS。

V1 不提供：

```text
runAsSystem
runAsAdmin
bypassPermission
elevatedPermission
```

任何形式的隐式提权。

例如员工对源记录有 Transition 权限，但对目标对象没有 `canCreate`：

```text
Transition validation ✅
CREATE_RECORD target ❌
```

结果：

```text
整个事务 rollback
```

`allowedRoles` 只表示“谁可以请求这个 Transition”，不代表请求者因此获得目标对象的权限。

## 18.2 事务：Transition 与它的全部 Action 同生共死

一次 Transition 必须在同一个 Tenant DB Transaction 内完成：

```text
Transition
  + Actions[]
  + Source Patch
  + State Change
  + Transition History
  + Audit
```

其中任何一步失败，以上全部 rollback。

```text
No partial success
```

不允许出现“状态已经迁移，但 Action 只执行了一部分”的中间态。

## 18.3 外部 I/O 不属于同步 Action

SMS / Email / Feishu / Webhook / 任意 HTTP 调用都不属于同步 DB Action 的范围。

它们不能参与上述事务，也就无法获得事务回滚的保护，因此必须交给未来独立的 Outbox / Worker 设计（见 Roadmap 的 Automation 阶段），而不是塞进同步 Action。

把外部 I/O 放进同步 Action 会直接破坏“无部分成功”的承诺，所以 V1 明确不做。

## 18.4 V1 不新增 Employee Owner Change 能力

`EMPLOYEE` + `ASSIGN_OWNER` 在 Publish 阶段就被阻止：

```text
EMPLOYEE + ASSIGN_OWNER
  ↓
Publish blocked
```

“员工领取 / 归我负责”如果要做，应作为独立 capability 单独设计，而不是借 Transition 顺带提权。

---

# 19. 变更本边界的流程

如果开发中发现必须改变本文中的长期决策：

1. Agent 停止扩大实现；
2. 在当前 Task 说明冲突；
3. 提出至少两个方案与影响；
4. 用户确认；
5. 先修改本 Architecture Boundary；
6. 再修改 Current Task Spec；
7. 最后继续代码。

不得“代码已经写了，所以文档跟着改”。

---

# 20. 当前必须遵守的结论

当前 Workflow V1 必须满足：

- 通用，不写死 CRM 对象名称；
- Workflow 随 Object Publication 发布；
- State 由 Workflow Runtime 控制；
- Runtime 走现有 Tenant / Permission / RLS；
- 使用 Record Version 做乐观锁；
- 有 Transition History；
- 有 Audit；
- Action 只作为 Transition 的同步 Action 执行，见 BOUNDARY-16；
- 不做 Trigger / Agent；
- 老 Record 不被 Publish 静默改写；
- 无 Workflow Object 完全兼容旧行为。
