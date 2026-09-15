# Workflow V1 实施计划

> 日期：2026-09-15  
> 文档类型：Current Task Implementation Plan  
> 状态：IMPLEMENTED — 验收见 `docs/audits/2026-09-15/workflow-v1-acceptance.md`  
> 设计规格：`docs/superpowers/specs/2026-09-15-workflow-v1-design.md`  
> 架构边界：`docs/superpowers/specs/2026-09-15-workflow-platform-boundaries.md`

# 1. Agent 执行规则

开始前必须完整阅读：

1. `HANDOFF.md`
2. `docs/superpowers/plans/2026-09-15-crm-process-roadmap.md`
3. `docs/superpowers/specs/2026-09-15-workflow-platform-boundaries.md`
4. `docs/superpowers/specs/2026-09-15-workflow-v1-design.md`
5. 本计划

并遵守 HANDOFF 中：

- 不修改的用户文件；
- 不 reset / rebase / force push；
- 不部署；
- 推送需用户明确授权；
- 先用 `.codegraph/` / `codegraph explore` 理解相关符号；
- 每个问题优先聚焦验证，不反复无意义跑全仓。

## 当前唯一开发范围

只实现：

> State + Transition + Manual Execution + History + Audit

禁止顺手实现：

- Action Engine；
- Automation；
- Notification；
- Dedup；
- Template Workflow；
- Agent。

---

# 2. 开发策略

采用：

```text
Schema
  ↓
Draft Domain
  ↓
Publication
  ↓
Runtime
  ↓
Admin UI
  ↓
Record UI
  ↓
Final Acceptance
```

每一大步：

```text
先写失败测试
  ↓
最小实现
  ↓
聚焦测试通过
  ↓
继续下一步
```

不要每改一个文件就跑 `pnpm test` 全仓。

全仓测试只在最终验证阶段跑一次。

---

# 3. Task 0 — 建立工作区与基线

## 目标

确认 Agent 开始时没有基线漂移。

## 只读检查

```bash
git status --short --branch
git log -10 --oneline
node --version
pnpm --version
```

确认：

- Node 满足根 `engines`；
- 当前分支基于 `main` 最新远端；
- 用户保护文件没有被碰；
- 没有未知本地改动需要覆盖。

## 建议开发分支

如果当前工作流允许：

```bash
git switch -c feat/workflow-v1
```

不要直接在未保护的 `main` 上连续开发大功能。

## 基线验证

不要重复全仓。

只确认和本任务直接相关的现有聚焦测试当前为绿：

```bash
pnpm --filter @crm/api test -- objects.service.spec.ts
pnpm --filter @crm/api test -- records.service.spec.ts
```

Web 选择：

- object designer 当前测试；
- record list/detail 当前测试。

如果测试文件命令与仓库 runner 不同，使用现有 package script 的正确写法，不为匹配本文而修改 runner。

---

# 4. Task 1 — 数据库 Workflow Draft 与 Runtime State

## 目标

建立长期可演进的数据结构。

## 修改

`packages/database/prisma/schema.prisma`

新增建议模型：

```text
ObjectWorkflowDefinition
WorkflowStateDefinition
WorkflowTransitionDefinition
RecordTransitionHistory
```

修改：

```text
复用 Record.statusKey / records.status_key
领域与 API 对外仍称 workflowStateKey
不要新增 workflow_state_key 列
```

关系必须包含 `tenantId`，遵循当前复合外键 / Tenant RLS 模式。

## 新迁移

建议：

```text
packages/database/prisma/migrations/0017_workflow_state_machine/migration.sql
```

如果仓库实际下一 migration 编号已变化，以当前最新编号顺延，不覆盖已有 migration。

## RLS

为新表复制现有安全模型，而不是发明简化版。

至少：

- Workflow draft：只有当前 tenant 可读写；
- Transition history：当前 tenant 可读；
- History 禁止正常 app role update/delete；
- app role 不得 BYPASSRLS。

## RED

新增 database integration test，例如：

```text
packages/database/test/integration/workflow-rls.test.mjs
```

至少先证明：

1. Tenant A 看不到 Tenant B workflow；
2. Tenant A 看不到 Tenant B transition history；
3. runtime app role 不能 update/delete history。

先让测试失败。

## GREEN

完成 schema / SQL / policies 后让聚焦数据库测试通过。

## 验收

```text
Prisma generate
Migration applies
RLS test passes
```

---

# 5. Task 2 — API Workflow Module 骨架与 Admin Draft API

## 新目录

建议：

```text
apps/api/src/modules/workflows/
  workflows.module.ts
  workflow-admin.controller.ts
  workflow-admin.service.ts
  workflow.repository.ts
  dto/workflow.dto.ts
  workflow-admin.service.spec.ts
```

