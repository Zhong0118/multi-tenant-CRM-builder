# Workflow Required Field Visibility Hardening Design

> 日期：2026-09-16  
> 文档类型：Bounded Security Hardening Design  
> 状态：APPROVED SCOPE / READY FOR IMPLEMENTATION  
> 基线：Action Engine V1 已通过 PR #1 合并进入 `main`  
> 相关验收：`docs/audits/2026-09-16/action-engine-v1-acceptance.md`

# 1. Task

任务名：

> **Workflow Required Field Visibility Hardening**

目标只解决一个权限信息泄露：

> Runtime Workflow API 不得向当前 Actor 暴露其字段权限为 `HIDDEN` 的 required field key 或 label。

这是 Action Engine V1 合并后的独立小型安全收口，不是 V2.2，也不重新打开 Action Engine 架构。

---

# 2. 当前真实问题

当前 `runtimeWorkflowView()` 的 `availableTransitions()` 会把：

```ts
transition.requiredFieldKeys
```

原样返回。

因此只要一个已发布 Workflow Snapshot 中存在：

```text
Transition.requiredFieldKeys = ["secret-field"]
```

而当前 Actor 的：

```text
access.fields["secret-field"] = "HIDDEN"
```

GET Runtime 仍可能把 `secret-field` 发送给客户端。

同时 `resolveExecutableTransition()` 进入 `assertRequiredFields()` 后，当前实现把 `HIDDEN` 字段视为 missing，并继续构造：

```text
fieldErrors[secret-field]
message: “Transition”前需要补充：隐藏字段标签
```

所以 direct execute 也可能泄露 field key / label。

---

# 3. 为什么 Publish Validation 不能替代 Runtime Hardening

当前 Object Publish 已经会阻止：

```text
allowedRoles includes EMPLOYEE
+
required field is HIDDEN in employee default field access
```

因此正常的新 Publication 通常不应产生这个组合。

但 Runtime 仍必须 fail closed，原因包括：

1. 历史/legacy publication；
2. 手工或异常持久化的 snapshot；
3. future permission model 演进；
4. runtime effective access 是最终安全边界，不能只依赖 publish-time invariant；
5. 服务端响应不应因为上游 validation 理论上“应该挡住”就允许 secret metadata 泄露。

因此本 Task 是 defense-in-depth，不删除现有 Publish Validation。

---

# 4. 正式行为决策

采用以下规则：

> **如果当前 Actor 对某个 Transition 的任一 `requiredFieldKey` 是 `HIDDEN`，或该 field key 不存在于当前 `access.fields`，则整个 Transition 对该 Actor 不可执行。**

不是：

```text
把 hidden requiredFieldKey 从 requiredFieldKeys 数组里删掉，
但仍把 Transition 返回给客户端。
```

原因：

- Actor 无法看到该字段；
- Actor 也无法主动补齐该字段；
- 继续显示按钮会制造一个用户永远无法完成的 Transition；
- direct POST 仍需安全拒绝；
- “整个 Transition 不可执行”在权限语义上最一致。

---

# 5. GET Runtime 行为

对 `runtimeWorkflowView()`，`availableTransitions` 过滤条件新增：

```text
transition 的所有 requiredFieldKeys 对当前 Actor 都不是 HIDDEN
```

因此：

```text
HIDDEN required field
  ↓
整个 Transition 不出现在 availableTransitions
```

客户端：

- 看不到 Transition；
- 看不到 required field key；
- 看不到 hidden field label；
- 不需要 Web 端额外 redaction。

Start Transition `__start__` 不受影响，因为它没有 configured required fields。

---

# 6. Direct Execute 行为

攻击者或旧客户端仍可能直接请求：

```text
POST .../workflow/transitions/:transitionKey
```

因此 `resolveExecutableTransition()` 不能只依赖 GET 的过滤。

顺序：

```text
find transition
  ↓
check allowedRoles
  ↓
check hidden required fields
  ↓
assert visible required field values
```

如果存在 HIDDEN / unknown required field：

```text
throw ApiException(
  'WORKFLOW_TRANSITION_FORBIDDEN',
  403
)
```

响应不得包含：

```text
fieldKey
field label
fieldErrors
hidden field count
```

也不新增一个会暴露原因的安全错误码。

---

# 7. Visible Required Fields 保持现状

如果 required field 的有效字段权限是：

```text
EDIT
READ_ONLY
```

本 Hardening 不改变现有 missing-value behavior。

例如：

```text
amount = EDIT
amount missing
```

仍返回：

```text
WORKFLOW_REQUIRED_FIELDS_MISSING
```

并可以包含：

```text
fieldErrors.amount
amount label
```

因为字段对该 Actor 可见。

`READ_ONLY` 但为空导致用户无法自行补齐，是另一个 publication/UX 问题，不在本 Task 中解决。

---

# 8. Unknown Access Entry

现有权限模型常用：

```ts
access.fields[fieldKey] ?? 'HIDDEN'
```

本 Task 保持这个 fail-closed 规则：

```text
requiredFieldKey 不存在于 access.fields
  ≡ HIDDEN
```

