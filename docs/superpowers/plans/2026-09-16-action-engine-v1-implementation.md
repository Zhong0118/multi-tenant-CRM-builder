# Action Engine V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Workflow Transition 增加 5 类强事务 Typed Actions，并让普通 HTTP 与 Workflow Action 复用同一套 transaction-aware 业务命令。

**Architecture:** Transition Draft 保存 ordered `actions[]`，Object Publish 将其冻结进 immutable publication。Workflow Execute 在一个 Tenant transaction 中锁定 actor/source record，顺序执行 Action Engine，累积 source patch，最后只更新一次 Source Record 并写 Transition History/Audit；任意 Action 失败全部 rollback。

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, PostgreSQL RLS, class-validator/class-transformer, Swagger/OpenAPI, React/Next.js, Ant Design, TanStack Query, Vitest/Jest-style project tests.

**Spec:** `docs/superpowers/specs/2026-09-16-action-engine-v1-design.md`

## Global Constraints

- 当前唯一产品 Task：Action Engine V1。
- 只实现：`CREATE_RECORD`, `UPDATE_RECORD`, `CREATE_RELATION`, `CREATE_FOLLOW_UP`, `ASSIGN_OWNER`。
- Transition + Actions + Source Patch + State + History + Audit 同一 Tenant DB Transaction。
- 任意 Action 失败全部 rollback；不允许 partial success。
- Actions 使用真实 Actor 权限；禁止 `runAsSystem` / `runAsAdmin` / permission elevation。
- `SOURCE_FIELD` 永远读取进入 Transition 前的 immutable source snapshot。
- Source Record 在一次 Transition 中最终只 `version + 1`。
- `ACTION_OUTPUT` 只能引用前序 Action。
- V1 不实现 Trigger / Event Bus / Worker / Notification / Webhook / Approval / DSL / AI / Agent。
- V1 不新增 Employee Owner Change capability；`EMPLOYEE + ASSIGN_OWNER` 发布时阻止。
- 不修改 HANDOFF 保护文件。
- 不 reset / rebase / force-push / deploy。
- 未经用户明确要求，不 push。
- 开发开始前重新检查 `main`、最新 migration 编号和工作树；本文的 `0018` 仅在它仍是下一个编号时使用。

---

## File Structure Lock

### New API files

- `apps/api/src/modules/actions/action.types.ts`  
  Action discriminated unions、value sources、record refs、outputs、effect summary。
- `apps/api/src/modules/actions/action-draft.policy.ts`  
  Draft shape normalization、Action key/reference/source-patch conflict 校验。
- `apps/api/src/modules/actions/action-publication.policy.ts`  
  跨对象 publish-time schema/permission/mapping analysis。
- `apps/api/src/modules/actions/action-value-resolver.ts`  
  immutable source snapshot / actor / literal / output / datetime value resolution。
- `apps/api/src/modules/actions/action-engine.ts`  
  串行执行 5 类 Actions、outputs、source patch accumulator、error wrapping。
- `apps/api/src/modules/actions/actions.module.ts`  
  Action Engine provider/module boundary。
- `apps/api/src/modules/records/record-command.ts`  
  从 `RecordsService` 私有 helper 抽出的 transaction-aware create/update validation commands。
- `apps/api/src/modules/record-relations/record-relation-command.ts`  
  Relation transaction-aware create command。
- `apps/api/src/modules/follow-ups/follow-up-command.ts`  
  Follow-up transaction-aware create command。
- `apps/api/src/modules/objects/published-object-transaction.ts`  
  在已有 `Prisma.TransactionClient` 中解析 Active Publication + Effective Access，不强制 read gate。

### Expected modified API files

- `apps/api/src/modules/workflows/workflow.types.ts`
- `apps/api/src/modules/workflows/dto/workflow.dto.ts`
- `apps/api/src/modules/workflows/workflow-draft.policy.ts`
- `apps/api/src/modules/workflows/workflow.repository.ts`
- `apps/api/src/modules/workflows/workflow-runtime.ts`
- `apps/api/src/modules/workflows/workflow-runtime.service.ts`
- `apps/api/src/modules/workflows/workflows.module.ts`
- `apps/api/src/modules/objects/object-schema.ts`
- `apps/api/src/modules/objects/object-publication.policy.ts`
- `apps/api/src/modules/objects/objects.repository.ts`
- `apps/api/src/modules/objects/objects.service.ts`
- `apps/api/src/modules/objects/published-object.service.ts`
- `apps/api/src/modules/records/record-value-engine.ts`
- `apps/api/src/modules/records/records.service.ts`
- `apps/api/src/modules/records/records.repository.ts`
- `apps/api/src/modules/record-relations/record-relations.service.ts`
- `apps/api/src/modules/follow-ups/follow-ups.service.ts`
- `apps/api/src/modules/follow-ups/follow-ups.repository.ts`
- `apps/api/src/common/errors/api-error-code.ts`
- `apps/api/src/app.module.ts` only if `ActionsModule` must be imported globally; prefer importing from `WorkflowsModule` if sufficient.

