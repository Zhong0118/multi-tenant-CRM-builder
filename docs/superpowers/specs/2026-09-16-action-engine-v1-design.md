# Action Engine V1 设计规格：Transition Typed Actions

> 日期：2026-09-16  
> 文档类型：Current Task Design Spec  
> 状态：DESIGN APPROVED / COMPATIBILITY REVIEWED / READY FOR IMPLEMENTATION  
> 上位路线：`docs/superpowers/plans/2026-09-15-crm-process-roadmap.md`  
> 长期边界：`docs/superpowers/specs/2026-09-15-workflow-platform-boundaries.md`  
> 前置验收：`docs/audits/2026-09-15/workflow-v1-acceptance.md`  
> 当前事实来源：`HANDOFF.md`

## 1. Task 定义

任务名：

> **Action Engine V1 — Transactional Typed Actions for Workflow Transitions**

中文：

> **Action Engine V1：Workflow Transition 的强事务结构化业务动作**

Workflow V1 已经解决：

```text
Record → Current State → Allowed Transition → Next State
```

Action Engine V1 要解决：

```text
Transition → ordered Actions[] → Structured Business Side Effects
```

完成后，一个 Transition 不再只是改变状态，还可以在同一个受控事务中：

- 创建记录；
- 更新源记录；
- 建立记录关系；
- 创建待跟进事项；
- 将源记录负责人分配给当前执行人。

本 Task 的目标不是做“线索转客户”专用功能，而是建立通用的流程副作用执行层。

---

## 2. Product Goal

公司管理员可以在 Workflow Designer 中为任意 Transition 配置有序的 Typed Actions。

示例仅用于说明，不进入 Core：

```text
线索：待转化
    ↓
Transition：转化
    ↓
1. CREATE_RECORD 客户
2. CREATE_RECORD 联系人
3. CREATE_RECORD 商机
4. CREATE_RELATION 客户 ↔ 联系人
5. CREATE_RELATION 客户 ↔ 商机
6. CREATE_FOLLOW_UP 商机首次跟进
7. UPDATE_RECORD 源记录转化时间
    ↓
Source State → 已转化
```

CRM Core 只能知道：

```text
Object
Record
Workflow
Transition
Action
Relation
Follow-up
Owner
```

禁止：

```ts
convertLeadToCustomer()
createOpportunityForLead()
if (objectCode === 'lead') ...
if (transitionKey === 'convert') ...
```

---

## 3. 已批准的架构方案

采用：

> **方案 A：Transition 内嵌 Typed Actions + 独立通用 Action Engine**

依赖方向：

```text
Workflow --------┐
Automation ------┼──> Action Engine ──> Domain Commands ──> DB
Agent Tool ------┘
```

V1 中 Workflow 是第一个调用者，但 Action Engine 不得依赖 Workflow 业务语义。

Action 配置属于 Transition Draft；Action 执行能力属于独立 `actions` 模块。

---

## 4. 核心决策一：强事务 All-or-Nothing

一次人工 Transition 中：

```text
Transition validation
+
all Actions
+
source record patch
+
source state change
+
Transition History
+
Audit
```

必须处于**同一个 Tenant Database Transaction**。

例如：

```text
CREATE_RECORD customer    ✅
CREATE_RECORD contact     ✅
CREATE_RELATION           ✅
CREATE_FOLLOW_UP          ❌
```

最终必须：

```text
customer       rollback
contact        rollback
relation       rollback
follow-up      rollback
source patch   rollback
source state   rollback
history        rollback
audit          rollback
```

不允许 Partial Success。

V1 只允许数据库内可原子提交的同步 Action。SMS / Email / Feishu / Webhook / 外部 HTTP 不进入本阶段。

---

## 5. 核心决策二：Actor Permission，不隐式提权

所有 Action 继承 Transition 发起人的：

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
runAsAdmin
runAsSystem
bypassPermission
elevatedPermission
```

例如 Employee 可以执行源记录 Transition，但没有目标对象 `canCreate`：

```text
Transition validation ✅
CREATE_RECORD target ❌
```

结果：

```text
整个事务 rollback
```

`allowedRoles = [EMPLOYEE]` 只表示 Employee 可以请求 Transition，不等于自动获得所有目标对象权限。

---

## 6. 与长期 Architecture Boundary 的新增约束

正式实施前，应把以下原则合并回既有 Architecture Boundary：

> **同步数据库 Action 默认继承 Actor 权限，并与触发它的人工 Transition 共享同一个 Tenant Transaction；V1 不允许 run-as-system、隐式提权、外部 I/O 或部分成功。**

同时继续遵守既有长期边界：

- Core 不写死行业对象；
- Draft / Published Runtime 分离；
- Workflow 跟随 Object Publication；
- Action 必须结构化、可验证、可审计；
- Automation / Agent 未来复用 Action Engine；
- Agent 永不直接写 DB。

---

## 7. V1 Action Types

本阶段只实现：

```text
CREATE_RECORD
UPDATE_RECORD
CREATE_RELATION
CREATE_FOLLOW_UP
ASSIGN_OWNER
```

稳定类型：

```ts
type ActionType =
  | 'CREATE_RECORD'
  | 'UPDATE_RECORD'
  | 'CREATE_RELATION'
  | 'CREATE_FOLLOW_UP'
  | 'ASSIGN_OWNER';