如当前项目已有更严格 module 命名约定，遵循现有约定。

## App Module

注册 Workflow Module。

## Endpoint

实现：

```text
GET
/workspaces/:tenantCode/object-definitions/:objectId/workflow

PUT
/workspaces/:tenantCode/object-definitions/:objectId/workflow
```

挂在全局 `/api/v1` prefix 下。

## Guards

必须：

```text
SessionAuthGuard
WorkspaceGuard
```

Service 再校验：

```text
role === TENANT_ADMIN
```

不能只靠前端。

## PUT Contract

包含：

```text
expectedDraftRevision
isEnabled
initialStateKey
states[]
transitions[]
```

V1 整体 replace。

## RED

先写：

- employee PUT -> 403；
- cross tenant -> 404/403（遵循现有资源隐藏语义）；
- invalid duplicate key -> validation error；
- stale draftRevision -> conflict。

## GREEN

Repository 事务写入：

- workflow；
- states；
- transitions；
- object draftRevision + 1。

不要影响 Active Publication。

---

# 6. Task 3 — Workflow Draft Validator

## 新文件建议

```text
apps/api/src/modules/workflows/workflow-draft.policy.ts
apps/api/src/modules/workflows/workflow-draft.policy.spec.ts
```

或者如果项目更适合并入现有：

```text
apps/api/src/modules/objects/object-publication.policy.ts
```

基础 Draft Save 检查可在 Workflow policy，Publication 级检查仍进入 object publication policy。

## 校验

State：

- key syntax；
- unique；
- label；
- initial exists；
- terminal outgoing forbidden。

Transition：

- key syntax；
- unique；
- from exists；
- to exists；
- from != to；
- duplicate from/to forbidden；
- allowedRoles valid；
- requiredFieldKeys valid。

## RED

每类错误至少一个聚焦测试。

不要为每个字符串边界制造几十个低价值测试。

---

# 7. Task 4 — 编译进入 Object Publication Snapshot

## 修改重点

先用 Codegraph 找到当前 Object Publish 的实际编译入口。

已知关键文件：

```text
apps/api/src/modules/objects/object-publication.policy.ts
apps/api/src/modules/objects/objects.service.ts
apps/api/src/modules/objects/objects.repository.ts
```

不要另建独立 Workflow Publication。

## 目标

发布后的：

```text
ObjectPublication.schema
```

增加可选：

```text
workflow
```

老 Publication 不含 workflow 时依旧可解析。

## Publication Safety

发布前新增：

- requiredFieldKeys 引用存在；
- 当前仍有 Record 使用的 State 不能被删除。

State in use 检查必须在 tenant transaction context 中执行。

## RED

测试：

1. valid workflow snapshot；
2. no workflow backward compatible；
3. dangling required field rejects；
4. state in use removal rejects。

## Contracts

不要此时手改生成文件。

等 API DTO 稳定后统一 regenerate。

---

# 8. Task 5 — Record Create 初始化 Workflow State

## 修改

已知：

```text
apps/api/src/modules/records/records.service.ts
apps/api/src/modules/records/records.service.spec.ts
```

需要时修改 repository。

## 行为

如果 active publication：

```text
schema.workflow exists
```

则：

```text
workflowStateKey = initialStateKey
```

否则：

```text
null
```

客户端不能通过 create payload 指定 workflowStateKey。

## RED

测试：

- workflow object create -> initial；
- non-workflow object create -> null；
- malicious payload cannot select arbitrary state。

## Compatibility

不要改变现有普通字段 validation / owner 逻辑。

---

# 9. Task 6 — Runtime Workflow Read API

## 新文件建议

```text
apps/api/src/modules/workflows/workflow-runtime.controller.ts
apps/api/src/modules/workflows/workflow-runtime.service.ts
apps/api/src/modules/workflows/workflow-runtime.service.spec.ts
```

## Endpoint

```text
GET
/workspaces/:tenantCode/objects/:objectCode/records/:recordId/workflow
```

返回：

- currentState；
- availableTransitions；
- recordVersion。

## 权限

读取 Record Workflow 必须先满足当前 Record Read 权限。

Available Transition 再按：

```text
canUpdate
role
currentState
```

裁剪。

## Old Record

`workflowStateKey = null` 时：

有 update 权限：

```text
__start__
```

无 update 权限：

```text
[]
```

---

# 10. Task 7 — Execute Transition

## Endpoint

```text
POST
/workspaces/:tenantCode/objects/:objectCode/records/:recordId/workflow/transitions/:transitionKey
```

Body：