### Database/contracts

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/<next>_workflow_actions/migration.sql`
- `packages/database/schema-contract.test.mjs`
- `packages/contracts/openapi.json` generated
- `packages/contracts/src/generated/openapi.ts` generated

### Web

- `apps/web/src/features/objects/workflow-types.ts`
- `apps/web/src/features/objects/workflow-api.ts`
- `apps/web/src/features/objects/workflow-designer.tsx`
- Create: `apps/web/src/features/objects/workflow-action-editor.tsx`
- Create: `apps/web/src/features/objects/workflow-action-editor.test.tsx`
- `apps/web/src/features/objects/workflow-designer.test.tsx`
- `apps/web/src/features/records/record-workflow-panel.tsx`
- `apps/web/src/features/records/record-workflow-panel.test.tsx`

### Docs after implementation

- `docs/audits/YYYY-MM-DD/action-engine-v1-acceptance.md`
- `HANDOFF.md`
- `docs/superpowers/plans/2026-09-15-crm-process-roadmap.md`
- `docs/superpowers/specs/2026-09-15-workflow-platform-boundaries.md`

---

### Task 0: Baseline, branch, and focused regression baseline

**Files:**
- Read: `HANDOFF.md`
- Read: this Spec and Plan
- Do not modify product files yet.

**Interfaces:**
- Consumes: current `main`.
- Produces: isolated feature branch/worktree and recorded baseline.

- [ ] **Step 1: Confirm current repo state**

```bash
git status --short --branch
git log -10 --oneline
ls packages/database/prisma/migrations | tail -5
```

Expected:
- clean or only known user files;
- `main` contains Workflow V1;
- determine actual next migration number.

- [ ] **Step 2: Create isolated feature worktree/branch**

Use `superpowers:using-git-worktrees`.

Recommended branch:

```text
feat/action-engine-v1
```

Do not reset/rebase the user's main working tree.

- [ ] **Step 3: Run focused existing regression tests before changes**

Run the existing focused suites for:

```bash
pnpm --filter @crm/api test -- workflow-draft.policy
pnpm --filter @crm/api test -- workflow-runtime
pnpm --filter @crm/api test -- records.service
pnpm --filter @crm/api test -- record-relations.service
pnpm --filter @crm/api test -- follow-ups.service
```

If the repo's test CLI requires file paths rather than name filters, use the actual existing per-file command and record it.

Expected: PASS before implementation. If baseline fails, stop and report.

- [ ] **Step 4: Commit nothing**

Baseline inspection is not a commit.

---

### Task 1: Persist `actions[]` in Workflow Draft

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<next>_workflow_actions/migration.sql`
- Modify: `packages/database/schema-contract.test.mjs`
- Modify: `apps/api/src/modules/workflows/workflow.types.ts`
- Modify: `apps/api/src/modules/workflows/dto/workflow.dto.ts`
- Modify: `apps/api/src/modules/workflows/workflow.repository.ts`
- Modify: `apps/api/src/modules/objects/objects.repository.ts`
- Test: `apps/api/src/modules/workflows/workflow-admin.service.spec.ts`
- Test: `packages/database/schema-contract.test.mjs`

**Interfaces:**
- Produces: `WorkflowTransitionDraft.actions: WorkflowActionDraft[]`.
- Later tasks rely on Draft read/save preserving array order byte-for-byte semantically.

- [ ] **Step 1: Add failing schema contract test**

Assert Prisma contains:

```text
WorkflowTransitionDefinition.actions Json @default("[]") @db.JsonB
```

and migration adds a JSONB array column without creating new tables/policies/grants.

- [ ] **Step 2: Run schema contract test and verify failure**

```bash
pnpm --filter @crm/database test
```

Expected: FAIL because `actions` does not exist.

- [ ] **Step 3: Add migration**

Migration must be equivalent to:

```sql
ALTER TABLE "workflow_transition_definitions"
ADD COLUMN "actions" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "workflow_transition_definitions"
ADD CONSTRAINT "workflow_transition_definitions_actions_array"
CHECK (jsonb_typeof("actions") = 'array');
```

Do not add new table/RLS/GRANT.

- [ ] **Step 4: Update Prisma model**

Add:

```prisma
actions Json @default("[]") @db.JsonB
```

to `WorkflowTransitionDefinition`.

- [ ] **Step 5: Define temporary action transport type**

In `workflow.types.ts`, import the canonical type that Task 2 will create. Until Task 2 lands in the same commit sequence, create Task 2 first in the same working branch if TypeScript cannot compile intermediate state. Do not duplicate a second permanent Action union in workflows.

Target interface:

```ts
export interface WorkflowTransitionDraft {
  key: string;
  label: string;
  fromStateKey: string;
  toStateKey: string;
  allowedRoles: WorkflowRole[];
  requiredFieldKeys: string[];
  actions: WorkflowActionDraft[];
  sortOrder: number;
}
```

