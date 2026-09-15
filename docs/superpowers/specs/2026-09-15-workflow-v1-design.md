# Workflow V1 设计规格：可配置状态机与人工状态迁移

> 日期：2026-09-15  
> 文档类型：Current Task Design Spec  
> 状态：IMPLEMENTED — 验收见 `docs/audits/2026-09-15/workflow-v1-acceptance.md`  
> 上位路线：`docs/superpowers/plans/2026-09-15-crm-process-roadmap.md`  
> 长期边界：`docs/superpowers/specs/2026-09-15-workflow-platform-boundaries.md`  
> 当前事实：`HANDOFF.md`

# 1. Task 定义

任务名：

> **Workflow V1 — Configurable State Machine & Manual Transitions**

中文：

> **通用 Workflow V1：可配置状态机与人工状态迁移**

本任务只完成“业务状态如何受控推进”。

它不负责：

- 自动创建其他 Record；
- 自动 Relation；
- 自动 Follow-up；
- Trigger；
- Notification；
- AI。

---

# 2. 背景

当前 CRM 已经拥有：

- 动态 Object；
- 动态 Field；
- Record；
- Owner；
- Relation；
- Activity；
- Follow-up；
- Permission；
- Audit；
- Object Publication。

但目前业务阶段本质上仍只是普通数据。

用户可以通过 Record Update 改字段，却没有统一回答：

```text
当前处于什么业务状态？
下一步允许做什么？
谁允许做？
执行前必须满足什么？
谁把它从 A 推进到 B？
```

Workflow V1 用通用 State Machine 补齐这一层。

---

# 3. Product Goal

公司管理员可以给任意动态业务对象定义：

```text
States
+
Transitions
+
Transition Roles
+
Required Fields
```

发布后，员工在 Record Detail 中看到：

- 当前状态；
- 可以执行的下一步；
- Transition History。

员工通过按钮推进流程，而不是任意修改状态。

示例只是说明，不写死：

```text
新建
  ↓ 开始跟进
跟进中
  ↓ 提交方案
方案
  ↓ 提交报价
报价
  ↓ 标记赢单
赢单
```

---

# 4. Success Criteria

只有全部满足才算 Workflow V1 完成。

## Admin

- [ ] 任意动态 Object 可以开启 Workflow；
- [ ] 添加 / 排序 State；
- [ ] 指定 Initial State；
- [ ] 标记 Terminal State；
- [ ] 添加 Transition；
- [ ] 配置 from / to；
- [ ] 配置 allowedRoles；
- [ ] 配置 requiredFieldKeys；
- [ ] 保存仍是 Draft；
- [ ] Publish 后员工才看到变化；
- [ ] 非法 Workflow 阻止发布并给出明确错误。

## Runtime

- [ ] 新 Record 自动进入当前 Publication 的 Initial State；
- [ ] 老 Record 不被 Publish 静默改写；
- [ ] 老 Record 可以显式“进入流程”；
- [ ] Record Detail 显示 State；
- [ ] 只显示当前用户可执行的 Transition；
- [ ] Transition 校验当前状态；
- [ ] Transition 校验 canUpdate；
- [ ] Transition 校验 allowedRoles；
- [ ] Transition 校验 required fields；
- [ ] Transition 校验 expectedVersion；
- [ ] 成功后 Record.version + 1；
- [ ] History 可查看；
- [ ] Audit 可追踪；
- [ ] Terminal State 没有后续 Transition。

## Compatibility

- [ ] 无 Workflow Object 行为不变；
- [ ] 现有 Record CRUD 不出现 breaking change；
- [ ] Tenant A 无法读取/执行 Tenant B Workflow；
- [ ] Field Permission / RLS 仍然有效。

---

# 5. Non-goals

本任务**明确禁止**实现：

- Action Engine；
- `CREATE_RECORD`；
- `UPDATE_RECORD` Action；
- `CREATE_RELATION` Action；
- `CREATE_FOLLOW_UP` Action；
- `ASSIGN_OWNER` Action；
- 自动线索转换；
- Event / Trigger；
- BullMQ 业务队列；
- Scheduled Automation；
- 主动通知；
- Approval；
- Dedup / Merge；
- 表达式 DSL；
- Webhook；
- AI / Copilot / Agent；
- 平台模板携带 Workflow；
- Workflow State 的独立统计中心；
- List State Filter；
- 批量 Transition。