```json
{
  "expectedVersion": 7
}
```

## Error Codes

修改：

```text
apps/api/src/common/errors/api-error-code.ts
```

加入设计规格中的 Workflow errors。

保持当前统一 ApiException / fieldErrors 风格。

## Transaction

必须在同一个数据库事务中：

1. 再读当前 Record；
2. 校验 expectedVersion；
3. 校验 currentState；
4. 校验 effective canUpdate；
5. 校验 allowedRoles；
6. 校验 requiredFieldKeys；
7. 更新 workflowStateKey；
8. version + 1；
9. 写 Transition History。

不要先更新 Record 再尝试写 History。

## RED — 必须先写

最少：

- valid transition；
- wrong current state；
- canUpdate false；
- role forbidden；
- missing required field；
- stale version；
- terminal state；
- cross tenant。

## GREEN

最小实现通过后再抽取共享函数。

---

# 11. Task 8 — Start Legacy Record

## 目标

旧 Record 不批量改写。

使用同一 Runtime：

```text
transitionKey = __start__
```

或者 Service 内保留等价系统动作。

外部 API 仍通过统一 transition endpoint。

## 行为

只允许：

```text
workflowStateKey === null
```

且：

```text
canUpdate
```

成功：

```text
null -> initialStateKey
```

写 History。

## RED

- null can start；
- started record cannot start again；
- no update cannot start；
- version conflict still enforced。

---

# 12. Task 9 — Audit

## API

复用现有 Audit 写入路径。

建议 action：

```text
workflow.draft_updated
record.workflow_started
record.transition_executed
```

Object Publish 继续复用现有 publication audit。

Audit details 包含：

- object；
- record；
- transition；
- from；
- to；
- versions。

## Web Labels

检查当前 company/platform audit 的 label 实现。

已知已有：

```text
apps/web/src/features/platform/audit-labels.ts
```

如 workspace audit 使用不同 map，同步补齐。

## RED

至少测试新 action label 不再回退为半翻译代码。

---

# 13. Task 10 — OpenAPI 与 Contracts

Workflow API 稳定后：

```bash
pnpm contracts:generate
```

提交：

```text
packages/contracts/openapi.json
packages/contracts/src/generated/openapi.ts
```

然后：

```bash
pnpm contracts:check
```

必须无 drift。

不要手写 generated 类型。

---

# 14. Task 11 — Web Workflow Admin API / Types

## 新文件建议

```text
apps/web/src/features/objects/workflow-api.ts
apps/web/src/features/objects/workflow-types.ts
```

如果 OpenAPI generated types 已足够，优先引用生成类型，不复制 DTO。

## 行为

封装：

```text
get workflow draft
save workflow draft
```

React Query key 应包含：

```text
tenantCode
objectId
```

Save 成功刷新：

- workflow draft；
- object draftRevision；
- publication analysis（如当前页面依赖）。

---

# 15. Task 12 — Object Designer Workflow UI

## 新组件建议

```text
apps/web/src/features/objects/workflow-designer.tsx
apps/web/src/features/objects/workflow-designer.test.tsx
```

集成：

```text
apps/web/src/features/objects/object-designer.tsx
```

## UI

实现：

### Workflow 开关

### States

- label；
- key；
- initial；
- terminal；
- ordering；
- add/remove。

### Transitions

- label；
- key；
- from；
- to；
- allowedRoles；
- required fields；
- ordering；
- add/remove。

## UX

必须有：

- 具名 Save Success；
- API fieldErrors 对应到 UI；
- terminal from 不允许选择；
- required field 使用 Field Label；
- publish-invalid 错误可理解。

## RED

至少覆盖：

- add states；
- set initial；
- add transition；
- save payload；
- successful save feedback；
- invalid terminal transition UI prevention。

不要把 DnD 作为 V1 必须项；简单 Up/Down 排序可接受，优先稳定。

---

# 16. Task 13 — Record Workflow Panel

## 新文件建议

```text
apps/web/src/features/records/record-workflow-panel.tsx
apps/web/src/features/records/record-workflow-panel.test.tsx
```

集成到当前 Record Detail Surface。

已知记录入口：

```text
apps/web/src/features/records/record-list.tsx
```

Agent 应先用 Codegraph 找到实际 detail drawer/component，再在最小范围接入；不要为了 Workflow 重写整个 Record Detail。

## UI

显示：

```text
流程状态
可执行操作
流程历史
```

## 行为

Transition 成功后刷新：

- record；
- workflow runtime；
- transition history；
- 受影响 dashboard/query 仅在现有 query invalidation 需要时刷新。

## Error

Required Fields：

优先显示：

```text
“标记赢单”前需要补充：预计金额
```