- [ ] **Step 6: Update Workflow DTO**

`WorkflowTransitionDraftDto` gains an `actions` property accepted by the ValidationPipe.

Top-level unknown action properties must not silently pass. Use DTO-declared action keys plus the Task 2 policy for exact per-type shape validation.

- [ ] **Step 7: Persist and load actions**

Both:

```text
PrismaWorkflowStore.findDraft()
PrismaWorkflowStore.replaceDraft()
PrismaObjectsStore.findWorkflowDraft()
```

must map `actions`.

- [ ] **Step 8: Add round-trip admin test**

Test:

```text
save workflow with 2 ordered actions
GET draft
expect same keys/types/order
```

- [ ] **Step 9: Run focused tests**

Expected PASS:
- workflow admin service;
- database schema contract.

- [ ] **Step 10: Commit**

```bash
git add packages/database apps/api/src/modules/workflows apps/api/src/modules/objects/objects.repository.ts
git commit -m "feat: persist workflow transition actions"
```

---

### Task 2: Canonical Action Types and Draft Validator

**Files:**
- Create: `apps/api/src/modules/actions/action.types.ts`
- Create: `apps/api/src/modules/actions/action-draft.policy.ts`
- Create: `apps/api/src/modules/actions/action-draft.policy.spec.ts`
- Modify: `apps/api/src/modules/workflows/workflow.types.ts`
- Modify: `apps/api/src/modules/workflows/workflow-draft.policy.ts`
- Modify: `apps/api/src/modules/workflows/dto/workflow.dto.ts`

**Interfaces:**
- Produces:
  - `WorkflowActionDraft`
  - `ActionValueSource`
  - `ActionRecordRef`
  - `ActionOutput`
  - `validateTransitionActions(actions, context)`
- Consumed by publication, runtime, and web-contract tasks.

- [ ] **Step 1: Write failing validator tests**

Cover at minimum:

```text
valid empty actions
valid five action types
>20 actions rejected
invalid key rejected
duplicate key rejected
unsupported type rejected
forward ACTION_OUTPUT rejected
unknown output action rejected
unsupported output property rejected
duplicate UPDATE_RECORD source field rejected
two ASSIGN_OWNER actions rejected
EMPLOYEE + ASSIGN_OWNER marked incompatible for publication layer
```

- [ ] **Step 2: Run tests and verify RED**

- [ ] **Step 3: Implement discriminated unions**

Canonical shapes:

```ts
type WorkflowActionDraft =
  | CreateRecordAction
  | UpdateRecordAction
  | CreateRelationAction
  | CreateFollowUpAction
  | AssignOwnerAction;
```

Use exact keys described in the Spec.

- [ ] **Step 4: Implement strict shape validation**

Policy must reject extra properties per Action type.

Do not use `eval`, template expressions, or arbitrary JSON path.

- [ ] **Step 5: Implement reference ordering validation**

When action at index `i` uses:

```ts
{ source: 'ACTION_OUTPUT', actionKey: 'x', property: 'recordId' }
```

`x` must exist at an index `< i`.

- [ ] **Step 6: Wire into `validateWorkflowDraft()`**

`normalizeTransition()` returns normalized `actions`.

Old caller data without `actions` is normalized to `[]` only for backward-compatible published snapshots; new Draft DTO must always send an array.

- [ ] **Step 7: Run focused tests**

Expected PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/actions apps/api/src/modules/workflows
git commit -m "feat: validate typed workflow actions"
```

---

### Task 3: Publication snapshot/parser backward compatibility

**Files:**
- Modify: `apps/api/src/modules/objects/object-schema.ts`
- Modify: `apps/api/src/modules/objects/object-publication.policy.ts`
- Modify: `apps/api/src/modules/objects/published-object.service.ts`
- Test: `apps/api/src/modules/objects/object-publication.policy.spec.ts`
- Test: `apps/api/src/modules/objects/published-object.service.spec.ts`

**Interfaces:**
- Produces: `PublishedWorkflowTransition.actions`.
- Old snapshots without `actions` parse as `[]`.

- [ ] **Step 1: Write failing tests**

Tests:

```text
compile publication freezes actions in order
parse new publication with actions succeeds
parse old Workflow V1 publication without actions succeeds and yields actions=[]
unknown action property fails closed
```

- [ ] **Step 2: Run tests and verify RED**

- [ ] **Step 3: Extend published types**

Add `actions: PublishedAction[]` to the in-memory published transition representation.

- [ ] **Step 4: Fix strict `parseWorkflow()` whitelist**

Current strict transition keys exclude `actions`.

Parser behavior must be:

```text
actions missing  -> []
actions present  -> strict parse
unknown top-level transition key -> invalid snapshot
```

Do not make the entire transition parser loose.

- [ ] **Step 5: Compile actions into ObjectPublication**

`compilePublishedWorkflow()` copies the validated normalized actions.

- [ ] **Step 6: Run focused tests**

Expected PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/objects
git commit -m "feat: publish workflow action snapshots"
```