如果 Agent 在实现过程中认为这些“顺手就能做”，也必须留到后续 Task。

---

# 6. 核心领域模型

```text
ObjectDefinition
  └── ObjectWorkflowDefinition (0..1)
        ├── WorkflowStateDefinition (1..n)
        └── WorkflowTransitionDefinition (0..n)

ObjectPublication
  └── schema.workflow (immutable snapshot)

Record
  └── workflowStateKey?   # 物理列 records.status_key / Prisma statusKey

RecordTransitionHistory
```

---

# 7. Workflow Definition

每个 Object 最多一个 Workflow Draft。

建议模型：

```text
ObjectWorkflowDefinition
- id
- tenantId
- objectDefinitionId (unique)
- isEnabled
- initialStateKey
- createdBy
- updatedBy
- createdAt
- updatedAt
```

说明：

- `isEnabled = false` 表示 Draft 中暂不启用；
- Runtime 不读取 Draft；
- Workflow 是否真正生效只取决于 Active Object Publication Snapshot。

---

# 8. State Definition

建议模型：

```text
WorkflowStateDefinition
- id
- tenantId
- workflowDefinitionId
- key
- label
- description?
- sortOrder
- isTerminal
```

## 8.1 Key

建议：

```regex
^[a-z][a-z0-9-]{0,63}$
```

示例：

```text
new
following
proposal
quotation
won
lost
```

Key 是稳定业务标识，不是展示文案。

## 8.2 Terminal

`isTerminal = true` 的 State：

- 不允许配置 outgoing Transition；
- Runtime 不返回 Transition；
- UI 显示终态 Badge。

---

# 9. Transition Definition

建议模型：

```text
WorkflowTransitionDefinition
- id
- tenantId
- workflowDefinitionId
- key
- label
- fromStateKey
- toStateKey
- allowedRoles
- requiredFieldKeys
- sortOrder
```

## 9.1 Key

同样使用稳定 key。

例如：

```text
start-following
submit-proposal
submit-quotation
mark-won
mark-lost
```

Draft key 不能以：

```text
__
```

开头，该前缀保留给系统动作。

## 9.2 Allowed Roles

V1 只支持：

```text
TENANT_ADMIN
EMPLOYEE
```

并且**角色允许不等于真正有权限**。

执行 Transition 必须同时满足：

```text
role ∈ allowedRoles
AND
effectiveObjectAccess.canUpdate === true
```

Member Override 如果把 update 权限收回，则不能 Transition。

## 9.3 Required Fields

V1 只支持：

```text
requiredFieldKeys: string[]
```

执行前要求这些字段有非空有效值。

“非空”的判断复用现有 Record Field Validation 的字段类型语义，不另写第二套校验器。

Publish Analyzer 必须验证：

- Field 存在；
- Field 在当前 Object；
- Field 未被删除；
- 对允许执行的角色不是 `HIDDEN`。

V1 不实现任意表达式。

---

# 10. Record Workflow State

正式决策：复用已有列，不新增第二列。

```text
数据库：records.status_key
Prisma：Record.statusKey
领域 / API：workflowStateKey
```

2026-08-21 动态记录设计已把 `statusKey` 预留给受控状态机。V1 启用该列，普通 Record Create/Update 仍不能由客户端写入。原因见 Architecture Boundary。

普通 Record Create/Update DTO 不允许客户端直接写：

```text
workflowStateKey
```

只有 Workflow Runtime 可以修改。

---

# 11. 新 Record 初始化

如果当前 Active Object Publication 包含启用的 Workflow：

```text
newRecord.workflowStateKey = workflow.initialStateKey
```

如果没有 Workflow：

```text
workflowStateKey = null
```

初始化不算 Transition，因此不创建 Transition History。

Record Create 本身已有正常 Audit 即可。

---

# 12. 历史 Record 的处理

Workflow 第一次 Publish 时，不批量修改旧 Record。

旧 Record：

```text
workflowStateKey = null
```

Record Detail 显示：

> 未进入流程

如果当前用户拥有：

- Record update 权限；
- Active Membership；

则 Runtime 返回系统动作：

```text
key: __start__
label: 进入流程
to: initialStateKey
```

执行后：

