# Critical API E2E Gate Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the already-stabilized Critical API E2E suite to an independent GitHub Actions job and the sixth required `main` status check, without changing product code or test behavior.

**Architecture:** PR B starts only after PR A has merged to `main`. Add one isolated `Critical API E2E` job to the existing CI workflow, using its own PostgreSQL lifecycle and the existing `test:e2e:critical` command. After a hosted PR run proves that job works, update only the branch-protection required-status-checks subresource from five contexts to six, force a new PR-head run under the six-check policy, then merge only with explicit user authorization and verify the post-merge `main` run.

**Tech Stack:** GitHub Actions, Node.js 24, pnpm 11.19.0, Docker Compose, PostgreSQL 18, GitHub branch protection, GitHub CLI/API.

**Spec:** `docs/superpowers/specs/2026-09-17-engineering-gate-hardening-design.md`

## Global Constraints

- **Hard prerequisite:** PR A (`Critical API E2E Stabilization`) is merged into `main`, and current `main` contains a stable `pnpm --filter @crm/api test:e2e:critical` command.
- This is **PR B — Critical API E2E Gate Promotion**. Do not change `apps/**`, `packages/**`, test behavior, or product logic in this PR.
- If PR B reveals a real test/product defect, **STOP**. Fix it in a separate PR and restart/refresh Gate Promotion after that fix merges.
- The new job display name is exactly `Critical API E2E`; branch protection binds to this stable context name.
- Critical API E2E uses its own PostgreSQL lifecycle; it does not share the `Database Integration` job container/state.
- Runtime API database URL must use `crm_app` / `NOBYPASSRLS`. Admin credentials are only for migration/fixture administration.
- No `continue-on-error`, `|| true`, retries, skipped-green job, or soft-failure semantics.
- Keep existing required contexts unchanged: `Typecheck`, `Contracts`, `Unit Tests`, `Database Integration`, `Build`; add exactly `Critical API E2E`.
- Keep `main` protection enforcement for everyone; do not relax admin enforcement, up-to-date requirement, force-push policy, or branch deletion policy.
- Do not reset, rebase, force-push, or deploy.
- Do not edit protected files:
  - `apps/web/src/app/(auth)/register/page.tsx`
  - `chat会话.md`
  - `.superpowers/sdd/2026-08-26-platform-business-template-designer/progress.md`
- Do not start AI Assistant V1A/V1B. Hardening completion does not auto-promote AI.
- Push, branch-protection writes, PR merge, and any remote mutation require explicit user authorization at the appropriate step.
- Preserve the user's two-PR decision: do not create a third docs-only closeout PR merely to store the post-merge `main` run id. The Acceptance file records only pre-merge evidence observable at commit time; final post-merge evidence is recorded on the merged PR discussion/comment and in the verification report.

---

## File Structure

**Modify**

- `.github/workflows/ci.yml` — add the independent `critical-api-e2e` job only; preserve existing five job names/semantics.
- `HANDOFF.md` — record Gate Promotion state and, at the final pre-merge docs commit, the six-check target/observed PR evidence.
- `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md` — keep Engineering Gate Hardening ACTIVE while PR B is open; final pre-merge docs may describe completion as conditional on merge + post-merge main 6/6.
- `docs/audits/2026-09-17/engineering-gate-hardening-acceptance.md` — create an evidence-only acceptance record for PR A + PR B observations available before merge, with an explicit truthful note that the post-merge `main` run is not yet observable at document-commit time.
- `docs/superpowers/plans/2026-09-17-critical-api-e2e-gate-promotion-implementation.md` — commit this plan if not already in repo.

**Must not change in PR B**

- `apps/api/**`
- `apps/web/**`
- `packages/**`
- tests/fixtures/product behavior

---

### Task 1: Start PR B from the merged PR A baseline

**Files:**
- Modify: `HANDOFF.md`
- Verify: `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`
- Create/verify: `docs/superpowers/plans/2026-09-17-critical-api-e2e-gate-promotion-implementation.md`

**Interfaces:**
- Consumes: `main` containing merged PR A and `test:e2e:critical`.
- Produces: an isolated Gate Promotion branch with no product/test edits.

- [ ] **Step 1: Verify PR A is actually merged before starting**

Run:

```bash
git fetch origin
git log -10 --oneline origin/main
git status --short --branch
```

Then verify the merged baseline contains:

```bash
git show origin/main:apps/api/package.json | grep 'test:e2e:critical'
git show origin/main:apps/api/test/critical-api.e2e-spec.ts >/dev/null
```

If either is missing, STOP; PR B must not start before PR A merge.

- [ ] **Step 2: Create an isolated PR B worktree/branch**

Suggested branch:

```text
ci/critical-api-e2e-gate-promotion
```

Suggested worktree:

```text
.worktrees/critical-api-e2e-gate-promotion
```

- [ ] **Step 3: Record current branch-protection facts before mutation**

Read current `main` branch/protection through `gh api` (or the GitHub UI if the token lacks admin-read permission). Record:

```text
main protected = true
required checks = Typecheck, Contracts, Unit Tests, Database Integration, Build
enforcement/admin enforcement remains on
force push disabled
branch deletion disabled
branch must be up to date before merge
```

Do not write anything yet.

- [ ] **Step 4: Update HANDOFF for PR B start**

Record:

```text
Engineering Gate Hardening remains ACTIVE
PR A merged; Critical suite is stable
Current task: PR B Gate Promotion
Current required checks: 5
Target: add Critical API E2E as sixth required check
AI Assistant V1A remains PLANNED
```

- [ ] **Step 5: Commit PR B kickoff docs/plan**

```bash
git add HANDOFF.md \
  docs/superpowers/plans/2026-09-17-critical-api-e2e-gate-promotion-implementation.md
git commit -m "docs: start critical api e2e gate promotion"
```

---

### Task 2: Add the independent `Critical API E2E` GitHub Actions job

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm --filter @crm/api test:e2e:critical` from merged PR A.
- Produces: job id `critical-api-e2e`, display name `Critical API E2E`.

- [ ] **Step 1: Add the job without changing the existing five jobs**

Append this job at the same `jobs:` level as `database-integration`:

```yaml
  critical-api-e2e:
    name: Critical API E2E
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11.19.0
          run_install: false

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Start PostgreSQL
        run: docker compose up -d --wait postgres

      - name: Build internal prerequisites
        run: pnpm --filter @crm/contracts --filter @crm/database build

      - name: Deploy migrations
        env:
          DATABASE_ADMIN_URL: postgresql://crm:crm@localhost:5432/crm?schema=public
        run: pnpm --filter @crm/database prisma:migrate:deploy

      - name: Run Critical API E2E
        env:
          DATABASE_ADMIN_URL: postgresql://crm:crm@localhost:5432/crm?schema=public
          TEST_DATABASE_ADMIN_URL: postgresql://crm:crm@localhost:5432/crm?schema=public
          TEST_DATABASE_URL: postgresql://crm_app:crm_app@localhost:5432/crm?schema=public
        run: pnpm --filter @crm/api test:e2e:critical

      - name: Show PostgreSQL logs on failure
        if: failure()
        run: docker compose logs --no-color postgres

      - name: Stop PostgreSQL
        if: always()
        run: docker compose down -v
```

Do not rename or edit the semantics of:

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
```

- [ ] **Step 2: Verify the workflow diff contains only the new job**

Run:

```bash
git diff -- .github/workflows/ci.yml
```

Expected: no trigger/security/concurrency/existing-job changes unless strictly necessary to make the new job parse. If any unrelated workflow cleanup appears, remove it.

- [ ] **Step 3: Run a local CI-equivalent Critical job once**

Use a fresh PostgreSQL lifecycle, then run exactly the same build/migration/test sequence:

```bash
pnpm install --frozen-lockfile
pnpm --filter @crm/contracts --filter @crm/database build
DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:5432/crm?schema=public' \
  pnpm --filter @crm/database prisma:migrate:deploy
DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:5432/crm?schema=public' \
TEST_DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:5432/crm?schema=public' \
TEST_DATABASE_URL='postgresql://crm_app:crm_app@localhost:5432/crm?schema=public' \
  pnpm --filter @crm/api test:e2e:critical
```

Expected: PASS with the same Critical test count PR A established.

