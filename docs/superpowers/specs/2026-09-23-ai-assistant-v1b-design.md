# AI Assistant V1B — Confirmed Edit Design

> 日期：2026-09-23
> 文档类型：Task Design Spec
> 状态：DESIGN APPROVED — COMPLETED — MERGED AND VERIFIED；PR #22 MERGED，merge `fd0410fe4548704ee14e1027ac4d09a243195a70`；post-merge main CI run `36979987780` 六门 SUCCESS。COMPLETED 指已批准范围的产品实现、安全边界、测试门禁与合并完成；Real Provider NOT VERIFIED — DEFERRED BY USER；未部署生产。
> Roadmap：AI Assistant V1B（COMPLETED — MERGED AND VERIFIED；Production Essentials 仍 PLANNED）
> 设计基线：`origin/main` @ `cc419ff51df980055229fd43d4a17e8ceafe467e`
> 上位方向：`docs/superpowers/specs/2026-09-16-ai-assistant-v1-design.md`
> Stage Brief：`docs/superpowers/briefs/2026-09-16-ai-assistant-v1b-stage-brief.md`
> 前置事实：AI Assistant V1A 已完成，PR A/B/C 均已合并并通过浏览器验收；V1B 不自动启动。

---

## 0. Executive Summary

AI Assistant V1B 是现有多租户 CRM 的**人工确认后写入**阶段。用户可以用自然语言表达修改意图，AI 只能生成结构化 Proposal；服务端完成预校验并持久化后，用户在 AI 聊天页查看明确的影响预览。只有用户明确确认，服务端才重新解析当前 ActorContext、重新校验权限与版本，并通过 transaction-aware Typed Domain Command 写入业务数据和 Domain Audit。

固定不变量：

> **没有明确确认，就没有业务写入；Proposal 通过预校验不等于获得执行授权；确认时服务端必须重新授权。**

本阶段只做 AI V1B 闭环及其必要的 AI 聊天页优化，不扩大为全 CRM 页面体验改造，不进入 Production Essentials。

---

## 1. Scope and Delivery Boundary

### 1.1 Included

首批三种写操作全部纳入：

1. `UPDATE_RECORD`：更新一条业务记录的一个或多个可编辑字段；
2. `CREATE_FOLLOW_UP`：为一条当前可见且允许操作的业务记录创建跟进，首版只支持标题与到期时间，负责人固定为当前执行人；
3. `ADD_ACTIVITY_NOTE`：向一条当前可见且允许追加活动的业务记录追加 `NOTE` 活动。

交互粒度固定为：

```text
一张 Proposal → 一个目标 → 一种操作 → 一次确认
```

三种操作都必须支持 Proposal、Preview、Confirm、Reject、状态恢复、失败反馈和 Domain Audit 关联。

### 1.2 Explicit non-goals

本阶段不做：

- 多记录批量写入或混合操作；
- `CREATE_RECORD`；
- `ASSIGN_OWNER` 或任意转派；
- `EXECUTE_TRANSITION` 或自动 Workflow；
- delete / archive；
- 权限、租户、成员管理；
- raw SQL、任意数据库写入、`runAsAdmin`、`runAsSystem`；
- Agent loop、后台自主执行、自动跟进；
- 长期 AI Memory、共享会话、文件上传、RAG；
- Production Essentials、真实短信、对象存储和生产部署；
- 已通过视觉验收的 AI V2 整体视觉系统重设计。

### 1.3 Roadmap rule

历史批准门槛已满足：用户批准正式实施计划并启动开发后，V1B 已 Promote 为 `ACTIVE`，实现已提交至尚未合并的 PR #22。本 Spec 的设计确认本身不构成实现批准；本段保留该先后关系。最终审查和真实 Provider 验收仍待完成，不能标记 `COMPLETED`；V1B 完成后也不自动 Promote Production Essentials。

---

## 2. Domain Model

### 2.1 Proposal is not a Domain Command

Proposal 是 AI 对用户意图的结构化建议，不是授权，也不是业务命令本身。模型输出必须先通过严格 schema 和服务端预校验，才能生成可确认 Proposal。前端确认请求不能重新提交任意 values，只能提交 `proposalId` 与幂等键。

业务写入必须通过独立的 transaction-aware Typed Domain Command。AI module 不直接 Prisma 查询或写入业务 `Record`、`RecordActivity`、`RecordFollowUp`，也不得调用会自行开启事务的 Public Service 伪造外层原子性。

