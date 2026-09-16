# Workflow Required Field Visibility Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止 Workflow Runtime 通过 `requiredFieldKeys` 或 required-field error 向 Actor 泄露其字段权限为 `HIDDEN` 的 field key / label。

**Architecture:** 在 `workflow-runtime.ts` 内建立一个单一的 hidden-required-field predicate，并同时用于 GET 的 available-transition projection 与 POST 的 executable-transition authorization。存在 hidden/unknown required field 时，Transition 对当前 Actor 整体不可执行；GET 不返回，direct execute 返回通用 403，不暴露字段细节。

**Tech Stack:** NestJS / TypeScript / Jest, existing Workflow Runtime and EffectiveObjectAccess.

**Spec:** `docs/superpowers/specs/2026-09-16-workflow-required-field-visibility-hardening-design.md`

## Global Constraints

- 这是 Action Engine V1 合并后的 bounded security hardening。
- 只解决 `requiredFieldKeys` 字段可见性。
- HIDDEN 或 access map 中缺失的 required field 都视为不可见。
- 有任一不可见 required field 时，整个 Transition 对该 Actor 不可执行。
- GET 不返回该 Transition。
- Direct POST 返回 `WORKFLOW_TRANSITION_FORBIDDEN`，不得包含 hidden key / label / fieldErrors。
- Visible required field missing 的 `WORKFLOW_REQUIRED_FIELDS_MISSING` 行为不变。
- 不改 Web、DB、Prisma、Contracts、OpenAPI。
- 不修 auth e2e、lint、CI、Action publish analyzer、retry。
- 不开始 V2.2。
- 不 reset / rebase / force-push / deploy。
- 未经用户明确要求，不 push。

---

## File Structure

### Modify

```text
apps/api/src/modules/workflows/workflow-runtime.ts
apps/api/src/modules/workflows/workflow-runtime.spec.ts
HANDOFF.md
```

### Create after verification

```text
docs/audits/2026-09-16/workflow-required-field-visibility-hardening.md
```

No other product files should be necessary.

> 执行记录（2026-09-16 收口）：本文件与本 plan 曾以 untracked 副本形式输入 worktree，
> 现已正式纳入版本控制；验收文档也从 `docs/audits/` 根下的
> `2026-09-16-workflow-required-field-visibility-hardening.md` 用 `git mv` 归位到
> 上面的日期子目录（仓库既有约定），文中不再保留旧路径。

---

### Task 0: Baseline and isolated branch

**Files:**
- Read: `HANDOFF.md`
- Read: hardening Spec and this Plan
- Modify: none

**Interfaces:**
- Consumes: merged `main` containing PR #1.
- Produces: isolated branch/worktree based on current `origin/main`.

- [ ] **Step 1: Verify the merge is the base**

Run:

```bash
git fetch origin
git status --short --branch
git log -5 --oneline origin/main
```

Expected: Action Engine V1 is already in `origin/main`.

- [ ] **Step 2: Create an isolated worktree**

Use `superpowers:using-git-worktrees`.

Recommended branch:

```text
fix/workflow-required-field-visibility
```

Base:

```text
origin/main
```

- [ ] **Step 3: Run focused baseline tests**

Run the repository's actual command for:

```text
apps/api/src/modules/workflows/workflow-runtime.spec.ts
apps/api/src/modules/workflows/workflow-runtime.service.spec.ts
```

Expected: PASS before modification.

If baseline is red, stop and report.

---

### Task 1: Add failing security tests

**Files:**
- Modify: `apps/api/src/modules/workflows/workflow-runtime.spec.ts`

**Interfaces:**
- Consumes:
  - `runtimeWorkflowView()`
  - `resolveExecutableTransition()`
- Produces: executable tests defining hidden-required-field security behavior.

- [ ] **Step 1: Add GET projection test**

Build a published workflow with two transitions from the same state:

```ts
{
  key: 'visible-transition',
  requiredFieldKeys: ['amount'],
  allowedRoles: ['EMPLOYEE'],
}
```