- `workflowStateKey = initialStateKey`；
- `Record.version += 1`；
- 创建 Transition History；
- 创建 Audit。

这样历史数据不会被静默改写。

---

# 13. Transition History

建议新模型：

```text
RecordTransitionHistory
- id
- tenantId
- objectDefinitionId
- recordId
- objectPublicationId
- transitionKey
- transitionLabel
- fromStateKey?
- fromStateLabel?
- toStateKey
- toStateLabel
- actorMemberId
- recordVersionBefore
- recordVersionAfter
- createdAt
```

要求：

- append-only；
- runtime 不能 update/delete；
- 使用 RLS；
- 保留 label snapshot；
- 软删除 Record 后 History 仍然可审计。

`__start__` 也进入同一张表。

---

# 14. Publication Snapshot

Workflow 不建立独立 Publication。

Object Publish 时编译：

```json
{
  "workflow": {
    "initialStateKey": "new",
    "states": [
      {
        "key": "new",
        "label": "新建",
        "sortOrder": 10,
        "isTerminal": false
      },
      {
        "key": "won",
        "label": "赢单",
        "sortOrder": 90,
        "isTerminal": true
      }
    ],
    "transitions": [
      {
        "key": "mark-won",
        "label": "标记赢单",
        "fromStateKey": "quotation",
        "toStateKey": "won",
        "allowedRoles": ["TENANT_ADMIN", "EMPLOYEE"],
        "requiredFieldKeys": ["amount"]
      }
    ]
  }
}
```

Object 没有启用 Workflow 时：

- 可以没有 `workflow`；
- Runtime 必须兼容旧 Publication。

---

# 15. Publish Validation

Publish 之前至少检查：

## State

- enabled Workflow 至少 1 个 State；
- key 合法；
- key 唯一；
- label 非空；
- initialStateKey 存在；
- Terminal State 无 outgoing Transition。

## Transition

- key 合法；
- key 唯一；
- label 非空；
- from State 存在；
- to State 存在；
- `from != to`；
- V1 不允许同一 `(from, to)` 重复定义；
- allowedRoles 非空；
- allowedRoles 只包含支持角色；
- requiredFieldKeys 全部存在。

## Existing Record Safety

如果新 Draft 删除了 Active Publication 中某个 State，而仍存在 Active Record：

```text
workflowStateKey = deletedStateKey
```

则拒绝 Publish。

错误应指明：

- 哪个 State；
- 仍有多少 Record 使用它。

State key 一旦发布，不得复用为完全不同的业务含义。

---

# 16. Draft Save 语义

Admin Workflow Designer 保存时：

- 事务内替换当前 Workflow Draft；
- 校验基础结构；
- 增加 Object `draftRevision`；
- 不影响 Active Publication；
- 不影响员工 Runtime。

建议使用：

```text
expectedDraftRevision
```

避免两个管理员同时覆盖。

---

# 17. Runtime Available Transitions

Runtime 必须根据：

```text
Tenant
Active Membership
Record Visibility
Effective Object Access
Current Publication
Current State
Role
```

计算 Transition。

客户端不能提交“from state”并让服务端相信它。

服务端以数据库当前 `workflowStateKey` 为准。

返回示例：

```json
{
  "currentState": {
    "key": "quotation",
    "label": "报价",
    "isTerminal": false
  },
  "availableTransitions": [
    {
      "key": "mark-won",
      "label": "标记赢单",
      "toState": {
        "key": "won",
        "label": "赢单"
      },
      "requiredFieldKeys": ["amount"]
    }
  ],
  "recordVersion": 7
}
```

如果旧 Record 尚未进入流程：

```json
{
  "currentState": null,
  "availableTransitions": [
    {
      "key": "__start__",
      "label": "进入流程"
    }
  ]
}
```

---

# 18. Execute Transition

建议 Runtime Endpoint：

```text
POST
/api/v1/workspaces/:tenantCode/objects/:objectCode/records/:recordId/workflow/transitions/:transitionKey
```

Body：

```json
{
  "expectedVersion": 7
}
```

执行顺序：

```text
1. SessionAuthGuard
2. WorkspaceGuard
3. Resolve Active Publication
4. Load Record in Tenant Context
5. Check Record visibility
6. Check effective canUpdate
7. Check current state
8. Resolve transition
9. Check role
10. Check required fields
11. Compare expectedVersion
12. Transaction:
    - update workflowStateKey
    - version + 1
    - insert Transition History
    - write Audit
13. return new state/version
```