```

每个 Action 必须有：

```text
key
type
```

Action Key 规则沿用 Workflow Key：

```regex
^[a-z][a-z0-9-]{0,63}$
```

限制：

```text
每个 Transition 最多 20 个 Actions
每个 CREATE_RECORD / UPDATE_RECORD 最多 50 个字段映射
```

---

## 8. Non-goals

明确不做：

```text
Trigger
Event Bus
Worker Business Queue
Delayed / Scheduled Action
Retry Engine
Partial Success
Notification
SMS / Email / Feishu
Webhook / External HTTP
Script / JavaScript / SQL Expression
Formula DSL
Approval
Dedup / Merge
Reusable Global Action Library
Cross-tenant Action
runAsSystem / runAsAdmin
Permission Elevation
Arbitrary Record Search
Arbitrary Other-record Update
Bulk Action
Template Workflow/Action Upgrade
AI / Copilot / Agent
```

---

## 9. Draft 数据模型

当前：

```text
WorkflowTransitionDefinition
- key
- label
- fromStateKey
- toStateKey
- allowedRoles
- requiredFieldKeys
- sortOrder
```

V2 增加：

```text
actions JSONB
```

建议 Prisma：

```text
actions Json @default("[]") @db.JsonB
```

预计 migration：

```text
0018_workflow_actions
```

实际编号以开发时 `main` 最新 migration 为准。

不为 5 类 Action 建 5 张定义表，也不新增 Action Execution 表。

但 `actions` 必须通过严格 discriminated-union validator，不能当作自由 JSON。

---

## 10. Publication Model

Action 不建立独立 Publication。

继续：

```text
Workflow Draft
   ↓
Object Publish
   ↓
ObjectPublication.configuration.workflow.transitions[].actions[]
```

Runtime 只执行当前 Active Object Publication 中冻结的 `actions[]`。

旧 Workflow Publication 没有 `actions` 时：

```text
actions = []
```

必须向后兼容，旧 Transition 继续只改变状态。

---

## 11. 模块边界

推荐依赖结构：

```text
apps/api/src/modules/actions/
  action.types.ts
  action.validator.ts
  action-value-resolver.ts
  action-engine.service.ts
  action-error.ts
```

Workflow 类型可以 import 通用 `PublishedAction`。

正确：

```text
Workflow → Action Engine
Automation → Action Engine
Agent Typed Tool → Action Engine
```

禁止：

```text
Action Engine → Workflow
```

Action Engine 接收：

```text
actions[]
executionContext
transaction-scoped commands
```

而不是读取 Workflow Draft。

---

## 12. Execution Context

概念上至少包含：

```text
executionId
tenantId
actorUserId
actorMemberId
actorRole
requestMeta
sourceObjectCode
sourceObjectId
sourcePublicationId
sourceRecordSnapshot
transitionKey
outputs
sourcePatch
clock
```

`sourceRecordSnapshot` 是进入 Transition 后、任何 Action 执行前读取并锁定的不可变快照。

---

## 13. Source Snapshot 语义

以下 Value Source 永远读取**进入 Transition 前**的 Source Record：

```text
SOURCE_FIELD
SOURCE_META
SOURCE_OWNER
```

即使前面的 Action 已执行：

```text
UPDATE_RECORD SOURCE_RECORD
```

后面的 `SOURCE_FIELD` 仍读取原始 Snapshot，而不是临时 patch。

唯一允许显式依赖前序 Action 的机制是：

```text
ACTION_OUTPUT
```

这样 Action 顺序的隐式副作用被限制在可审查范围内。

---

## 14. Source Patch Accumulator

V1 中：

```text
UPDATE_RECORD
ASSIGN_OWNER
Transition State Change
```

都可能修改 Source Record。

不能每个 Action 各自：

```text
version + 1
```

必须：

```text
Actions
  ↓
accumulate SourceRecordPatch
  ↓
最后一次 source UPDATE
  ↓