and:

```ts
{
  key: 'hidden-transition',
  requiredFieldKeys: ['secret'],
  allowedRoles: ['EMPLOYEE'],
}
```

Effective access:

```ts
{
  canUpdate: true,
  updateScope: 'ALL',
  fields: {
    amount: 'EDIT',
    secret: 'HIDDEN',
  },
}
```

Assert:

```ts
const view = runtimeWorkflowView(...);

expect(view.availableTransitions.map((item) => item.key))
  .toContain('visible-transition');

expect(view.availableTransitions.map((item) => item.key))
  .not.toContain('hidden-transition');
```

Also assert:

```ts
const body = JSON.stringify(view);
expect(body).not.toContain('"secret"');
```

If the test schema gives `secret` a distinctive label such as `内部评级`, also assert:

```ts
expect(body).not.toContain('内部评级');
```

- [ ] **Step 2: Add direct execute hidden-field test**

Call:

```ts
resolveExecutableTransition(...)
```

for `hidden-transition`.

Assert thrown error shape:

```ts
{
  code: 'WORKFLOW_TRANSITION_FORBIDDEN'
}
```

and verify the repository's actual `ApiException` HTTP status is 403 using its existing assertion convention.

Then serialize the caught exception/error body as the current test helpers do and assert it does **not** contain:

```text
secret
内部评级
```

and exposes no hidden-field `fieldErrors`.

- [ ] **Step 3: Add unknown access-key test**

Transition:

```ts
requiredFieldKeys: ['legacy-secret']
```

but omit `legacy-secret` from `access.fields`.

Assert:

```text
GET: transition absent
POST: WORKFLOW_TRANSITION_FORBIDDEN
response/error text does not contain legacy-secret
```

- [ ] **Step 4: Preserve visible-field regression**

Keep or add a test where:

```ts
requiredFieldKeys: ['amount']
access.fields.amount = 'EDIT'
record.values.amount = undefined
```

Expected:

```text
WORKFLOW_REQUIRED_FIELDS_MISSING
```

and `fieldErrors.amount` still exists.

- [ ] **Step 5: Run only workflow-runtime spec**

Expected: the new HIDDEN/unknown tests FAIL before implementation, while old visible-field tests remain green.

Do not modify code before observing RED.

---

### Task 2: Implement one shared visibility predicate

**Files:**
- Modify: `apps/api/src/modules/workflows/workflow-runtime.ts`
- Test: `apps/api/src/modules/workflows/workflow-runtime.spec.ts`

**Interfaces:**
- Produces internal helper:

```ts
function hasHiddenRequiredFields(
  transition: Pick<PublishedWorkflowTransition, 'requiredFieldKeys'>,
  access: EffectiveObjectAccess,
): boolean
```

- Consumed by:
  - `availableTransitions()`
  - `resolveExecutableTransition()`

- [ ] **Step 1: Add the predicate**

Implement exactly:

```ts
function hasHiddenRequiredFields(
  transition: Pick<PublishedWorkflowTransition, 'requiredFieldKeys'>,
  access: EffectiveObjectAccess,
): boolean {
  return transition.requiredFieldKeys.some(
    (fieldKey) => (access.fields[fieldKey] ?? 'HIDDEN') === 'HIDDEN',
  );
}
```

Do not export it unless test structure makes that unavoidable.

- [ ] **Step 2: Filter GET transitions**

In the configured-transition filter inside `availableTransitions()`, add:

```ts
!hasHiddenRequiredFields(transition, input.access)
```

Keep the existing conditions unchanged.

Do **not** merely map/filter `requiredFieldKeys`; the entire transition is unavailable.

- [ ] **Step 3: Protect direct execute**

In `resolveExecutableTransition()`:

After:

```text
transition exists
allowedRoles includes role
```

and before:

```ts
assertRequiredFields(...)
```

add:

```ts
if (hasHiddenRequiredFields(transition, input.access)) {
  throw new ApiException('WORKFLOW_TRANSITION_FORBIDDEN', 403);
}
```