因此：

- GET 不返回 Transition；
- direct execute 返回 generic 403；
- 不泄露 unknown key。

---

# 9. Member Override

当前 Member Override 主要覆盖 Object Action / Scope，不改变 Field Permission。

本 Task 不改变这一模型。

仍然基于 `EffectiveObjectAccess.fields` 做最终判断，因为这才是 Runtime 应依赖的权限接口。

这样以后即使 Member-level Field Permission 被引入，也无需重新设计 Workflow Runtime。

---

# 10. 建议代码结构

只修改：

```text
apps/api/src/modules/workflows/workflow-runtime.ts
apps/api/src/modules/workflows/workflow-runtime.spec.ts
```

必要时增加一个内部 helper：

```ts
function hasHiddenRequiredFields(
  transition: Pick<PublishedWorkflowTransition, 'requiredFieldKeys'>,
  access: EffectiveObjectAccess,
): boolean
```

语义：

```ts
return transition.requiredFieldKeys.some(
  (fieldKey) => (access.fields[fieldKey] ?? 'HIDDEN') === 'HIDDEN',
);
```

`availableTransitions()` 和 `resolveExecutableTransition()` 必须复用同一 helper，避免 GET / POST 权限规则漂移。

不要把 helper 导出成新的公共 API，除非测试结构确实要求。

---

# 11. 不修改 Web

`record-workflow-panel.tsx` 不需要改。

安全边界必须在 API。

如果 Transition 被过滤，`availableTransitions` 自然不渲染按钮。

如果攻击者绕过 UI 直接 POST，API generic 403。

Web 不需要知道 hidden required field 的存在。

---

# 12. 不修改 Contracts / DB

Runtime DTO shape 不变：

```text
availableTransitions[].requiredFieldKeys: string[]
```

只是服务端保证数组中只会出现当前 Actor 可见的 field keys。

因此不需要：

```text
migration
Prisma schema change
contracts regenerate
OpenAPI shape change
```

---

# 13. Tests

必须新增/补强以下测试。

## GET projection

Actor：

```text
EMPLOYEE
canUpdate = true
updateScope = ALL
access.fields.visible = EDIT
access.fields.secret = HIDDEN
```

Workflow：

```text
transition visible-transition
requiredFieldKeys = [visible]

transition hidden-transition
requiredFieldKeys = [secret]
```

期望：

```text
availableTransitions
  contains visible-transition
  does NOT contain hidden-transition
```

并断言序列化后的 response 不包含：

```text
secret
hidden field label
```

## Direct execute

对 `hidden-transition` 调用 `resolveExecutableTransition(...)`。

期望：

```text
WORKFLOW_TRANSITION_FORBIDDEN
403
```

并确认错误：

```text
fieldErrors = none/empty
message 不包含 secret key
message 不包含 hidden label
```

## Unknown field

Transition：

```text
requiredFieldKeys = ['legacy-secret']
```

`access.fields` 无该 key。

行为与 HIDDEN 完全相同。

## Visible missing regression

Transition required：

```text
amount = EDIT
```

record value missing。

仍然：

```text
WORKFLOW_REQUIRED_FIELDS_MISSING
```

且 fieldErrors 仍有 `amount`。

## Admin regression

TENANT_ADMIN 的 access fields 为 EDIT。

原 Transition 继续正常返回/执行。

---

# 14. Security Invariant

完成后长期成立：

```text
Runtime response metadata
⊆
Actor visible field metadata
```

具体到 Workflow：

```text
availableTransitions.requiredFieldKeys
```

不得成为绕过 Object Field Permission 的 metadata side channel。

同理：

```text
WORKFLOW_REQUIRED_FIELDS_MISSING
```

只能包含当前 Actor 可见的字段。

---

# 15. Non-goals

本 Task 明确不处理：

```text
Action Engine publish analyzer 的 default-value 合法性
Action Engine publish analyzer 的 READ_ONLY required mapping
结构性 WORKFLOW_ACTION_* locator
executionSummary 删除
deadlock retry backoff/jitter
auth e2e 既有失败
全仓 lint
CI
branch protection
Sales Execution
Automation
Agent
Member-level Field Permission
```

发现这些问题只能记录，不能顺手扩展。

---

# 16. Definition of Done

- [ ] HIDDEN required field 不再出现在 `availableTransitions`；
- [ ] unknown required field 按 HIDDEN 处理；
- [ ] direct execute 不泄露 hidden key/label；
- [ ] direct execute 返回 generic `WORKFLOW_TRANSITION_FORBIDDEN`；
- [ ] visible required field missing 的现有错误行为不变；
- [ ] Tenant Admin 行为不回归；
- [ ] Web 无需修改；
- [ ] DB/Contracts 无需修改；
- [ ] focused workflow runtime tests 通过；
- [ ] relevant workflow service tests 通过；
- [ ] `pnpm typecheck` 通过；
- [ ] 生成一份真实 Hardening Acceptance；
- [ ] HANDOFF 移除该已知缺口或标记为已修复；
- [ ] 不开始 V2.2。