数据库状态改变与 Transition History 必须在同一个事务中完成。

Audit 如当前实现不能共享同一事务，也必须确保业务状态已经成功提交后才记录，并保持现有项目一致性。

---

# 19. Read Workflow Runtime

建议：

```text
GET
/api/v1/workspaces/:tenantCode/objects/:objectCode/records/:recordId/workflow
```

返回：

- currentState；
- availableTransitions；
- version。

History：

```text
GET
/api/v1/workspaces/:tenantCode/objects/:objectCode/records/:recordId/workflow/history
```

支持：

- createdAt DESC；
- 第一版简单分页即可。

---

# 20. Admin Workflow API

建议挂在 Object Definition 管理路径：

```text
GET
/api/v1/workspaces/:tenantCode/object-definitions/:objectId/workflow

PUT
/api/v1/workspaces/:tenantCode/object-definitions/:objectId/workflow
```

`PUT` 使用整份 Draft Replace，而不是 V1 就拆十几个 CRUD Endpoint。

示例：

```json
{
  "expectedDraftRevision": 12,
  "isEnabled": true,
  "initialStateKey": "new",
  "states": [],
  "transitions": []
}
```

原因：

- Workflow Definition 规模小；
- 前端 Designer 本来就是整体配置；
- 更容易原子校验；
- 更容易避免半保存关系错误。

---

# 21. Permission

## Admin Configuration

只有：

```text
TENANT_ADMIN
```

可以编辑 Workflow Draft。

## Runtime

执行 Transition 至少要求：

```text
ACTIVE membership
+
effectiveObjectAccess.canUpdate
+
allowedRoles
```

隐藏字段仍由现有 Field Permission 负责。

Transition 不能成为绕过 Record Update 权限的后门。

---

# 22. Audit Event

建议至少增加：

```text
workflow.draft_updated
record.transition_executed
record.workflow_started
```

Object Publish 继续复用现有 Object Publication Audit；不需要重复制造两个 Publish Audit。

Audit details 建议包含：

```json
{
  "objectCode": "...",
  "recordId": "...",
  "transitionKey": "...",
  "fromStateKey": "...",
  "toStateKey": "...",
  "recordVersionBefore": 7,
  "recordVersionAfter": 8
}
```

前端公司审计 / 平台审计如会展示这些 Action Code，需要补中文 label。

---

# 23. API Error Semantics

建议新增稳定错误码：

```text
WORKFLOW_INVALID_DRAFT
WORKFLOW_NOT_PUBLISHED
WORKFLOW_STATE_IN_USE
WORKFLOW_TRANSITION_NOT_AVAILABLE
WORKFLOW_TRANSITION_FORBIDDEN
WORKFLOW_REQUIRED_FIELDS_MISSING
```

版本冲突继续复用现有 Record Optimistic Lock 错误语义，不新增第二套冲突码。

Required Fields 错误必须带：

```text
fieldErrors
```

或可定位的 field keys，延续当前项目已经修好的错误体验。

---

# 24. Admin UI

在现有 Object Designer 增加：

> 流程

建议区域顺序：

```text
基本信息
字段
列表视图
权限
流程
发布
```

具体页面：

## Workflow 开关

```text
[ ] 启用流程
```

## States

表格列：

```text
状态名称
状态编码
初始状态
终态
顺序
操作
```

要求：

- 至少保留一个 initial；
- key 创建后提示“发布后不建议修改”；
- Terminal State 不能被选为 Transition from。

## Transitions

表格列：

```text
动作名称
动作编码
从
到
允许角色
必填字段
顺序
操作
```

## Save

沿用当前 Object Designer 的具名成功提示：

> 流程配置已保存

不要只清空 error banner。

---

# 25. Runtime UI

Record Detail 增加独立区域：

```text
流程状态
[ 报价 ]

可执行操作
[ 标记赢单 ] [ 标记输单 ]

流程历史
陈静 · 提交报价
方案 → 报价
2026-09-15 14:30
```

## Old Record

显示：

```text
流程状态
未进入流程

[ 进入流程 ]
```

## Missing Required Field

不要只显示：

> 操作失败

应该显示：

> “标记赢单”前需要补充：预计金额