---

### Task 4: Transaction-aware published-object access resolver

**Files:**
- Create: `apps/api/src/modules/objects/published-object-transaction.ts`
- Modify: `apps/api/src/modules/objects/published-object.service.ts`
- Modify: `apps/api/src/modules/objects/published-object.repository.ts` only if helper extraction avoids duplicate query code.
- Test: `apps/api/src/modules/objects/published-object.service.spec.ts`
- Create/Test: `apps/api/src/modules/objects/published-object-transaction.spec.ts`

**Interfaces:**
- Produces:

```ts
resolvePublishedObjectInTransaction(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  objectCode: string,
): Promise<ResolvedObjectSchema>
```

This function computes schema + effective access but does **not** impose a read action gate.

- [ ] **Step 1: Write failing tests**

Cover:

```text
canCreate=true, canRead=false -> resolver returns access
member override canCreate=false -> resolver returns false
inactive/unpublished target -> OBJECT_NOT_FOUND
cross-tenant target -> OBJECT_NOT_FOUND
invalid publication snapshot -> INTERNAL_ERROR
```

- [ ] **Step 2: Run and verify RED**

- [ ] **Step 3: Extract shared parse/effective-access logic**

Avoid duplicating the strict snapshot parser.

- [ ] **Step 4: Implement transaction query**

Within the supplied `tx`, load:

```text
object definition
active publication configuration
member override for context.memberId
```

under `context.tenantId`.

- [ ] **Step 5: Preserve existing `PublishedObjectService.resolveRuntimeSchema()` behavior**

The public runtime resolver must still require read visibility for normal UI/read callers.

- [ ] **Step 6: Run tests**

Expected PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/objects
git commit -m "refactor: add transaction-aware object access resolver"
```

---

### Task 5: Extract Record transaction-aware commands and harden title length

**Files:**
- Create: `apps/api/src/modules/records/record-command.ts`
- Create: `apps/api/src/modules/records/record-command.spec.ts`
- Modify: `apps/api/src/modules/records/records.service.ts`
- Modify: `apps/api/src/modules/records/records.repository.ts`
- Modify: `apps/api/src/modules/records/record-value-engine.ts`
- Modify/Test: `apps/api/src/modules/records/record-value-engine.spec.ts`
- Modify/Test: `apps/api/src/modules/records/records.service.spec.ts`

**Interfaces:**
- Produces transaction-aware functions used by HTTP and Action Engine:

```ts
createRecordCommand(input): Promise<DynamicRecord>
prepareSourceRecordPatch(input): Promise<PreparedRecordPatch>
applySourceRecordPatch(input): Promise<DynamicRecord | null>
```

Exact names may differ only if all callers/tests are updated consistently.

- [ ] **Step 1: Add title boundary regression test**

Create a schema where `EMAIL` is title field.

Assert:
- 300-char valid derived title passes if valid email form can be constructed;
- derived title >300 throws `FIELD_INVALID` for title field before DB write.

- [ ] **Step 2: Verify RED then add 300-char derived-title guard**

Do not truncate.

- [ ] **Step 3: Write command parity tests**

For `createRecordCommand`, prove it preserves:
- canCreate;
- field EDIT/HIDDEN/READ_ONLY;
- required/default;
- MEMBER active validation;
- owner rules;
- title calculation;
- target Workflow initial state;
- recordNo allocation;
- audit.

- [ ] **Step 4: Move private `createRecordRow` logic into `record-command.ts`**

`RecordsService.create()` and import path must call the same command.

- [ ] **Step 5: Extract update validation from `applyRecordUpdate`**

The command must support validating a patch against an immutable source snapshot without immediately incrementing version.

- [ ] **Step 6: Add single final source apply primitive**

It must atomically write:

```text
values
title
ownerMemberId
workflowStateKey
version = version + 1
```

with `expectedVersion`.

Do not increment for intermediate UPDATE_RECORD/ASSIGN_OWNER.

- [ ] **Step 7: Preserve ordinary HTTP behavior**

Existing update/create tests must stay green.

Do not change Employee owner semantics here.

- [ ] **Step 8: Run focused record tests**

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/records
git commit -m "refactor: extract transaction-aware record commands"
```

---

### Task 6: Extract Relation and Follow-up transaction-aware create commands

**Files:**
- Create: `apps/api/src/modules/record-relations/record-relation-command.ts`
- Create: `apps/api/src/modules/record-relations/record-relation-command.spec.ts`
- Modify: `apps/api/src/modules/record-relations/record-relations.service.ts`
- Modify/Test: `apps/api/src/modules/record-relations/record-relations.service.spec.ts`
- Create: `apps/api/src/modules/follow-ups/follow-up-command.ts`
- Create: `apps/api/src/modules/follow-ups/follow-up-command.spec.ts`
- Modify: `apps/api/src/modules/follow-ups/follow-ups.service.ts`
- Modify: `apps/api/src/modules/follow-ups/follow-ups.repository.ts`
- Modify/Test: `apps/api/src/modules/follow-ups/follow-ups.service.spec.ts`