HTTP 写入和 AI Confirm 必须共享同一套领域命令规则；若现有写路径没有合适的 transaction-aware seam，实施前先补该 seam 和行为性测试，不降低安全边界。

### 2.2 Actor and authorization

ActorContext 只能由服务端从当前 Session 和 Workspace 解析：

```ts
interface ActorContext {
  tenantId: string;
  memberId: string;
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
  userId: string;
}
```

任何 AI Tool、Proposal schema、Confirm DTO 都禁止接受或覆盖：

```text
tenantId, tenantCode override, memberId, userId, role,
readScope, includeHidden, bypassPermission, runAsAdmin, runAsSystem
```

安全链保持为：

```text
Session
→ WorkspaceGuard
→ ActorContext
→ Published Object Schema
→ Effective Access
→ Scope
→ Field Permission
→ RLS
→ Typed Domain Command
→ Domain Audit
```

确认时必须重新解析并检查整条链，不能复用 Proposal 创建时的权限结果。

---

## 3. Proposal Lifecycle and Persistence

### 3.1 State machine

Proposal / `AiOperation` 至少支持以下状态：

```text
PROPOSED
  ├─ REJECTED
  ├─ EXPIRED
  ├─ CONFLICTED
  ├─ FAILED
  └─ EXECUTED
```

语义：

- `PROPOSED`：结构化 Proposal 已生成并通过预校验，等待确认；
- `REJECTED`：用户明确拒绝，无业务副作用；
- `EXPIRED`：超过短有效期，不能执行；
- `CONFLICTED`：确认时记录版本、发布版本或授权条件已改变，未写入；
- `FAILED`：领域命令或业务校验失败，未产生业务半成功；
- `EXECUTED`：业务命令、Domain Audit 和操作追踪均成功。

终态不可再次执行。已 `EXECUTED` 的重复 Confirm 应返回同一执行结果或明确的已执行结果，不能重复写入。

### 3.2 AiOperation / Proposal record

建议新增 RLS 保护的 `AiOperation` 持久化模型，至少包含：

```text
id
tenantId
conversationId
requestedByMemberId
confirmedByMemberId?
status
operationType
requestText
proposalJson
displayChangesJson
targetRefJson
expectedVersion?
failureCode?
auditId?
expiresAt
createdAt
confirmedAt?
executedAt?
updatedAt
```

约束：

- `tenantId + id` 唯一；表启用并强制 RLS；runtime role 不得绕过 RLS；
- 只允许当前租户、当前成员访问自己的操作历史；
- `proposalJson` 必须是服务端 schema 校验后的结构化参数；
- `displayChangesJson` 只存预校验时可展示的差异；HIDDEN 字段不得进入。后续读取旧 Proposal 或会话历史时，若当前字段已 HIDDEN、对象不可读、Record 已删除或 `OWN` 可见性丧失，必须按当前权限遮蔽对应值（或全部目标摘要）；旧目标标题源字段变 HIDDEN 后也须遮蔽旧摘要。已执行跟进若转交后对当前成员不可见，不再展示旧 `followUpId` 跳转；状态和安全的审计关联仍保留；
- 目标引用使用受控的 object/record/follow-up 引用，不保存完整 Record before/after JSON；
- Proposal 有效期固定 15 分钟，自持久化创建时计算；到期状态可在读取/确认时按时钟惰性推进；
- 不提供以删除操作记录来绕过审计的用户路径；retention 属于后续运维设计。

---

## 4. Typed Domain Commands

### 4.1 `UPDATE_RECORD`

Proposal 只允许修改当前 Actor 对目标对象具有 `EDIT` 权限的字段：

```text
target:
  objectCode
  recordId
  expectedVersion

changes:
  [{ fieldKey, label, before, after }]
```

确认时重新读取当前 Published Object Schema 和 Effective Access：

- HIDDEN 字段不进入 Proposal、Preview 或错误；
- READ_ONLY 字段在生成和确认阶段均拒绝；
- `OWN` / `ALL` / `NONE` 重新判定；
- 记录删除、对象发布变化或版本变化不得覆盖新状态；
- 首版不允许通过此命令修改 owner/member override。

### 4.2 `CREATE_FOLLOW_UP`

Proposal 表达：

