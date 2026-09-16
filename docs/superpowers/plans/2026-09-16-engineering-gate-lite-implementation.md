# Engineering Gate Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five trustworthy GitHub required checks—Typecheck, Contracts, Unit Tests, Database Integration, and Build—and protect `main` so pull requests cannot merge unless those checks pass.

**Architecture:** One GitHub Actions workflow runs five independent jobs on pull requests and pushes to `main`. Four jobs reuse the repository's existing root scripts; the database job starts the repository's PostgreSQL 18 Compose service and runs the existing real integration suite with separate admin and `crm_app` runtime URLs. Branch protection is enabled only after those check names have successfully appeared on GitHub.

**Tech Stack:** GitHub Actions, Node.js 24, pnpm 11.19.0, Docker Compose, PostgreSQL 18, Prisma 7, Jest / Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-16-engineering-gate-lite-design.md`

## Global Constraints

- Baseline from current `origin/main`; do not reset, rebase, force-push, or deploy.
- Do not modify `apps/web/src/app/(auth)/register/page.tsx`, `chat会话.md`, or `.superpowers/sdd/2026-08-26-platform-business-template-designer/progress.md`.
- Do not fix Auth E2E, repo-wide lint debt, Worker/Redis, or unrelated product code in this task.
- Required check display names are exactly: `Typecheck`, `Contracts`, `Unit Tests`, `Database Integration`, `Build`.
- CI runtime is Node.js 24 and pnpm 11.19.0.
- CI installs with `pnpm install --frozen-lockfile`.
- Database integration uses only ephemeral test credentials; no production secret is required or allowed.
- Do not enable branch protection until the five checks have actually run successfully on GitHub.
- If repository admin permission is unavailable, do not weaken the requirement; report the exact manual branch-protection steps instead.
- Do not use `continue-on-error: true` on any required job.
- API Critical E2E remains a documented follow-up, not a hidden omission.
- Push / PR creation happens only when the user explicitly requests it.

---

## File Structure

**Create**

```text
.github/workflows/ci.yml
docs/superpowers/specs/2026-09-16-engineering-gate-lite-design.md
docs/superpowers/plans/2026-09-16-engineering-gate-lite-implementation.md
docs/audits/2026-09-16/engineering-gate-lite-acceptance.md   # only at final acceptance
```

**Modify after evidence exists**

```text
HANDOFF.md
docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md
```

**Do not modify for the implementation**

```text
apps/**
packages/**
compose.yaml
infrastructure/postgres/init/**
```

If CI exposes a real repository defect that requires changing one of those paths, stop and report it as a separate task rather than silently expanding scope.

---

### Task 0: Establish the baseline and isolated branch

**Files:**
- Read: `HANDOFF.md`
- Read: `package.json`
- Read: `packages/database/package.json`
- Read: `compose.yaml`
- Read: `infrastructure/postgres/init/001-create-app-role.sql`
- No source modifications.

**Interfaces:**
- Consumes: current `origin/main`
- Produces: isolated branch/worktree and recorded baseline results

- [ ] **Step 1: Refresh repository facts**

Run:

```bash
git fetch origin
git status --short --branch
git log -10 --oneline
git rev-parse origin/main
```

Expected:

- working tree facts are visible;
- no assumption is made from an old HANDOFF SHA.

- [ ] **Step 2: Create an isolated worktree**

Use the repository's normal worktree workflow:

```bash
git worktree add .worktrees/engineering-gate-lite -b chore/engineering-gate-lite origin/main
cd .worktrees/engineering-gate-lite
```

Do not copy a project `.env` into this worktree for CI development.

- [ ] **Step 3: Confirm the required scripts**

Run:

```bash
node -p "require('./package.json').packageManager"
node -p "require('./package.json').engines.node"
node -p "require('./packages/database/package.json').scripts['test:integration']"
```

Expected:

```text
pnpm@11.19.0
>=24
tsc -p tsconfig.json && node --test --test-concurrency=1 test/integration/*.test.mjs
```

If these facts changed on current main, stop and update the design before implementation.

- [ ] **Step 4: Install dependencies and build internal package prerequisites**

Run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @crm/contracts --filter @crm/database build
```

Expected: exit 0.

- [ ] **Step 5: Record the local Gate baseline**

Run separately:

```bash
pnpm typecheck
pnpm contracts:check
pnpm test
pnpm build
```

Record each exit code and actual test count in a temporary local note; do not invent counts in the acceptance document.

If one of these commands is red on current main, stop. The Gate must not be introduced by silently marking a baseline failure as allowed.

- [ ] **Step 6: Prove the database integration baseline locally**

Start only PostgreSQL:

```bash
docker compose up -d --wait postgres
```

Run:

```bash
TEST_DATABASE_ADMIN_URL="postgresql://crm:crm@localhost:5432/crm?schema=public" \
TEST_DATABASE_URL="postgresql://crm_app:crm_app@localhost:5432/crm?schema=public" \
pnpm --filter @crm/database test:integration
```

Then:

```bash
docker compose down -v
```

Expected: integration suite exits 0.

If the suite fails on current main, capture the exact failure and stop instead of weakening the CI job.

---

### Task 1: Add the five-job CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes:
  - root `pnpm typecheck`
  - root `pnpm contracts:check`
  - root `pnpm test`
  - root `pnpm build`
  - `pnpm --filter @crm/database test:integration`
- Produces GitHub check names:
  - `Typecheck`
  - `Contracts`
  - `Unit Tests`
  - `Database Integration`
  - `Build`

- [ ] **Step 1: Create `.github/workflows/ci.yml` with stable top-level behavior**

Use exactly this top-level shape:

```yaml
name: CI

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

env:
  CI: "true"
```

Do not add write permissions.

- [ ] **Step 2: Add the `Typecheck` job**

Add:

```yaml
jobs:
  typecheck:
    name: Typecheck
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

      - name: Build internal prerequisites
        run: pnpm --filter @crm/contracts --filter @crm/database build

      - name: Typecheck
        run: pnpm typecheck
```

- [ ] **Step 3: Add the `Contracts` job**

Add a sibling job with the same checkout/pnpm/node/install/bootstrap steps and:

```yaml
  contracts:
    name: Contracts
```

Final command:

```yaml
      - name: Check generated contracts
        run: pnpm contracts:check
```

Do not replace the repository's `contracts:check` with a CI-only implementation.

- [ ] **Step 4: Add the `Unit Tests` job**

Add a sibling job with:

```yaml
  unit-tests:
    name: Unit Tests
```

and the same checkout/pnpm/node/install/bootstrap steps.

Final command:

```yaml
      - name: Run workspace tests
        run: pnpm test
```

Do not invoke `apps/api test:e2e` here.

- [ ] **Step 5: Add the `Build` job**

Add:

```yaml
  build:
    name: Build
    runs-on: ubuntu-24.04
    timeout-minutes: 20
```

Use checkout, pnpm setup, node setup and frozen install.

Final command:

```yaml
      - name: Build
        run: pnpm build
```

Do not set `NODE_ENV=development`.

- [ ] **Step 6: Add the `Database Integration` job**

Add:

```yaml
  database-integration:
    name: Database Integration
    runs-on: ubuntu-24.04
    timeout-minutes: 20
```

Use checkout, pnpm setup, node setup and frozen install.

Then:

```yaml
      - name: Start PostgreSQL
        run: docker compose up -d --wait postgres

      - name: Build database package
        run: pnpm --filter @crm/database build

      - name: Run database integration tests
        env:
          TEST_DATABASE_ADMIN_URL: postgresql://crm:crm@localhost:5432/crm?schema=public
          TEST_DATABASE_URL: postgresql://crm_app:crm_app@localhost:5432/crm?schema=public
        run: pnpm --filter @crm/database test:integration

      - name: Show PostgreSQL logs on failure
        if: failure()
        run: docker compose logs --no-color postgres

      - name: Stop PostgreSQL
        if: always()
        run: docker compose down -v
```

The runtime URL must use `crm_app`, not `crm`.

- [ ] **Step 7: Inspect the final workflow for forbidden weakening**

Run:

```bash
grep -n "continue-on-error" .github/workflows/ci.yml || true
grep -nE "pull_request_target|contents: write|packages: write|deployments: write" .github/workflows/ci.yml || true
```

Expected: no matches.

- [ ] **Step 8: Syntax/format sanity-check**

Run:

```bash
git diff --check
sed -n '1,260p' .github/workflows/ci.yml
```

Expected: no whitespace errors and all five names appear exactly once as job display names.

- [ ] **Step 9: Commit the workflow**

Stage only the workflow:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add required engineering gates"
```

Do not push yet unless explicitly requested.

---

### Task 2: Locally re-run the same five gates after the workflow change

**Files:**
- No new source files.
- Verify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1 workflow
- Produces: local equivalence evidence for every intended required check

- [ ] **Step 1: Run Typecheck equivalent**

```bash
pnpm --filter @crm/contracts --filter @crm/database build
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run Contracts equivalent**

```bash
pnpm --filter @crm/contracts --filter @crm/database build
pnpm contracts:check
```

Expected: exit 0 and no generated contract diff.

- [ ] **Step 3: Run Unit Tests equivalent**

```bash
pnpm --filter @crm/contracts --filter @crm/database build
pnpm test
```

Expected: exit 0. Record actual suite/test counts.

- [ ] **Step 4: Run Build equivalent**

```bash
pnpm build
```

Expected: exit 0.

- [ ] **Step 5: Run Database Integration equivalent**

```bash
docker compose up -d --wait postgres

TEST_DATABASE_ADMIN_URL="postgresql://crm:crm@localhost:5432/crm?schema=public" \
TEST_DATABASE_URL="postgresql://crm_app:crm_app@localhost:5432/crm?schema=public" \
pnpm --filter @crm/database test:integration

docker compose down -v
```

Expected: exit 0. Record actual test count.

- [ ] **Step 6: Verify no CI task changed product files**

Run:

```bash
git status --short
git diff --name-only origin/main...HEAD
```

At this point expected tracked implementation diff:

```text
.github/workflows/ci.yml
```

plus the approved Engineering Gate documentation if it has been added on the same branch.

If `apps/**` or `packages/**` changed, stop and inspect why.

---

### Task 3: Publish a PR and verify GitHub-hosted behavior

**Files:**
- No code changes unless the workflow itself has a CI-specific defect.
- Do not modify product code to make CI green.

**Interfaces:**
- Consumes: Task 1 workflow committed on `chore/engineering-gate-lite`
- Produces: five real GitHub check runs

> This task requires the user's explicit permission to push/open a PR. If permission has not been given, stop here and report that Tasks 0–2 are ready.

- [ ] **Step 1: Push the feature branch**

After explicit approval:

```bash
git push -u origin chore/engineering-gate-lite
```

- [ ] **Step 2: Open a pull request to `main`**

Suggested title:

```text
ci: add engineering gate lite
```

PR body must state:

```text
Required checks introduced:
- Typecheck
- Contracts
- Unit Tests
- Database Integration
- Build

Not included yet:
- API Critical E2E (separate Engineering Gate Hardening follow-up)
- repo-wide lint
- browser E2E
- deployment
```

- [ ] **Step 3: Wait for all five GitHub jobs**

Verify the PR displays exactly:

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
```

All must be green.

Do not infer success from local tests.

- [ ] **Step 4: Validate cancellation behavior**

Push a documentation-only commit, then immediately push another documentation-only commit if needed to create overlap.

Expected: the older in-progress workflow run is cancelled and the newest commit continues.

Do not manufacture product changes only for this test.

- [ ] **Step 5: Inspect Database Integration logs**

Confirm from GitHub log that it:

1. starts `postgres:18-alpine` via Compose;
2. runs migrations through the integration helper;
3. connects runtime tests with `crm_app`;
4. runs the actual integration suite;
5. tears the Compose volume down.

- [ ] **Step 6: Fix only workflow defects**

If a GitHub-specific issue occurs—e.g. Docker Compose command availability or cache setup—edit only:

```text
.github/workflows/ci.yml
```

unless evidence proves a repository script itself is broken on clean Linux.

Commit each real CI fix separately:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fix engineering gate runner setup"
```

If product code or tests need modification, stop and split that into a separate task.

---

### Task 4: Merge CI first, then enable `main` protection

**Files:**
- Repository settings, not product files.

**Interfaces:**
- Consumes: a merged CI workflow whose five check names have run successfully
- Produces: protected `main`

> Do not execute this task until the workflow PR is merged and the five check contexts exist in GitHub.

- [ ] **Step 1: Confirm the CI workflow exists on `main`**

Run:

```bash
git fetch origin
git show origin/main:.github/workflows/ci.yml >/dev/null
```

Expected: exit 0.

- [ ] **Step 2: Confirm all five check names have appeared on GitHub**

Use GitHub UI or `gh` to inspect the merged/PR commit.

Required exact names:

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
```

- [ ] **Step 3: Enable branch protection**

Configure `main`:

```text
Require a pull request before merging = ON
Required approving reviews = 0
Require status checks before merging = ON
Require branches to be up to date before merging = ON
Required checks = Typecheck, Contracts, Unit Tests, Database Integration, Build
Allow force pushes = OFF
Allow deletions = OFF
```

If the authenticated CLI has repository administration permission, it may apply the equivalent GitHub API configuration.

If it does not, stop and report the exact settings above for the owner to apply manually.

Do not substitute a weaker configuration.

- [ ] **Step 4: Read branch state back**

Verify through GitHub UI/API that:

```text
protected = true
```

and the required checks match the five names.

Do not claim protection is enabled from the write request alone; read it back.

---

### Task 5: Record acceptance and close the stage

**Files:**
- Create: `docs/audits/2026-09-16/engineering-gate-lite-acceptance.md`
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`

**Interfaces:**
- Consumes:
  - local Gate outputs
  - real GitHub Actions runs
  - read-back branch protection state
- Produces:
  - durable observed acceptance record
  - next-stage state

- [ ] **Step 1: Write the acceptance document using observed facts only**

The document must include:

```text
baseline SHA
workflow commit / merge commit
five GitHub check names
GitHub run URLs or run identifiers
actual unit test counts
actual DB integration test counts
typecheck exit status
contracts check result
build result
branch protection read-back
known exclusions
```

Known exclusions must explicitly say:

```text
API Critical E2E is not a required check yet.
Auth E2E has historical response-shape drift and was not silently waived.
repo-wide lint is not required yet.
```

Do not copy old counts from Action Engine acceptance.

- [ ] **Step 2: Update Lean Roadmap**

Change Engineering Gate Lite from:

```text
PLANNED
```

to:

```text
COMPLETED
```

only after branch protection read-back succeeds.

Add/retain a follow-up note:

```text
Engineering Gate Hardening:
Critical API E2E → PLANNED, not ACTIVE.
```

Do not Promote Sales Workbench automatically.

- [ ] **Step 3: Update HANDOFF**

Record:

- CI now exists;
- main protection state;
- five required checks;
- Database Integration uses real PostgreSQL and non-bypass-RLS app role;
- API Critical E2E remains follow-up;
- next major product Task is still not active until user approval.

- [ ] **Step 4: Verify documentation consistency**

Run:

```bash
git diff --check
git diff --name-only
grep -R "Engineering Gate Lite" HANDOFF.md docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md docs/audits/2026-09-16/engineering-gate-lite-acceptance.md
```

Expected final documentation changes only in the three approved doc paths.

- [ ] **Step 5: Commit closeout docs**

```bash
git add \
  HANDOFF.md \
  docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md \
  docs/audits/2026-09-16/engineering-gate-lite-acceptance.md

git commit -m "docs: close engineering gate lite"
```

Push only with explicit user approval.

---

## Definition of Done

Engineering Gate Lite is complete only when all are true:

```text
[ ] CI workflow is on main
[ ] Typecheck required
[ ] Contracts required
[ ] Unit Tests required
[ ] Database Integration required
[ ] Build required
[ ] main branch protection read-back says protected
[ ] stale branches must update
[ ] force pushes disabled
[ ] branch deletion disabled
[ ] acceptance document contains real observed evidence
[ ] HANDOFF and Lean Roadmap are synchronized
[ ] API Critical E2E follow-up remains explicitly PLANNED
```

Anything less is an incomplete Gate, not “mostly done”.