**Interfaces:**
- Produces functions that accept an **existing** `Prisma.TransactionClient`.

Suggested contracts:

```ts
createRecordRelationCommand(tx, context, input, meta, actionMeta?)
createFollowUpCommand(tx, context, input, meta, actionMeta?)
```

- [ ] **Step 1: Write Relation parity tests**

Verify command preserves:
- same tenant;
- source write permission semantic;
- target visibility/access semantic;
- not deleted;
- deterministic pair;
- duplicate no-op behavior;
- audit.

- [ ] **Step 2: Extract Relation command**

Public `RecordRelationsService.add()` keeps its `runner.withTenant()` boundary, but inside it calls the new command.

- [ ] **Step 3: Write Follow-up parity tests**

Verify:
- target record access;
- title non-empty/max 200;
- dueAt valid;
- assignee active;
- recipient can access target record;
- audit.

- [ ] **Step 4: Extract Follow-up create command**

Public Follow-up create continues to open its normal transaction, then calls the shared command.

- [ ] **Step 5: Run focused tests**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/record-relations apps/api/src/modules/follow-ups
git commit -m "refactor: extract transactional relation and follow-up commands"
```

---

### Task 7: Build Action value resolver and Action Engine core

**Files:**
- Create: `apps/api/src/modules/actions/action-value-resolver.ts`
- Create: `apps/api/src/modules/actions/action-value-resolver.spec.ts`
- Create: `apps/api/src/modules/actions/action-engine.ts`
- Create: `apps/api/src/modules/actions/action-engine.spec.ts`
- Create: `apps/api/src/modules/actions/actions.module.ts`
- Modify: `apps/api/src/common/errors/api-error-code.ts`

**Interfaces:**
- Consumes transaction-aware resolvers/commands from Tasks 4–6.
- Produces:

```ts
executeActions(input): Promise<{
  outputs: Map<string, ActionOutput>;
  sourcePatch: SourceRecordPatch;
  effects: ActionEffectSummary[];
}>
```

- [ ] **Step 1: Write value resolver RED tests**

Cover:
- LITERAL;
- SOURCE_FIELD immutable snapshot;
- SOURCE_META recordId/title/ownerMemberId;
- ACTOR memberId;
- ACTION_OUTPUT previous result;
- NOW;
- NOW_PLUS_DAYS bounds;
- LITERAL_DATETIME;
- SOURCE_FIELD date/datetime;
- missing/null source owner error.

- [ ] **Step 2: Implement resolver without expression language**

- [ ] **Step 3: Write Action Engine RED tests with fake commands**

Cover ordered execution and outputs:

```text
CREATE_RECORD A
CREATE_RECORD B
CREATE_RELATION A-B
CREATE_FOLLOW_UP A
UPDATE_RECORD source
ASSIGN_OWNER source
```

- [ ] **Step 4: Implement CREATE_RECORD executor**

Runtime:
- transaction resolver Target Current Active Publication;
- `createRecordCommand`;
- output `recordId/objectCode/recordNo`;
- action audit metadata correlation.

- [ ] **Step 5: Implement UPDATE_RECORD executor**

Do not write source DB.

Validate and merge into source patch.

Reject duplicate source field writes defensively even if publication validation should have caught them.

- [ ] **Step 6: Implement ASSIGN_OWNER executor**

Rules:
- `EMPLOYEE` => explicit forbidden;
- `TENANT_ADMIN` => validate source update scope and set pending owner to actor member id;
- never silent no-op.

- [ ] **Step 7: Implement CREATE_RELATION executor**

Resolve both record refs then call transaction-aware relation command.

- [ ] **Step 8: Implement CREATE_FOLLOW_UP executor**

Resolve target/title/dueAt/assignee, then call transaction-aware command.

- [ ] **Step 9: Wrap domain errors**

Map failures to:

```text
ACTION_EXECUTION_FAILED
```

while preserving field path:

```text
actions.<actionKey>.<fieldKey>
```

Do not turn `RECORD_VERSION_CONFLICT` from the outer source record into generic Action error.

- [ ] **Step 10: Run Action tests**

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/actions apps/api/src/common/errors/api-error-code.ts
git commit -m "feat: add transactional action engine"
```

---

### Task 8: Add cross-object Publish Analyzer

**Files:**
- Modify: `apps/api/src/modules/objects/objects.repository.ts`
- Modify: `apps/api/src/modules/objects/objects.service.ts`
- Modify: `apps/api/src/modules/objects/object-publication.policy.ts`
- Modify: `apps/api/src/modules/actions/action-publication.policy.ts`
- Test: `apps/api/src/modules/objects/object-publication.policy.spec.ts`
- Test: `apps/api/src/modules/objects/objects.service.spec.ts`