version + 1
```

例：

```text
Source v7
UPDATE_RECORD
ASSIGN_OWNER
state transition
```

最终：

```text
v7 → v8
```

Transition History：

```text
recordVersionBefore = 7
recordVersionAfter = 8
```

规则：

- 多个 UPDATE_RECORD 不得写同一 Source Field；
- 同一 Transition 最多一个真正改变 Owner 的 ASSIGN_OWNER；
- UPDATE_RECORD 不修改 Owner；
- Action 不修改 workflow state；
- Action 不修改 version / audit/system columns；
- 冲突在 Publish 时拒绝。

---

## 15. Typed Value Mapping

V1 Field Mapping 仅支持：

```text
LITERAL
SOURCE_FIELD
SOURCE_META
ACTOR
ACTION_OUTPUT
```

日期时间额外支持：

```text
NOW
NOW_PLUS_DAYS
LITERAL_DATETIME
```

不允许任意表达式。

### LITERAL

```json
{
  "source": "LITERAL",
  "value": "固定值"
}
```

按目标 Field Validator 校验。

### SOURCE_FIELD

```json
{
  "source": "SOURCE_FIELD",
  "fieldKey": "companyName"
}
```

读取 Source Snapshot 动态字段。

V1 默认要求 Source / Target Field Type **完全一致**。

例如：

```text
TEXT → TEXT ✅
PHONE → PHONE ✅
MONEY → MONEY ✅
DATE → DATE ✅
MEMBER → MEMBER ✅

TEXT → MONEY ❌
DATE → DATETIME ❌
NUMBER → TEXT ❌
```

Select Field 复制时，Publish Analyzer 应检查 Source option keys 能被 Target 接受。

### SOURCE_META

只开放：

```text
recordId
title
ownerMemberId
```

不允许任意数据库列。

### ACTOR

V1 只开放：

```text
memberId
```

### ACTION_OUTPUT

```json
{
  "source": "ACTION_OUTPUT",
  "actionKey": "create-customer",
  "property": "recordId"
}
```

只允许引用同一 Transition 的**前序 Action**，不允许 forward reference 或循环。

---

## 16. Action Output Contract

建议：

```ts
type ActionOutput =
  | {
      type: 'CREATE_RECORD';
      recordId: string;
      objectCode: string;
      recordNo: string;
    }
  | {
      type: 'UPDATE_RECORD';
      recordId: string;
    }
  | {
      type: 'CREATE_RELATION';
      relationId: string;
    }
  | {
      type: 'CREATE_FOLLOW_UP';
      followUpId: string;
      recordId: string;
    }
  | {
      type: 'ASSIGN_OWNER';
      recordId: string;
      ownerMemberId: string;
    };
```

Action Engine 内：

```text
outputs[actionKey] = actionOutput
```

V1 最重要的依赖是：

```text
CREATE_RECORD.recordId
```

供后续 Relation / Follow-up 引用。

---

## 17. Typed Record Reference

需要指向某条 Record 的 Action 使用：

```ts
type ActionRecordRef =
  | { source: 'SOURCE_RECORD' }
  | {
      source: 'ACTION_OUTPUT';
      actionKey: string;
      property: 'recordId';
    };