- [ ] **Step 4: Commit the CI infrastructure change separately**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add critical api e2e gate"
```

At this point there must still be no `apps/**` or `packages/**` changes on the branch.

---

### Task 3: Run local final checks before asking to push PR B

**Files:**
- No new edits expected.

**Interfaces:**
- Produces: a locally verified CI-only branch ready for user-authorized push.

- [ ] **Step 1: Verify scope mechanically**

```bash
git diff --name-only origin/main...HEAD
```

Expected at this stage:

```text
.github/workflows/ci.yml
HANDOFF.md
docs/superpowers/plans/2026-09-17-critical-api-e2e-gate-promotion-implementation.md
```

No path under `apps/` or `packages/` may be changed.

- [ ] **Step 2: Run the existing five gate commands locally**

```bash
pnpm typecheck
pnpm contracts:check
pnpm test
pnpm build
```

Then run Database Integration with real PostgreSQL and current test URLs:

```bash
TEST_DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:5432/crm?schema=public' \
TEST_DATABASE_URL='postgresql://crm_app:crm_app@localhost:5432/crm?schema=public' \
pnpm --filter @crm/database test:integration
```

Expected: all green.

- [ ] **Step 3: Run `Critical API E2E` locally once more**

```bash
DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:5432/crm?schema=public' \
TEST_DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:5432/crm?schema=public' \
TEST_DATABASE_URL='postgresql://crm_app:crm_app@localhost:5432/crm?schema=public' \
pnpm --filter @crm/api test:e2e:critical
```

Expected: green.

- [ ] **Step 4: Stop and report before remote mutation**

Report branch SHA, changed files, existing five check results, Critical result, and CI diff. Do not push/open PR until the user explicitly authorizes it.

---

### Task 4: Hosted PR verification before branch-protection promotion

**Prerequisite:** user explicitly authorizes push and PR creation.

**Files:**
- No code changes required for this task.

**Interfaces:**
- Consumes: the PR B branch with the new workflow job.
- Produces: a hosted GitHub Actions run proving all six jobs appear and `Critical API E2E` actually executes PostgreSQL + migrations + suite + teardown.

- [ ] **Step 1: Push branch and open the PR only after authorization**

Suggested PR title:

```text
ci: promote critical api e2e gate
```

PR body must state:

```text
PR B only: CI/branch-protection promotion
PR A already merged
No apps/** or packages/** changes
Target required contexts: existing five + Critical API E2E
Do not merge until hosted Critical job succeeds and protection read-back shows six contexts
```

- [ ] **Step 2: Wait for the hosted run on the exact PR head**

Verify six job display names appear:

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
Critical API E2E
```

- [ ] **Step 3: Inspect Critical job steps/logs**

Require observed success for:

```text
Start PostgreSQL
Build internal prerequisites
Deploy migrations
Run Critical API E2E
Stop PostgreSQL
```

Record the actual run id, job id, head SHA, test count, and conclusion. Do not use historical/local counts as hosted evidence.

- [ ] **Step 4: Stop on any failure**

If `Critical API E2E` fails because of test/product behavior, do not patch tests or product code in PR B. Stop, report, and move the fix to a separate PR.

---

### Task 5: Promote branch protection from five required contexts to six

**Prerequisite:** user explicitly authorizes the branch-protection write, and Task 4 hosted `Critical API E2E` is green on the current PR head.

**Files:**
- No repository file change in this step.

**Interfaces:**
- Consumes: existing required contexts + hosted successful `Critical API E2E` context.
- Produces: required status checks = exactly six, preserving strict/up-to-date behavior.

- [ ] **Step 1: Read the existing required-status-check configuration**

Prefer:

```bash
gh api \
  repos/Zhong0118/multi-tenant-CRM-builder/branches/main/protection/required_status_checks
```

Record `strict` and current contexts/checks. If admin-read permission is unavailable, use the GitHub branch protection UI and record the visible values; do not guess.

- [ ] **Step 2: Resolve the GitHub Actions app id for the hosted Critical check**

Use the exact current PR-head SHA from Task 4:

```bash
PR_HEAD_SHA="$(git rev-parse HEAD)"
ACTIONS_APP_ID="$(
  gh api "repos/Zhong0118/multi-tenant-CRM-builder/commits/${PR_HEAD_SHA}/check-runs" \
    --jq '.check_runs[] | select(.name == "Critical API E2E") | .app.id' | head -n1
)"
printf 'Critical API E2E app id: %s\n' "$ACTIONS_APP_ID"
```

Expected: one numeric app id. If no hosted `Critical API E2E` check run exists for this exact SHA, STOP; do not promote a guessed context.

- [ ] **Step 3: Update only the required-status-checks subresource**

Preserve app-bound check identities. Read the current `checks` array, append `Critical API E2E` with the observed GitHub Actions app id, and patch only this subresource:

```bash
CURRENT_CHECKS="$(
  gh api \
    repos/Zhong0118/multi-tenant-CRM-builder/branches/main/protection/required_status_checks \
    --jq '.checks'
)"

UPDATED_CHECKS="$(
  jq --arg context 'Critical API E2E' --argjson app_id "$ACTIONS_APP_ID" \
    '. + [{context: $context, app_id: $app_id}] | unique_by(.context)' \
    <<<"$CURRENT_CHECKS"
)"

jq -n --argjson checks "$UPDATED_CHECKS" \
  '{strict: true, checks: $checks}' >/tmp/required-status-checks.json

gh api --method PATCH \
  repos/Zhong0118/multi-tenant-CRM-builder/branches/main/protection/required_status_checks \
  --input /tmp/required-status-checks.json
```

Before sending the PATCH, inspect `/tmp/required-status-checks.json` and verify it contains the existing five contexts plus exactly one `Critical API E2E`. If the API/UI exposes a different representation, use the UI to add only the new GitHub Actions check while preserving the existing five; never replace the whole branch-protection object.

- [ ] **Step 4: Read back the required checks**

```bash
gh api \
  repos/Zhong0118/multi-tenant-CRM-builder/branches/main/protection/required_status_checks
```

Expected set, no more and no less:

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
Critical API E2E
```

Expected `strict: true` (or the repository's equivalent “branch must be up to date”).

- [ ] **Step 5: Re-read broader protection and verify nothing was relaxed**

Verify via API/UI:

```text
main protected = true
enforcement/admin enforcement = on/everyone
force pushes = disabled
branch deletion = disabled
PR before merge = required
```

If any existing protection changed unexpectedly, restore the prior value immediately and stop.

---

### Task 6: Create the evidence-only Acceptance and final PR B docs commit

**Files:**
- Create: `docs/audits/2026-09-17/engineering-gate-hardening-acceptance.md`
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`

**Interfaces:**
- Consumes: actual PR A merge evidence, PR A stability results, current PR B hosted run, and six-context protection read-back.
- Produces: truthful pre-merge acceptance documentation without inventing post-merge main evidence.

- [ ] **Step 1: Write the Acceptance file using only observed evidence**

Required structure:

```markdown
# Engineering Gate Hardening — Acceptance

> 日期：2026-09-17
> 状态：PR B PRE-MERGE VERIFIED; FINAL COMPLETION REQUIRES POST-MERGE MAIN 6/6

## 1. PR A — Critical API E2E Stabilization
- actual PR number / merge SHA
- actual Critical test count
- actual 3 clean-run evidence
- Auth session pagination drift fixed
- proof PR A did not change CI/branch protection

## 2. Critical Suite Coverage
- Auth / Session
- Tenant / Workspace isolation
- Record CRUD / permission
- Workflow Transition
- Action atomicity rollback

## 3. PR B — Hosted CI
- actual run id / exact head SHA
- six jobs and their conclusions
- Critical job actual steps and test count

## 4. Branch Protection
- six required contexts read back
- strict/up-to-date retained
- admin enforcement/everyone retained
- force-push/deletion disabled

## 5. Post-merge final gate
At this document commit time PR B has not yet merged, so no main run id is claimed.
Engineering Gate Hardening becomes COMPLETED only after the merged PR B main run has all six required jobs green.
Final main run evidence will be recorded on the merged PR discussion/verification report; no third docs-only PR is created solely to store that run id.

## 6. Next Roadmap Stage
AI Assistant V1A remains PLANNED and is not auto-promoted.
```

Do not insert fake/placeholder run ids; write only real values and the explicit truthful not-yet-observable statement above.

- [ ] **Step 2: Update HANDOFF**

Record:

```text
PR A merged
PR B hosted six-job run green on exact head
branch protection required contexts = six
Engineering Gate Hardening is pending only PR B merge + post-merge main 6/6
AI Assistant V1A remains PLANNED
```

Do not claim `COMPLETED` yet if PR B is still open.

- [ ] **Step 3: Update Lean Roadmap carefully**

Keep Engineering Gate Hardening `ACTIVE` while PR B is open. Add a note that Gate V2 is implemented on PR B head and final completion requires merge + main 6/6. Do **not** mark AI V1A ACTIVE.

- [ ] **Step 4: Commit the final docs**

```bash
git add \
  docs/audits/2026-09-17/engineering-gate-hardening-acceptance.md \
  HANDOFF.md \
  docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md
git commit -m "docs: record engineering gate hardening evidence"
```

- [ ] **Step 5: Push the docs commit only with existing user authorization for PR updates**

This new head must trigger CI again after branch protection already requires `Critical API E2E`.

---

### Task 7: Verify the final PR B head under all six required checks

**Files:**
- No new edits unless a documentation typo is found.

**Interfaces:**
- Produces: final merge approval evidence for PR B.

- [ ] **Step 1: Wait for the new head's hosted workflow**

Confirm the run is tied to the exact final docs commit SHA.

- [ ] **Step 2: Verify all six jobs are green**

Required:

```text
Typecheck              success
Contracts              success
Unit Tests             success
Database Integration   success
Build                  success
Critical API E2E       success
```

- [ ] **Step 3: Verify branch protection sees all six as required for this head**

Read back required contexts again and confirm the PR is mergeable only with these six satisfied.

- [ ] **Step 4: Perform final scope/code review**

Run/inspect:

```bash
git diff --name-only origin/main...HEAD
```

Expected PR B scope only:

```text
.github/workflows/ci.yml
HANDOFF.md
docs/audits/2026-09-17/engineering-gate-hardening-acceptance.md
docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md
docs/superpowers/plans/2026-09-17-critical-api-e2e-gate-promotion-implementation.md
```

No `apps/**` / `packages/**` changes.

- [ ] **Step 5: Stop for explicit merge approval**

Report final head SHA, six hosted conclusions, branch-protection read-back, and review result. Do not merge until the user explicitly authorizes it.

---

### Task 8: Merge PR B and perform post-merge `main` verification

**Prerequisite:** user explicitly authorizes normal PR merge. Do not squash/rebase unless the user explicitly changes the repository merge policy for this PR; follow the repository's approved normal merge method.

**Files:**
- No repository changes in this task.

**Interfaces:**
- Produces: final Engineering Gate Hardening completion evidence or a fail-closed stop if `main` is red.

- [ ] **Step 1: Merge PR B normally after all six required checks are green**

Do not bypass branch protection.

- [ ] **Step 2: Wait for the `push` workflow on the actual merge/main commit**

Verify the run's `head_branch=main` and `head_sha` equals the actual merged `main` commit.

- [ ] **Step 3: Verify all six `main` jobs are success**

Require:

```text
Typecheck              success
Contracts              success
Unit Tests             success
Database Integration   success
Build                  success
Critical API E2E       success
```

If any job fails, Engineering Gate Hardening remains ACTIVE/not completed. Stop and report; do not start AI V1A.

- [ ] **Step 4: Re-read final `main` protection**

Confirm required contexts remain exactly the six expected names and existing protection remains intact.

- [ ] **Step 5: Record post-merge evidence without a third docs PR**

Add a comment to the merged PR B (or the repository's accepted discussion record) containing:

```text
Post-merge main verification
main SHA: copy the exact merged `origin/main` SHA observed after merge
workflow run: copy the exact `main` push run URL/id observed after merge
Typecheck: success
Contracts: success
Unit Tests: success
Database Integration: success
Build: success
Critical API E2E: success
branch protection: six required contexts confirmed
Engineering Gate Hardening: COMPLETED
AI Assistant V1A: remains PLANNED
```

This comment is the final post-merge evidence required by the Design; do not create a third docs-only PR solely for this run id.

- [ ] **Step 6: Report final state to the user**

Final report must distinguish repository docs from post-merge evidence:

```text
Engineering Gate Hardening = COMPLETED
Required Gate V2 = 6 checks
PR A = merged
PR B = merged
main post-merge = 6/6 green
AI Assistant V1A = PLANNED, not started
```

---

## PR B / Stage Exit Criteria

Engineering Gate Hardening is complete only when all are true:

```text
PR A merged
Critical suite stable and present on main
PR B merged
Critical API E2E hosted job exists and is hard-fail
main required contexts = exactly 6
branch protection remains enforced
final PR B head = 6/6 green
post-merge main run = 6/6 green
post-merge verification recorded on merged PR
AI Assistant V1A remains PLANNED
```

If the post-merge `main` run is not all green, do not claim completion.