而不是 generic 400。

Version Conflict：

显示：

> 记录已被其他人更新，请刷新后再操作。

---

# 17. Task 14 — Transition History UI

可以与 Task 13 同组件完成，也可拆：

```text
apps/web/src/features/records/record-transition-history.tsx
```

要求：

- 时间倒序；
- actor；
- transition label；
- from → to；
- createdAt；
- empty state。

不要支持 edit/delete。

---

# 18. Task 15 — Focused Security / Regression Tests

在功能完成后补齐矩阵，不要只测 Happy Path。

## API

至少覆盖：

```text
cross tenant
inactive membership
canUpdate false
role forbidden
hidden required field publication failure
state mismatch
version conflict
terminal state
```

## Database

RLS/history append-only。

## Web

至少覆盖：

- admin save；
- employee available buttons；
- no permission no button；
- required field error；
- stale conflict feedback。

---

# 19. Task 16 — Browser Acceptance

不要只看 test。

使用真实本地 Web/API/PostgreSQL/Redis。

按 Spec 第 32 节走查。

至少保存验收结果：

```text
Admin workflow config
Draft does not affect runtime
Publish
New record initial state
Legacy record start
Employee transition
Required field rejection
Permission rejection
Version conflict
History
Audit
Console errors = 0
```

发现 Bug：

- 每个 Bug 一个聚焦复现；
- 修复；
- 再只重跑相关验收；
- 不因一个视觉 Bug 反复全仓测试。

---

# 20. Task 17 — Final Verification

所有实现稳定后一次性跑完整验证。

建议：

```bash
pnpm typecheck
pnpm contracts:check
pnpm test
pnpm build
```

如仓库实际 build/test 需要基础设施，按现有 README/HANDOFF 启动 PostgreSQL/Redis。

记录：

- 命令；
- exit code；
- suite count；
- migration status。

不能写“应该通过”，必须记录实际结果。

---

# 21. Task 18 — Acceptance 文档

开发完成后才新建：

```text
docs/audits/YYYY-MM-DD/workflow-v1-acceptance.md
```

不要现在预填成功。

内容必须是实际事实：

```text
Feature baseline / commits
Migration
API endpoints
Web pages
Tests
Browser walkthrough
Security checks
Spec deviations
Known gaps
```

如果和 Spec 有偏差，明确记录：

```text
Planned
Actual
Reason
Follow-up
```

---

# 22. Task 19 — 更新 HANDOFF

Workflow V1 完成后更新 `HANDOFF.md`：

## Current implemented

增加：

- Workflow draft；
- publish snapshot；
- state；
- manual transition；
- history；
- audit。

## Known gaps

明确仍然没做：

- Action Engine；
- auto conversion；
- Event / Trigger；
- notification；
- approval；
- AI。

## Next

下一 Task 候选：

> Action Engine V1

但不要直接开始开发。

先让用户确认 Roadmap 是否仍按原优先级进入下一阶段。

---

# 23. Commit 建议

保持小而可审查。

示例：

```text
feat(workflow): add tenant-scoped workflow draft schema
feat(workflow): compile workflow into object publications
feat(workflow): initialize record workflow state
feat(workflow): execute guarded record transitions
feat(workflow): add transition history and audit
feat(workflow): add object workflow designer
feat(workflow): show record workflow actions and history
test(workflow): cover isolation and optimistic conflicts
docs(workflow): record v1 acceptance
```

不要把全部 V1 压成一个巨大 commit。

---

# 24. Stop Conditions

遇到以下情况必须停止并汇报，不要自行扩大设计：

1. 现有 Object Publication schema 无法兼容可选 workflow；
2. 现有 RLS 结构要求使用不同关系模型；
3. Workflow State 必须进入普通 Field 才能保持核心功能；
4. Object Publish 无法安全检查 State in use；
5. Required Field 权限出现无法用现有模型表达的矛盾；
6. 需要 Action Engine 才能完成 V1；
7. 必须修改 HANDOFF 标记的禁止文件；
8. 必须 reset/rebase/force push；
9. 需要部署生产环境。

汇报应包含：

```text
发现的问题
为什么当前设计无法继续
两个以上可选方案
各自影响
推荐方案
```

用户确认后再继续。

---

# 25. V1 完成后的禁止动作

即使 V1 全绿，Agent 也不要自行：

- 开始 Action Engine；
- 加 Trigger；
- 做线索转换；
- 做 AI；
- 扩平台模板；
- 大规模重构现有权限模块。

正确下一步：

```text
Acceptance
  ↓
HANDOFF
  ↓
用户 review
  ↓
再生成 Action Engine V1 Design Spec
```