并尽可能使用 Field Label，不直接裸露 key。

---

# 26. Record List Scope

Workflow V1 **不要求**完成：

- State Filter；
- State Sort；
- Funnel；
- Stage Aging；
- 批量 Transition。

如果实现成本很低，可以显示只读 State Badge，但不得因此扩大本 Task。

核心验收面是 Record Detail。

---

# 27. Template Scope

平台 Template Workflow 不属于 V1。

原因：

- Workflow Core 先稳定；
- Action Engine 尚未设计；
- 过早扩 Template Schema 会马上再次变更。

V1 数据与 Snapshot 设计必须保证后续 Template 可以序列化 Workflow。

---

# 28. Concurrency

执行 Transition 必须带：

```text
expectedVersion
```

典型冲突：

```text
A 打开 record v7
B 执行 transition → v8
A 再执行旧按钮
```

A 必须收到 Version Conflict，并刷新。

不能：

```text
last-write-wins
```

---

# 29. Tenant Isolation

必须有测试证明：

- Tenant A admin 不能配置 Tenant B object workflow；
- Tenant A member 不能读取 Tenant B record workflow；
- Tenant A member 不能执行 Tenant B transition；
- Transition History 被 RLS 隔离。

---

# 30. Security

不得：

- 接受 body 中 tenantId；
- 接受客户端自报 current state；
- 接受客户端自报 role；
- 接受客户端自报 canUpdate；
- 通过数据库超级用户执行正常业务；
- 在 Web 端单独做权限判断作为最终裁决。

所有最终裁决都在 API + DB Tenant Context。

---

# 31. Test Matrix

## Publication

- valid workflow publishes；
- missing initial state rejects；
- dangling state ref rejects；
- terminal outgoing rejects；
- missing required field ref rejects；
- duplicate key rejects；
- state in use cannot be removed。

## Runtime

- new record receives initial state；
- old record stays null；
- start workflow succeeds；
- valid transition succeeds；
- wrong current state rejects；
- forbidden role rejects；
- canUpdate false rejects；
- missing required field rejects；
- stale version rejects；
- transition history recorded；
- terminal has no outgoing transitions。

## Multi-tenant

- cross-tenant admin config rejected；
- cross-tenant read rejected；
- cross-tenant transition rejected；
- history isolated。

## Compatibility

- object without workflow still creates/updates/reads normally；
- old publication without workflow parses normally。

---

# 32. Browser Acceptance Script

至少手工走一遍：

## Admin

1. 登录 `nebula-demo` 公司管理员；
2. 新建一个测试 Object 或选择不会影响演示主链路的 Object；
3. 配置：
   - new；
   - following；
   - quotation；
   - won；
4. 配置 Transition；
5. 保存 Draft；
6. 确认员工 Runtime 没立即变化；
7. Publish；
8. 打开一条新 Record，确认 initial state。

## Employee

1. 登录普通员工；
2. 打开可更新 Record；
3. 执行合法 Transition；
4. 页面立即更新；
5. History 出现；
6. 审计出现。

## Validation

1. Required Field 留空；
2. 执行 Transition；
3. 收到明确字段错误；
4. 补字段；
5. 成功。

## Permission

1. 对该员工撤销 update；
2. Runtime 不再展示可执行 Transition；
3. 直接调用 API 也应 403。

## Version

使用两个浏览器标签页制造 stale version；

第二个旧页面执行必须冲突，而不是覆盖。

---

# 33. Definition of Done

Workflow V1 只有在以下全部完成后才能改为 `COMPLETED`：

- [ ] schema + migration；
- [ ] RLS / grants；
- [ ] Admin API；
- [ ] Publication compile / validation；
- [ ] Record initialization；
- [ ] Runtime available transitions；
- [ ] Execute transition；
- [ ] History；
- [ ] Audit；
- [ ] Admin Workflow Designer；
- [ ] Record Workflow UI；
- [ ] API focused tests；
- [ ] Web focused tests；
- [ ] database isolation test；
- [ ] contracts regenerated；
- [ ] typecheck；
- [ ] full test once at final verification；
- [ ] production build；
- [ ] real browser acceptance；
- [ ] acceptance document；
- [ ] HANDOFF update。

完成后不要自动开始 Action Engine。

先提交验收结果，再决定下一 Task。