Do not put field key, label, count, or reason into exception details.

- [ ] **Step 4: Leave `assertRequiredFields()` visible-field behavior intact**

Do not refactor its user-facing visible-field error semantics.

The hidden branch inside it becomes unreachable for valid callers after this change, but removing it is optional. Prefer the smallest safe diff:

```text
keep fail-closed logic
+
add authorization guard before it
```

- [ ] **Step 5: Run workflow-runtime tests**

Expected: PASS.

- [ ] **Step 6: Run workflow runtime service tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add   apps/api/src/modules/workflows/workflow-runtime.ts   apps/api/src/modules/workflows/workflow-runtime.spec.ts

git commit -m "fix: hide inaccessible workflow required fields"
```

---

### Task 3: Focused verification and regression boundary

**Files:**
- No product changes unless a focused regression is found.

**Interfaces:**
- Confirms the API-only fix does not require Web/Contract changes.

- [ ] **Step 1: Run focused Workflow suites**

Run the existing suites covering:

```text
workflow-runtime.spec.ts
workflow-runtime.service.spec.ts
object-publication.policy.spec.ts
published-object.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

If the repository requires package build artifacts first, use the same prerequisite sequence documented in Action Engine V1 Acceptance rather than sourcing the entire root `.env`.

Expected: exit 0.

- [ ] **Step 3: Confirm no contract drift is expected**

Because no DTO/OpenAPI shape changes, inspect:

```bash
git diff --name-only
```

There should be no:

```text
packages/contracts/openapi.json
packages/contracts/src/generated/openapi.ts
packages/database/**
apps/web/**
```

If generated contracts changed, stop and explain why before committing them.

- [ ] **Step 4: Optional contracts check**

If cheap in the current environment:

```bash
pnpm contracts:check
```

Expected: exit 0 / no drift.

No full e2e is required solely to prove this pure Workflow Runtime filtering change unless a focused test reveals service-level uncertainty.

---

### Task 4: Acceptance and HANDOFF closeout

**Files:**
- Create: `docs/audits/2026-09-16/workflow-required-field-visibility-hardening.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Produces current truth for the next development phase.

- [ ] **Step 1: Write a factual acceptance note**

Include:

```text
base main / branch / commit
problem fixed
exact runtime rule
files changed
focused tests actually run
typecheck result
contract status
known non-goals
```

Do not copy old Action Engine test counts unless rerun.

- [ ] **Step 2: Update HANDOFF known gap**

Find the existing Action Engine known gap about:

```text
requiredFieldKeys 没有按执行人的字段权限过滤
```

Remove it from “known unresolved gaps” or mark it explicitly fixed by this hardening commit.

Do not alter the other Action Engine known gaps.

- [ ] **Step 3: Verify only intended files changed**

Run:

```bash
git diff --check
git status --short
```

- [ ] **Step 4: Commit documentation**

```bash
git add   HANDOFF.md   docs/audits/2026-09-16/workflow-required-field-visibility-hardening.md

git commit -m "docs: record workflow field visibility hardening"
```

- [ ] **Step 5: Stop**

Do not start:

```text
Sales Execution
Automation
CI
auth e2e cleanup
Action publication analyzer cleanup
```

Do not push unless user explicitly asks.

---

## Plan Self-Review Checklist

Before claiming completion:

- [ ] GET no longer exposes a Transition whose required field is HIDDEN.
- [ ] Direct execute cannot expose hidden required field key.
- [ ] Direct execute cannot expose hidden required field label.
- [ ] Missing access entry is treated as HIDDEN.
- [ ] Visible required field behavior is unchanged.
- [ ] Admin behavior is unchanged.
- [ ] Existing Publish Validation remains in place.
- [ ] No Web change.
- [ ] No DB change.
- [ ] No Contract shape change.
- [ ] No unrelated hardening work entered the diff.
- [ ] HANDOFF no longer lists this issue as unresolved after verification.