**Interfaces:**
- Produces publish-time blocking issues for current target schemas.

- [ ] **Step 1: Write RED tests**

Cover:
- target object missing;
- target unpublished;
- target field missing;
- source field missing;
- field type mismatch;
- select option incompatibility;
- target required mapping missing;
- Employee target default `canCreate=false`;
- Employee target mapped field non-editable;
- Employee + ASSIGN_OWNER;
- forward action output;
- valid configuration.

- [ ] **Step 2: Add ObjectsStore target-schema lookup**

Read target by `(tenantId, code)` and current `activePublication`.

No cross-tenant lookup.

- [ ] **Step 3: Collect target object codes from Workflow Draft**

Both `analyzePublication()` service flow and `publish()` flow must load the same target context before invoking pure analysis.

- [ ] **Step 4: Implement `analyzeActionPublication()`**

Return `PublicationIssue[]` with stable codes from the Spec.

- [ ] **Step 5: Merge issues into existing Workflow publication analysis**

Do not create a second publish endpoint.

- [ ] **Step 6: Run publication tests**

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/actions/action-publication.policy.ts apps/api/src/modules/objects
git commit -m "feat: validate workflow actions at publication"
```

---

### Task 9: Integrate Action Engine into Workflow Execute transaction

**Files:**
- Modify: `apps/api/src/modules/workflows/workflow-runtime.service.ts`
- Modify: `apps/api/src/modules/workflows/workflow-runtime.ts`
- Modify: `apps/api/src/modules/workflows/workflows.module.ts`
- Modify: `apps/api/src/modules/records/records.repository.ts`
- Test: `apps/api/src/modules/workflows/workflow-runtime.service.spec.ts`
- Test: `apps/api/src/modules/workflows/workflow-runtime.spec.ts`

**Interfaces:**
- Produces one atomic execution path.

- [ ] **Step 1: Write RED atomic execution service test**

Assert transaction call order conceptually:

```text
lock actor
lock source
version check
transition resolve
executeActions
validate source patch
single source update + state
history
audits
commit
```

- [ ] **Step 2: Ensure source schema/access resolves inside the same Tenant transaction**

Do not call the old read-gated resolver outside transaction for execute path.

GET/runtime read path can retain existing resolver behavior.

- [ ] **Step 3: Lock/re-check active actor**

Reuse the same membership invariants as current mutation paths.

- [ ] **Step 4: Lock source record and check `expectedVersion`**

Stale version must stop before any action runs.

- [ ] **Step 5: Resolve transition from published snapshot**

Preserve:
- state;
- role;
- required field checks.

- [ ] **Step 6: Generate `workflowExecutionId`**

One UUID per attempt that reaches Action execution.

Only successful committed audit rows expose it.

- [ ] **Step 7: Execute ordered actions**

Pass immutable source snapshot.

- [ ] **Step 8: Apply source patch + `toStateKey` once**

One SQL/Prisma update with:

```text
expectedVersion = request
version + 1
```

- [ ] **Step 9: Insert exactly one Transition History**

Before/after version differ by exactly 1.

- [ ] **Step 10: Append transition audit**

Include:
- `workflowExecutionId`;
- transition key;
- actionCount;
- versions;
- from/to states.

- [ ] **Step 11: Run focused workflow tests**

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/modules/workflows apps/api/src/modules/records/records.repository.ts
git commit -m "feat: execute workflow actions atomically"
```

---

### Task 10: Prove rollback and concurrency against PostgreSQL

**Files:**
- Create or Modify: `packages/database/test/integration/action-engine-rls.test.mjs`
- Create: `apps/api/src/modules/actions/action-engine.integration.spec.ts` if API test infrastructure supports real DB transaction tests.
- Modify: integration helpers only if required.

**Interfaces:**
- Proves the central All-or-Nothing guarantee.

- [ ] **Step 1: Add rollback integration test**

Scenario:

```text
Action 1 CREATE_RECORD succeeds
Action 2 CREATE_RECORD succeeds
Action 3 fails
```

After request:

```text
created target rows = 0
relations = 0
followups = 0
source state unchanged
source version unchanged
transition history = 0
successful action/transition audits = 0
```

- [ ] **Step 2: Add member-override permission rollback test**

Source transition allowed, target create denied by member override.

Expected entire rollback.

- [ ] **Step 3: Add RLS cross-tenant test**

No Action may reference/resolve target object/record from another tenant.

- [ ] **Step 4: Add concurrent transition test**

Two requests:

```text
same record
same expectedVersion
same transition
```

Expected:
- exactly one success;
- one `RECORD_VERSION_CONFLICT`;
- one downstream record set only.

- [ ] **Step 5: Run independent test DB**

Use the repo's existing isolated test DB workflow (previously port 5433) rather than relying only on developer 5432 data.

- [ ] **Step 6: Commit**