```

V1 不支持：

```text
SEARCH_RECORD
RECORD_BY_FILTER
RECORD_BY_EMAIL
RECORD_BY_PHONE
ARBITRARY_RECORD_ID_LITERAL
```

---

## 18. CREATE_RECORD

结构概念：

```ts
interface CreateRecordAction {
  key: string;
  type: 'CREATE_RECORD';
  targetObjectCode: string;
  values: Record<string, ActionValueSource>;
  owner?: ActionOwnerSource;
}
```

Owner V1 只支持：

```text
ACTOR
SOURCE_OWNER
```

无 owner 配置时复用当前普通 Record Create 的默认 owner 规则。

执行必须复用现有 Record Create 业务规则：

- Target Active Publication；
- Effective Access；
- canCreate；
- Field Permission；
- required/default；
- Field Validation；
- MEMBER active check；
- Owner policy；
- title calculation；
- Target Workflow initial state；
- Record No allocation；
- Audit；
- RLS。

禁止 Action Engine 直接 `tx.record.create()` 绕过这些规则。

---

## 19. UPDATE_RECORD

V1 只允许：

```text
target = SOURCE_RECORD
```

不允许更新：

```text
前序新建 Record
任意 Record ID
搜索结果
```

结构：

```ts
interface UpdateRecordAction {
  key: string;
  type: 'UPDATE_RECORD';
  target: 'SOURCE_RECORD';
  values: Record<string, ActionValueSource>;
}
```

UPDATE_RECORD 不立即写 DB，只校验并累积到 `SourceRecordPatch.values`。

必须复用：

- source canUpdate；
- updateScope；
- Field EDIT/READ_ONLY/HIDDEN；
- mutation normalization；
- title recalculation；
- field validation。

---

## 20. ASSIGN_OWNER

保留独立 Action Type，因为 Owner Assignment 是后续 Sales Execution / Automation 的核心业务概念。

V1 仅支持：

```text
SOURCE_RECORD → ACTOR
```

概念：

```ts
interface AssignOwnerAction {
  key: string;
  type: 'ASSIGN_OWNER';
  target: 'SOURCE_RECORD';
  owner: { source: 'ACTOR' };
}
```

### V1 权限决策

兼容性审查确认：当前普通 Record Update 对 `EMPLOYEE` 不提供真实 Owner Change 能力；`resolveUpdateOwner()` 会保留当前 owner，因此把同一逻辑直接用于 Action 会形成 silent no-op。

为了继续遵守已经批准的 **Actor Permission / No Elevation**：

- `TENANT_ADMIN`：可以执行 `ASSIGN_OWNER SOURCE_RECORD → ACTOR`，前提是现有 Source Update 权限与范围允许；
- `EMPLOYEE`：V1 **不授予新的 Owner Change 能力**；
- 如果某 Transition 的 `allowedRoles` 包含 `EMPLOYEE` 且含 `ASSIGN_OWNER`，Publish Analyzer 必须阻止发布并返回 `WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE`；
- Runtime 仍再次检查权限，不能只依赖 Publish；
- 不允许 silent no-op。

未来若产品需要“员工领取 / 归我负责”，应单独设计明确的 `canAssignOwner` / Claim capability，而不是让 Workflow 隐式提权。

不做：

```text
固定成员
指定角色
Round Robin
Territory
Team Queue
Assignment Rule
Employee Claim Capability
```

这些属于后续 V2.2 Sales Execution。

---

## 21. CREATE_RELATION

结构：

```ts
interface CreateRelationAction {
  key: string;
  type: 'CREATE_RELATION';
  left: ActionRecordRef;
  right: ActionRecordRef;
}
```

支持：

```text
SOURCE_RECORD ↔ created record
created record ↔ created record
```

必须复用现有 Record Relation 规则：

- same tenant；
- record exists；
- not deleted；
- current relation permission semantics；
- deterministic pair；
- duplicate relation 幂等/no-op 语义；
- Audit；
- RLS。

不能在 Action Engine 内复制第二份 relation policy。

---

## 22. CREATE_FOLLOW_UP

结构概念：

```ts
interface CreateFollowUpAction {
  key: string;
  type: 'CREATE_FOLLOW_UP';
  target: ActionRecordRef;
  title: ActionStringSource;
  dueAt: ActionDateTimeSource;
  assignee: ActionAssigneeSource;
}
```

### Target

```text
SOURCE_RECORD
或前序 CREATE_RECORD output
```

### Title

V1：

```text
LITERAL
SOURCE_FIELD
```

不做 `"跟进 {{ name }}"` 字符串模板。

### DueAt

V1：

```text
NOW
NOW_PLUS_DAYS
LITERAL_DATETIME
SOURCE_FIELD
```

建议：

```text
NOW_PLUS_DAYS = 0..3650
```

SOURCE_FIELD 只能引用 DATE / DATETIME。

### Assignee

V1：

```text
ACTOR
SOURCE_OWNER
```

规则：

- assignee 必须 Active；
- SOURCE_OWNER 为 null → validation fail；
- recipient 必须满足现有 Follow-up recipient/record access 规则；
- Employee 不能借 Action 指派给本来无权指派的人。

---

## 23. Runtime 执行顺序

固定语义：

```text
1. SessionAuthGuard
2. WorkspaceGuard
3. Resolve Source Active Publication
4. Validate Source Runtime Access
5. Start Tenant Transaction
6. Lock / re-check Actor membership
7. Lock Source Record
8. Check expectedVersion
9. Resolve Transition from published snapshot
10. Check current state / role / required fields
11. Generate workflowExecutionId
12. Build immutable Source Snapshot
13. Execute actions in array order
14. Validate accumulated Source Patch
15. Apply Source Patch + next workflow state in one source UPDATE
16. Source version + 1
17. Insert Transition History
18. Append Action Audits + Transition Audit
19. Commit
20. Return Runtime Workflow View + lightweight execution summary
```

任意步骤失败：

```text
throw → rollback
```

---

## 24. Transaction-aware Domain Command 边界

当前普通 Records / Relations / Follow-ups 各有自己的 Public Service 与 transaction boundary。

Action Engine 为实现强事务，**不能直接调用会重新打开 independent transaction 的 Public Service**。

正确方向：

```text
HTTP Service
    │
    ▼
Tenant Transaction
    │
    ▼