```text
target:
  objectCode
  recordId

input:
  title
  dueAt
  assignee: CURRENT_ACTOR
```

确认时重新检查目标 Record 可见性、租户归属和现有跟进业务规则。首版负责人固定为执行人；用户要求“给某成员安排跟进”时不能猜测或静默转派，应明确提示当前版本只支持“安排给我”。

### 4.3 `ADD_ACTIVITY_NOTE`

Proposal 表达：

```text
target:
  objectCode
  recordId

input:
  activityType: NOTE
  content
```

活动类型固定为 `NOTE`，不由模型自由选择 `CALL` / `MESSAGE` / `MEETING`。确认时重新检查记录可见性、追加活动权限、内容长度和输入规范。记录活动保持追加不可覆盖历史。

---

## 5. API and Streaming Contract

### 5.1 Proposal endpoints

建议新增 AI 专用边界：

```text
GET  /workspaces/:tenantCode/ai/proposals/:proposalId
POST /workspaces/:tenantCode/ai/proposals/:proposalId/reject
POST /workspaces/:tenantCode/ai/proposals/:proposalId/confirm
```

现有聊天 Turn 入口继续承载用户请求和流式回答，但 AI 只能通过 CRM 自有事件发布 Proposal 结果。Proposal 路由中的 `tenantCode` 只参与 Workspace 解析，不能覆盖服务端 ActorContext。

### 5.2 Confirm contract

Confirm 请求只接受：

```json
{
  "proposalId": "...",
  "idempotencyKey": "..."
}
```

服务端顺序：

```text
1. 解析当前 Session + Workspace ActorContext
2. 在租户事务内锁定 Proposal / AiOperation
3. 确认当前状态为 PROPOSED 且未过期
4. 检查 conversation 所有权与确认者
5. 重新解析对象、记录、权限、scope、字段访问和版本
6. 执行对应 transaction-aware Typed Domain Command
7. 写 Domain Audit，并关联 aiOperationId
8. 标记 AiOperation / Proposal 为 EXECUTED
9. 提交事务
```

若业务命令失败，执行事务回滚，业务数据与成功审计都不落库；错误终态在回滚后由单独的状态事务按 `PROPOSED` 条件更新（若有竞争，读取最终权威状态），不能在会回滚的事务内写了 `FAILED` 就认为已持久化。业务写入、成功 Audit 和 `EXECUTED` 状态更新必须在同一个租户事务内完成；现有 Audit append 返回 void，实施时让它返回所插入的 Audit ID，以便同事务关联 AiOperation.auditId。若技术上无法保证，应缩小实现而不是接受不确定状态。

### 5.3 Public stream events

不暴露 provider 原始事件、原始 Tool Result、密钥、数据库凭据、stack trace 或请求响应 payload。使用 CRM 自有事件：

```text
proposal.created
proposal.ready
proposal.rejected
proposal.expired
proposal.conflicted
proposal.executed
proposal.failed
```

UI 只接收安全展示模型：

```ts
{
  proposalId: string;
  operation: 'UPDATE_RECORD' | 'CREATE_FOLLOW_UP' | 'ADD_ACTIVITY_NOTE';
  title: string;
  targetSummary: string;
  changes: Array<{ label: string; before?: string; after?: string }>;
  validationWarnings: string[];
  expiresAt: string;
  status: ProposalStatus;
}
```

---

## 6. AI Chat Page Optimization

保留现有 V1A UI V2 的整体布局、Conversation Rail、Chat Surface、响应式断点和只读来源卡；只增加 V1B 使用链路所需能力。

### 6.1 Proposal Card

Proposal Card 必须清楚展示：

- 目标 Record / Follow-up 的安全摘要；
- 操作类型和人类可读的影响；
- Record 更新的 before → after；
- 新建跟进的标题、关联 Record、当前执行人、到期时间；首版没有 description 字段，不新增字段迁移；
- NOTE 标签、关联 Record 和备注内容；
- `确认执行` 与 `拒绝`；
- 过期、权限变化、版本冲突、业务校验失败的具体状态；
- 成功后的相关 Record / Follow-up 跳转。

### 6.2 UI invariants