```bash
git add packages/database/test apps/api/src/modules/actions
git commit -m "test: prove action engine atomicity and tenant safety"
```

---

### Task 11: OpenAPI and generated contracts

**Files:**
- Modify source DTOs only.
- Generate:
  - `packages/contracts/openapi.json`
  - `packages/contracts/src/generated/openapi.ts`

**Interfaces:**
- Produces generated client contract for `actions` and effect summaries.

- [ ] **Step 1: Add runtime effect DTOs**

Available transition should expose safe static effect summaries, for example:

```ts
interface RuntimeTransitionEffectDto {
  type: ActionType;
  label: string;
}
```

No hidden field mappings.

- [ ] **Step 2: Add success execution summary DTO if implementation returns it**

Keep it lightweight per Spec.

- [ ] **Step 3: Generate contracts**

```bash
pnpm contracts:generate
```

- [ ] **Step 4: Check drift**

```bash
pnpm contracts:check
```

Expected PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/workflows/dto packages/contracts
git commit -m "chore: generate action engine contracts"
```

---

### Task 12: Web Action types and Workflow Action Editor

**Files:**
- Modify: `apps/web/src/features/objects/workflow-types.ts`
- Modify: `apps/web/src/features/objects/workflow-api.ts`
- Create: `apps/web/src/features/objects/workflow-action-editor.tsx`
- Create: `apps/web/src/features/objects/workflow-action-editor.test.tsx`
- Modify: `apps/web/src/features/objects/workflow-designer.tsx`
- Modify: `apps/web/src/features/objects/workflow-designer.test.tsx`

**Interfaces:**
- Produces ordered Action editor bound to `transition.actions`.

- [ ] **Step 1: Add failing UI type/editor tests**

Cover:
- add Action;
- choose type;
- edit action key;
- reorder up/down;
- delete;
- CREATE_RECORD target object + mapping;
- CREATE_RELATION only shows source/prior created-record refs;
- CREATE_FOLLOW_UP due-at modes;
- UPDATE_RECORD source only;
- ASSIGN_OWNER explanatory copy;
- save sends actions.

- [ ] **Step 2: Extend web workflow types**

Mirror API contract.

- [ ] **Step 3: Build focused `WorkflowActionEditor` component**

Do not grow existing `workflow-designer.tsx` into one huge action implementation.

Props should include enough current object fields and available target schemas/options from existing APIs.

If target-object schema metadata is not currently available to the designer without a new endpoint, first reuse an existing admin object detail/list endpoint. Do not add a broad “execute action” endpoint.

- [ ] **Step 4: Add ordered step controls**

Use buttons/selects, not graph canvas.

- [ ] **Step 5: Integrate into each Transition card/section**

Default new transition:

```ts
actions: []
```

- [ ] **Step 6: Show backend field-path validation**

Map errors such as:

```text
transitions.0.actions.1.values.phone
```

to the Action section or at minimum render the precise API message.

- [ ] **Step 7: Run focused web tests**

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/objects
git commit -m "feat: add workflow action designer"
```

---

### Task 13: Employee effect confirmation and runtime errors

**Files:**
- Modify: `apps/web/src/features/records/record-workflow-panel.tsx`
- Modify: `apps/web/src/features/records/record-workflow-panel.test.tsx`
- Modify: `apps/web/src/features/objects/workflow-types.ts`

**Interfaces:**
- Consumes `availableTransitions[].effects`.
- Produces confirmation modal only for transitions with effects.

- [ ] **Step 1: Write RED tests**

With actions:
- click transition;
- modal lists effect labels;
- cancel => no API call;
- confirm => execute API.

Without actions:
- preserve current direct transition behavior.

Error:
- `ACTION_EXECUTION_FAILED` shows server message including “所有变更均未保存”.

- [ ] **Step 2: Implement Ant Design confirmation UI**

Keep the summary static.

Do not simulate permission or values client-side.

- [ ] **Step 3: Invalidate runtime/history/detail after success**

Preserve current query behavior.

- [ ] **Step 4: Run focused tests**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/records apps/web/src/features/objects/workflow-types.ts
git commit -m "feat: confirm workflow action effects"
```

---

### Task 14: Architecture boundary and Roadmap activation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-workflow-platform-boundaries.md`
- Modify: `docs/superpowers/plans/2026-09-15-crm-process-roadmap.md`

**Interfaces:**
- Records current active-task architecture, not implementation success.

- [ ] **Step 1: Add Action transaction/permission boundary**

Add:

```text
同步 DB Action：
- actor permission
- same tenant transaction
- no partial success
- no system elevation
- external I/O requires future outbox/worker
```

- [ ] **Step 2: Mark Roadmap Action Engine ACTIVE**

Change only:

```text
V2.1B Action Engine: PLANNED -> ACTIVE
```

Keep future phases PLANNED.