transaction-aware Domain Command
```

概念上：

```text
createRecordCommand(tx, ...)
validateAndPatchSourceRecord(...)
createRelationCommand(tx, ...)
createFollowUpCommand(tx, ...)
```

普通 HTTP API 与 Action Engine 最终共享这些 Command。

禁止两种反模式：

```text
ActionEngine → direct Prisma write
```

和：

```text
ActionEngine → PublicService.create() → nested independent transaction
```

具体文件拆分由 Implementation Plan 基于当前代码确定，但这个边界不可违反。

---

## 25. Target Object Publication 策略

Source Workflow Publication 不复制 Target Publication Snapshot。

只保存：

```text
targetObjectCode
targetFieldKeys
mapping
```

执行时解析：

```text
Target Object CURRENT Active Publication
```

原因：

否则 Target Object 发布新版后，Source Workflow 会长期按旧 Target Schema 创建数据。

因此使用**双重验证**。

### Publish-time

检查当前 Target：

- exists；
- ACTIVE；
- published；
- target fields exist；
- mapping type compatible；
- required mapping 足够；
- allowedRoles 的默认权限无明显冲突。

### Runtime

重新检查：

- Target 仍 ACTIVE；
- Active Publication 仍存在；
- Actor 当前 Effective Access / Member Override；
- Target Field 仍存在；
- validation / required/default；
- owner / member rules。

Target 后续 schema drift 导致不兼容时：

```text
ACTION_EXECUTION_FAILED
→ whole transition rollback
```

---

## 26. Publish Analyzer

至少验证：

- actions array shape；
- <=20；
- action key syntax；
- action key unique；
- supported action type；
- Action payload valid；
- SOURCE_FIELD exists；
- Target Object exists/published；
- Target Field exists；
- exact type compatibility；
- select options compatibility；
- Target required mapping；
- ACTION_OUTPUT points to previous action；
- output property valid；
- duplicate source patch field；
- duplicate owner mutation；
- Employee default permission conflicts。

例如 Source Transition：

```text
allowedRoles = [EMPLOYEE]
```

包含：

```text
CREATE_RECORD customer
```

但 Target 当前 Employee Default：

```text
canCreate = false
```

则 Source Object Publish 应失败，而不是让所有员工运行时才失败。

Member Override 是动态因素，仍在 Runtime 决定。

---

## 27. Required Field Analysis

CREATE_RECORD Publish Analyzer 计算：

```text
Target required editable fields
-
valid default fields
-
mapped fields
```

如果剩余必填字段：

```text
Publish fail
```

Runtime 仍重新验证，以应对 Target 后续 Publication 变化。

---

## 28. Action Ordering

数组顺序就是执行顺序。

允许：

```text
1 create-customer
2 create-contact
3 link-customer-contact
```

禁止：

```text
1 relation → 引用 3 create-customer
```

V1 不做 DAG 自动排序。

---

## 29. Idempotency V1

同步人工 Transition 不新增：

```text
idempotency_keys
workflow_action_executions
```

V1 重复提交保护依赖：

```text
expectedVersion
+
source row lock
+
state validation
+
single transaction
```

第一次：

```text
v7 → v8
A → B
```

重试：

```text
expectedVersion = 7
```

必须失败 `RECORD_VERSION_CONFLICT`，不能重复创建 downstream records。

异步 Worker/Retry 以后必须设计真正 execution idempotency。

---

## 30. workflowExecutionId 与 Audit

每次成功 Action-bearing Transition 生成：

```text
workflowExecutionId
```

同一事务内的领域 Audit 保留原 action，例如：

```text
record.created
record.updated
record.relation_added
follow_up.created
record.owner_assigned
record.transition_executed
```

Action-originated Audit metadata 至少包含：

```text
workflowExecutionId
transitionKey
actionKey
actionType
```

Transition Audit 包含：

```text
workflowExecutionId
transitionKey
fromStateKey
toStateKey
recordVersionBefore
recordVersionAfter
actionCount
```

失败事务不留下成功 Audit。

V1 不新增 Action History / Execution 表。

---

## 31. Runtime Response 与 Employee Confirmation

现有 Transition Execute 保持返回 Workflow Runtime View，可增加轻量 `executionSummary`：

```text
executionId
transitionKey
actions[] safe summary
```

Runtime GET 可为 available transition 返回**静态 Effect Summary**：

```text
创建 1 条客户
创建 1 条联系人
建立 1 条关联
创建 1 个待跟进
更新当前记录
```

员工点击有 Actions 的 Transition：

```text
执行“转化”后将：
• 创建 1 条客户记录
• 创建 1 条联系人记录
• 建立 1 条记录关联
• 创建 1 个待跟进事项

所有操作将同时成功或全部取消。

[取消] [确认执行]
```

这不是完整 simulation；最终权限仍由 Execute API 决定。

Effect Summary 不得泄露 hidden field keys、mapping 内部细节或权限结构。

---

## 32. Runtime Action Error

不能返回模糊 500。

目标体验：

> 无法完成“转化”：步骤「创建客户」失败，手机号格式不正确。所有变更均未保存。

为了兼容当前 ApiException 结构，建议：

```text
code = ACTION_EXECUTION_FAILED
```

`fieldErrors` 使用：

```text
actions.<actionKey>.<fieldKey>
```

例如：

```json
{
  "code": "ACTION_EXECUTION_FAILED",
  "message": "无法完成“转化”：步骤“创建客户”失败。所有变更均未保存。",
  "fieldErrors": {
    "actions.create-customer.phone": [
      "手机号格式不正确。"
    ]
  }
}
```

不为了本 Task 把 ApiException 扩展成任意 nested details。

---

## 33. Admin Workflow Designer

Transition 编辑区增加：

```text
执行动作
```

采用有序步骤列表：

```text
Step 1
Step 2
Step 3