- 没有服务端 `proposal.ready`，不显示可执行确认按钮；
- 点击确认立即禁用按钮并显示进行中状态；
- 刷新、重新登录、切换会话后能从服务端恢复 Proposal 状态；
- 拒绝无副作用并成为终态；
- 冲突不自动覆盖新值，只允许用户重新提出请求；
- 写操作卡与只读来源卡分离，AI 建议不显示为“已执行”；
- 不展示 HIDDEN 字段、内部租户信息或 provider/数据库错误；
- 继续明确“需确认的建议”边界，不呈现为 AI 自主执行。

---

## 7. Error Semantics

| 场景 | Proposal 状态 | 页面行为 |
|---|---|---|
| 模型输出不符合 Proposal schema | 不创建可执行 Proposal | 普通 AI 错误，不显示 Confirm |
| 预校验发现字段只读/隐藏 | 不创建可执行 Proposal | 说明不能修改，不泄露隐藏字段 |
| 超过有效期 | `EXPIRED` | 禁用 Confirm，提示重新提出 |
| 确认时权限改变 | `CONFLICTED` / `FORBIDDEN` | 不写入，提示授权已变化 |
| 记录或对象版本变化 | `CONFLICTED` | 不覆盖新值 |
| 业务校验失败 | `FAILED` | 展示安全的字段级错误，不泄露隐藏字段 |
| 命令成功 | `EXECUTED` | 展示结果、Audit 关联和跳转 |
| 用户拒绝 | `REJECTED` | 显示已拒绝，无副作用 |
| 网络超时 | 保持服务端真实状态 | 查询 Proposal 状态，不盲目重发写命令 |

不把所有失败归类为“AI 失败”：权限变化、版本冲突、业务校验和 provider 故障必须保持可区分。

---

## 8. Security and Acceptance Matrix

实现完成前至少证明：

1. 未确认不写入任何业务表；
2. 拒绝无副作用；
3. 同一 Proposal 并发确认最多执行一次；
4. 已执行 Proposal 重试不重复写入；
5. 确认时重新检查 Actor、Tenant、权限、范围、字段和版本；
6. Employee 的 `OWN` 范围不能写其他成员记录；
7. HIDDEN / READ_ONLY 字段不进入 Proposal、页面或错误；
8. 记录版本冲突不覆盖新值；
9. 三种命令都进入正确 Domain Audit；
10. `AiOperation` 能关联 request → proposal → confirmation → audit；
11. 跨租户 Proposal 不可读、不可执行；
12. stale / rejected / expired / conflicted Proposal 不可执行；
13. Proposal schema 拒绝 tenant/member/role/admin override；
14. 不存在 raw SQL、超级用户或 `runAs*` 绕过；
15. 刷新页面能恢复 Proposal 状态；
16. 成功后页面跳转到正确 Record / Follow-up；
17. 六项 required checks 全绿，并完成真实浏览器桌面与移动宽度验收。

---

## 9. Delivery Slices

正式实施计划应拆为可独立验收的切片，不用一份大 PR 隐藏跨域风险：

1. **Typed Command Foundation**：抽出并测试三种 transaction-aware command，保持既有 HTTP 行为不变；
2. **Proposal Persistence + Confirm Runtime**：AiOperation、RLS、状态机、过期、锁、幂等和 Proposal API；
3. **Provider / Stream Integration**：结构化 Proposal 候选、预校验和 CRM 自有 Proposal 事件；
4. **AI Chat Page + Acceptance**：Proposal Card、确认/拒绝、恢复、冲突/失败反馈和浏览器验收。

每个切片遵循：

```text
focused RED → 最小实现 → focused GREEN → 评审 → 独立提交
```

CI / branch protection 不混入产品 PR。若实现中发现 CI 缺陷，停止当前切片并单独报告。若发现现有业务写入路径无法满足事务边界，先停在 Typed Command Foundation，不在 AI module 内绕过。

---

## 10. Completion and Exit Criteria

V1B 只有在以下事实全部成立后才能标记 `COMPLETED`：

- 三种 Typed Command 均能从 Confirm 入口成功执行；
- 未确认、拒绝、过期、冲突和权限变化均无未授权写入；
- Domain Audit 与 AiOperation 可追溯；
- Proposal 并发和重试语义已验证；
- 六项 required checks 全绿；
- AI 聊天页完成桌面和移动真实浏览器验收；
- HANDOFF 记录实际实现、验证证据和已知缺口；
- Production Essentials 仍明确为后续阶段，不自动开始。

V1B 完成后，产品仍是 Human-confirmed CRM Assistant，不是 Agentic CRM。