- [ ] **Step 3: Link Spec and Plan**

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers
git commit -m "docs: activate Action Engine V1"
```

---

### Task 15: Focused security/regression verification

**Files:**
- Tests only as required.

**Interfaces:**
- Verifies no pre-existing core behavior regressed.

- [ ] **Step 1: Run focused API suites once after implementation stabilizes**

At minimum:
- workflow draft/admin/runtime;
- action policies/engine;
- records;
- relations;
- follow-ups;
- object publication/published object.

- [ ] **Step 2: Run web focused suites**

At minimum:
- workflow designer;
- action editor;
- record workflow panel.

- [ ] **Step 3: Run database schema + action/RLS integration**

- [ ] **Step 4: Fix only reproducible failures**

Do not expand scope.

- [ ] **Step 5: Commit fixes in small logical commits**

---

### Task 16: Real browser acceptance

**Files:**
- No code unless acceptance finds a bug.
- Later record facts in acceptance doc.

**Interfaces:**
- Proves admin configuration and employee runtime.

- [ ] **Step 1: Build generic test objects**

Use neutral names:

```text
process-source
process-target-a
process-target-b
```

Do not hard-code Lead/Customer into Core.

- [ ] **Step 2: Configure workflow**

```text
draft -> process -> done
```

- [ ] **Step 3: Configure actions**

Use all five types where valid.

Because V1 Employee ASSIGN_OWNER is intentionally blocked, test full five-action flow as TENANT_ADMIN; use a separate Employee flow without ASSIGN_OWNER for employee success.

- [ ] **Step 4: Publish and execute admin happy path**

Confirm:
- target records;
- relations;
- follow-up;
- source update;
- owner assignment;
- state;
- source version +1;
- history;
- audit correlation.

- [ ] **Step 5: Execute Employee success path**

Use actions compatible with Employee real permissions.

- [ ] **Step 6: Force permission failure safely**

After publication, add a Member Override removing target create permission.

Execute as that Employee.

Confirm no partial data.

- [ ] **Step 7: Capture exact browser observations**

No screenshots required unless project convention asks; record exact steps/results.

---

### Task 17: Final verification

**Files:**
- None unless fixes needed.

- [ ] **Step 1: Typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 2: Contracts check**

```bash
pnpm contracts:check
```

Expected: exit 0.

- [ ] **Step 3: Full test once**

```bash
pnpm test
```

Expected: exit 0.

Do not claim pass from old logs.

- [ ] **Step 4: Production build**

Run the repo's current production build command, typically:

```bash
pnpm build
```

Expected: exit 0.

- [ ] **Step 5: Record exact suite counts / commands / environment**

These facts go into Acceptance.

---

### Task 18: Acceptance and HANDOFF

**Files:**
- Create: `docs/audits/YYYY-MM-DD/action-engine-v1-acceptance.md`
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-15-crm-process-roadmap.md`

**Interfaces:**
- Produces current-truth handoff.

- [ ] **Step 1: Write Acceptance from actual facts**

Include:
- branch and commits;
- migration number;
- actual Action types;
- transaction design;
- ASSIGN_OWNER V1 limitation;
- tests and counts;
- rollback proof;
- concurrency proof;
- RLS proof;
- browser walkthrough;
- deviations;
- known gaps.

- [ ] **Step 2: Update HANDOFF**

State:
- Action Engine branch/status;
- implemented facts;
- remaining gaps;
- no deployment unless truly deployed.

Do not touch protected user files.

- [ ] **Step 3: Mark Roadmap COMPLETED only if DoD is actually satisfied**

Otherwise leave ACTIVE and list blockers.

- [ ] **Step 4: Commit docs**

```bash
git add docs/audits HANDOFF.md docs/superpowers/plans/2026-09-15-crm-process-roadmap.md
git commit -m "docs: record Action Engine V1 acceptance"
```

- [ ] **Step 5: Stop**

Do not start V2.2 Sales Execution.

Do not push unless user explicitly asks.

---

## Plan Self-Review Checklist

Before execution begins, the implementing Agent must confirm:

- [ ] Every Spec Action type has a task.
- [ ] All-or-Nothing has a real DB rollback test.
- [ ] Actor Permission has Member Override coverage.
- [ ] No Action invokes a Public Service that opens an independent transaction.
- [ ] Target CREATE can be resolved without requiring target `canRead`.
- [ ] Existing public read resolver still keeps its read gate.
- [ ] Source version increments exactly once.
- [ ] Old publication without `actions` parses as `[]`.
- [ ] `parseWorkflow()` strict whitelist includes `actions`.
- [ ] Prisma + migration + schema contract are synchronized.
- [ ] DTO + generated contracts are synchronized.
- [ ] Employee + ASSIGN_OWNER is blocked, not no-op.
- [ ] Derived Record title >300 is a domain validation error, not DB 500.
- [ ] No new ActionExecution table/RLS/GRANT was added without a new reviewed requirement.
- [ ] No Automation / Worker / Approval / Agent work leaked into this task.