+ 新增动作
↑ 上移
↓ 下移
删除
```

V1 不做 Node Canvas / Visual Programming。

### CREATE_RECORD

```text
动作类型：创建记录
目标业务表：[客户]

目标字段      值来源          来源值
客户名称      当前记录字段    公司名称
手机          当前记录字段    手机
负责人        当前记录负责人
```

### CREATE_RELATION

左右 Record Reference 只能选择：

- 当前记录；
- 前序 CREATE_RECORD。

### CREATE_FOLLOW_UP

配置：

- target；
- title source；
- dueAt；
- assignee。

### UPDATE_RECORD

目标固定当前记录，只显示可配置业务字段。

### ASSIGN_OWNER

UI 固定说明：

> 将当前记录分配给执行人。

不显示成员选择器。

---

## 34. Draft Save 与 Publish Error

Draft Save 做结构级校验：

- key；
- type；
- local source field；
- output order；
- source patch conflicts。

最终 Publish 做完整跨对象校验。

建议错误码：

```text
WORKFLOW_ACTION_INVALID
WORKFLOW_ACTION_LIMIT_EXCEEDED
WORKFLOW_ACTION_DUPLICATE_KEY
WORKFLOW_ACTION_FORWARD_REFERENCE
WORKFLOW_ACTION_OUTPUT_INVALID
WORKFLOW_ACTION_TARGET_OBJECT_INVALID
WORKFLOW_ACTION_TARGET_FIELD_INVALID
WORKFLOW_ACTION_FIELD_TYPE_MISMATCH
WORKFLOW_ACTION_REQUIRED_MAPPING_MISSING
WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE
WORKFLOW_ACTION_SOURCE_PATCH_CONFLICT
ACTION_EXECUTION_FAILED
```

可根据现有错误码风格适当合并，但 UI 必须能定位 Transition / Action / Field。

---

## 35. Backward Compatibility

必须保证：

- old publication without actions parses；
- old transition continues state-only；
- no-workflow object unaffected；
- ordinary Record CRUD unchanged；
- existing relation/follow-up API behavior unchanged；
- generated contracts backward compatible where possible。

V1 不新增“任意执行 Action”的公开 HTTP API。

Action 只能由：

```text
POST .../workflow/transitions/:transitionKey
```

触发。

---

## 36. Concurrency

至少锁：

```text
Actor membership
Source Record
```

Source Record 使用当前 `expectedVersion` 乐观锁。

两个请求：

```text
same record
same expectedVersion
same transition
```

只能：

```text
one success
one RECORD_VERSION_CONFLICT
```

并且只能产生一组 downstream records。

---

## 37. RLS

如果只给 Workflow Transition Draft 增加 `actions JSONB`：

- 沿用现有 Workflow Definition RLS；
- 不新增 Action Definition 表；
- 不新增 Action Execution 表。

Action 实际写入 Records / Relations / Follow-ups 继续走现有 Tenant Transaction + RLS。

不得使用 BYPASSRLS 作为 Action Engine 实现方案。

---

## 38. Performance Boundary

V1：

```text
最多 20 Actions
全部串行
全部数据库内
无外部 I/O
```

不并行执行 Action，不用 `Promise.all(actions)`。

Action 顺序具有业务语义。

---

## 39. Testing Strategy

核心不是 5 个 happy path，而是：

```text
Atomicity
Permission
Mapping
Publication Validation
Concurrency
Backward Compatibility
```

### Validator

覆盖：

- unsupported type；
- duplicate key；
- >20；
- forward output；
- invalid output property；
- duplicate source patch；
- invalid ref；
- invalid date source。

### Publication

覆盖：

- valid CREATE_RECORD；
- target missing/unpublished；
- required mapping missing；
- field missing；
- exact type mismatch；
- select incompatible；
- employee default permission incompatible；
- old workflow without actions。

### Runtime happy path

至少一条 Transition 包含：

```text
CREATE_RECORD
CREATE_RECORD
CREATE_RELATION
CREATE_FOLLOW_UP
UPDATE_RECORD
ASSIGN_OWNER
```

验证：

- all effects exist；
- source state changed；
- source version only +1；
- one Transition History；
- Audits share executionId。

### Rollback

故意让中后段 Action 失败，确认：

- previous created records rollback；
- relation/follow-up rollback；
- source patch/state rollback；
- version unchanged；
- history absent；
- success audits absent。

### Permission

覆盖：

- source transition allowed but target create denied；
- member override removes target create；
- source read-only/hidden field update；
- relation target invisible；
- follow-up assignee unauthorized；
- inactive membership；
- cross-tenant isolation。

### Concurrency

两个相同 expectedVersion 并发 Transition：

```text
one success
one conflict
one set of downstream effects
```

---

## 40. Browser Acceptance

使用独立通用对象，不污染演示主对象。

建议：

```text
process-source
process-target-a
process-target-b
```

Workflow：

```text
draft → process → done
```

Actions：

```text
1 CREATE_RECORD target-a
2 CREATE_RECORD target-b
3 CREATE_RELATION source ↔ target-a
4 CREATE_RELATION target-a ↔ target-b
5 CREATE_FOLLOW_UP target-a
6 UPDATE_RECORD source
7 ASSIGN_OWNER source
```

### Success

确认：

- state done；
- source version +1；
- target records 创建；
- relations 存在；
- follow-up 存在；
- owner 正确；
- source field 更新；
- history 正确；
- audit executionId 可关联。

### Rollback

通过安全方式制造 runtime permission failure，例如 Publish 后对测试员工设置 target `canCreate=false`。

确认：

```text
所有 downstream effect 无残留
Source state 不变
Source version 不变
```

### Employee

先允许 target create → 成功；再 Member Override 移除权限 → 明确失败且无 partial data。

---

## 41. Contracts 与 Migration

DTO 稳定后：

```bash
pnpm contracts:generate
pnpm contracts:check
```

不得手改 generated contracts。

预计 migration 只需要：

```text
workflow_transition_definitions.actions jsonb NOT NULL DEFAULT '[]'
```

如果实现者认为必须新增更多持久化表，必须先说明真实原因，不得因为“Action Engine”名称复杂就自行扩表。

---

## 42. Acceptance Document

完成后新增：

```text
docs/audits/YYYY-MM-DD/action-engine-v1-acceptance.md
```

只记录实际事实：

- branch / commits；
- migration；
- implemented types；
- actual transaction architecture；
- tests；
- rollback proof；
- permission proof；
- browser walkthrough；
- deviations；
- known gaps。

不要提前创建“成功验收”。

---

## 43. Stop Conditions

出现以下任一情况必须停下来汇报：

1. 强事务要求迫使绕过 RLS；
2. 只能依赖 nested independent transactions 才能复用业务逻辑；
3. CREATE_RECORD 无法复用现有 field validation；
4. Target schema 必须复制进 Source Publication 才能工作；
5. 基础用例必须隐式管理员权限；
6. 必须先做 Event/Worker；
7. 必须引入任意 DSL；
8. Follow-up / Relation 权限与 Actor Permission 出现不可调和冲突；
9. 必须修改 HANDOFF 保护文件；
10. 必须 reset/rebase/force push；
11. 必须部署生产环境。

汇报：

```text
问题
为什么现设计无法继续
方案 A
方案 B
影响
推荐方案
```

用户确认后再继续。

---

## 44. Definition of Done

全部满足才算 Action Engine V1 `COMPLETED`：

- [ ] Transition Draft 支持 typed `actions[]`；
- [ ] strict Draft Validator；
- [ ] Actions 冻结进 Object Publication；
- [ ] old Publication backward compatible；
- [ ] 独立 Action domain module；
- [ ] transaction-aware Record command；
- [ ] transaction-aware Relation command；
- [ ] transaction-aware Follow-up command；
- [ ] CREATE_RECORD；
- [ ] UPDATE_RECORD source only；
- [ ] CREATE_RELATION；
- [ ] CREATE_FOLLOW_UP；
- [ ] ASSIGN_OWNER source → actor；
- [ ] Typed Value Mapping；
- [ ] 前序 ACTION_OUTPUT；
- [ ] immutable source snapshot；
- [ ] source patch accumulator；
- [ ] source version only +1；
- [ ] Actor Permission；
- [ ] Member Override；
- [ ] All-or-Nothing rollback；
- [ ] workflowExecutionId Audit correlation；
- [ ] clear Action error UX；
- [ ] Admin Action Designer；
- [ ] Employee static confirmation；
- [ ] focused tests；
- [ ] rollback integration proof；
- [ ] permission proof；
- [ ] concurrency proof；
- [ ] contracts no drift；
- [ ] typecheck；
- [ ] final full test；
- [ ] production build；
- [ ] real browser acceptance；
- [ ] acceptance document；
- [ ] HANDOFF update；
- [ ] Roadmap Action Engine → COMPLETED。

---

## 45. 产品定义变化

V2 前：

> Configurable CRM Builder + State Machine

V2 后：

> **Configurable Process CRM Builder**

因为管理员不仅能定义“状态如何推进”，还能够定义“流程推进时产生哪些结构化业务结果”。

这就是 Action Engine V1 的完成边界。

---

## 46. 2026-09-16 兼容性审查后的正式修订

本节覆盖本 Spec 中与当前 `main` 真实实现存在歧义的地方；Implementation Plan 必须按本节解释。

### 46.1 Compatibility Result

结论：

> **PASS WITH REQUIRED REFACTOR**

不是架构性 BLOCKED。

现有代码可以实现方案 A，但在写 Action Engine 前必须先完成若干 transaction-aware 重构。

### 46.2 Transaction Join 事实

当前 `DatabaseContextRunner.withTenant()` 每次都会新开一个 Prisma transaction，没有“加入已有 transaction”的入口。

因此：

```text
Action Engine
  → RecordsService.create()
  → RecordRelationsService.add()
  → FollowUpsService.create()
```

不能满足 All-or-Nothing，因为这些 Public Service / Repository 会各自建立 transaction boundary。

正式实现采用：

```text
一个外层 Tenant Transaction
  ↓
transaction-aware domain commands
```

普通 HTTP 入口与 Action Engine 共享 command，不共享 Public Service transaction boundary。

### 46.3 Target Object Resolver 事实

当前 `PublishedObjectService.resolveRuntimeSchema()` 在返回 schema 前强制要求：

```text
canRead
readScope != NONE
title field not HIDDEN
```

这适合“读取运行时对象”，但不适合 Action 的：

```text
CREATE_RECORD target
```

因为 Actor 可能合法拥有：

```text
canCreate = true
canRead = false
```

V1 要增加 transaction-aware **action access resolver**：

- 在当前 transaction 内读取 Target Active Publication；
- 计算 Effective Access / Member Override；
- 不提前施加 `canRead` gate；
- 由具体 Domain Command 检查 `canCreate` / `canUpdate` / field permission；
- Resolver 本身不得向客户端泄露 Target record 数据。

不能为了绕过 `resolveRuntimeSchema()` 而绕过权限。

### 46.4 Record Title 审查修正

兼容性审查中“`title VARCHAR(200)` vs `TEXTAREA 10000`”这一表述不准确。

当前事实：

```text
records.title = VARCHAR(300)
Record title field allowed types:
TEXT / PHONE / EMAIL / SINGLE_SELECT
TEXTAREA 不能作为 title field
```

因此不存在 “TEXTAREA 10000 直接写 records.title” 的路径。

但存在一个真实边界：

```text
EMAIL validation max = 320
records.title max = 300
```

如果 EMAIL 是 title field，301–320 字符可能通过 field validator 后在 DB 层失败。

V2 在抽 Record Domain Command 时顺手硬化：

```text
deriveTitle result > 300
  → FIELD_INVALID(titleFieldKey)
```

不截断，不让 DB constraint 变成 500。

这是现有 Record correctness 修复，不改变 Action Mapping 语义。

### 46.5 ASSIGN_OWNER 修订

见第 20 节。

V1 不新增 Employee Owner Change capability。

`EMPLOYEE + ASSIGN_OWNER` 在 Publish 时判为权限不兼容。

### 46.6 Migration

在当前 `main` 仍以 `0017_workflow_state_machine` 为最新 migration 的前提下，预计只需要：

```text
0018_workflow_actions
```

内容：

```sql
ALTER TABLE workflow_transition_definitions
ADD COLUMN actions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE workflow_transition_definitions
ADD CONSTRAINT workflow_transition_definitions_actions_array
CHECK (jsonb_typeof(actions) = 'array');
```

因为修改的是已经具备 tenant RLS 与 `crm_app` CRUD GRANT 的现有表：

- 不新增表；
- 不新增 RLS Policy；
- 不新增 GRANT；
- 不新增 ActionExecution 表。

如果开发开始时 migration 编号已变化，必须顺延编号，不能覆盖已有 migration。

### 46.7 Schema / DTO / Parser 同步要求

增加 `actions` 不能只改数据库。

必须同步：

```text
packages/database/prisma/schema.prisma
packages/database/schema-contract.test.mjs
apps/api/src/modules/workflows/workflow.types.ts
apps/api/src/modules/workflows/dto/workflow.dto.ts
apps/api/src/modules/workflows/workflow.repository.ts
apps/api/src/modules/objects/objects.repository.ts
apps/api/src/modules/objects/object-publication.policy.ts
apps/api/src/modules/objects/object-schema.ts
apps/api/src/modules/objects/published-object.service.ts
packages/contracts/openapi.json
packages/contracts/src/generated/openapi.ts
apps/web/src/features/objects/workflow-types.ts
```

尤其 `parseWorkflow()` 使用严格 key 白名单；若忘记加入 `actions`，新的合法 publication 会被 Runtime 当成损坏快照并返回 500。

### 46.8 Implementation Plan Gate

以上修订已经把审查中发现的两个产品语义按保守、安全方向定案：

1. Employee 不新增 Owner Change 权限；
2. Record title 不截断，超过物理 300 字符时在 Domain Validation 层明确拒绝。

因此可以进入 Implementation Plan，不再要求额外产品拍板。

