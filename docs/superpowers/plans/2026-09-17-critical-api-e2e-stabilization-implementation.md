# Critical API E2E Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, deterministic Critical API E2E suite that protects Auth/Session, tenant isolation, Record permissions, Workflow transitions, and representative Action rollback, while fixing the known Auth E2E contract drift and leaving CI/branch protection untouched.

**Architecture:** Add one dedicated Jest E2E entry point and one minimal fixture helper under `apps/api/test`. Reuse the repository's existing Nest bootstrap, Prisma clients, session-token hashing, PostgreSQL schema, and runtime `crm_app` role. The suite drives real HTTP requests against a real PostgreSQL database but intentionally excludes heavy/full E2E cases such as deadlock manufacture, CSV replay, attachments, and onboarding.

**Tech Stack:** Node.js 24, pnpm 11.19.0, NestJS 11, Jest 30 + ts-jest, Supertest, Prisma 7, PostgreSQL 18, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-17-engineering-gate-hardening-design.md`

## Global Constraints

- Baseline at plan-writing time is `main` @ `abb1c2baf337e8c408439489fef4fddebb1f9d72`; at execution time refresh `origin/main` and record the actual baseline before editing.
- This is **PR A — Critical API E2E Stabilization**. Do not modify `.github/workflows/**`, branch protection, required contexts, or deployment configuration.
- If a Critical test exposes a real product/security/contract defect under `apps/api/src/**`, `apps/web/**`, or `packages/**`, **STOP and report it**. Fix it in a separate bugfix PR; do not fold product fixes into this PR.
- Test drift is in scope. The known `/api/v1/me/sessions` assertion may be updated from the historical array shape to the current paginated `{ items, page, limit, total }` contract.
- Do not use Jest retry, `--forceExit`, `sleep`, `continue-on-error`, or any mechanism that hides resource leaks/flakiness.
- Critical E2E must use real PostgreSQL. API runtime uses `TEST_DATABASE_URL` with `crm_app` / `NOBYPASSRLS`; migration/fixture administration uses the admin URL only where required.
- Critical E2E continues to use `apps/api/test/jest-e2e.json`, including `maxWorkers: 1`.
- Keep the Critical suite small: exactly the five security/transaction themes from the Design, with about 5–7 tests total and a target runtime under 3 minutes per clean run.
- Fixed test tenant/object/phone identifiers are allowed. Prefer fixed UTC timestamps over wall-clock-relative time.
- Do not reset, rebase, force-push, or deploy.
- Do not edit these protected files:
  - `apps/web/src/app/(auth)/register/page.tsx`
  - `chat会话.md`
  - `.superpowers/sdd/2026-08-26-platform-business-template-designer/progress.md`
- Do not start AI Assistant V1A/V1B.
- Push, PR creation, and merge require explicit user authorization. Local commits are allowed while executing this plan.

---

## File Structure

**Create**

- `apps/api/test/critical-api.e2e-spec.ts` — the only Critical API E2E suite selected by `test:e2e:critical`.
- `apps/api/test/helpers/critical-fixture.ts` — minimal app/database/session/object/workflow fixture used only by the Critical suite.

**Modify**

- `apps/api/package.json` — add `test:e2e:critical` without changing the existing `test:e2e` command.
- `apps/api/test/auth.e2e-spec.ts` — update the historical `/me/sessions` array assertion to the live paginated contract; no product behavior change.
- `HANDOFF.md` — mark Engineering Gate Hardening as ACTIVE only when implementation starts; record PR A scope and the two-PR discipline.
- `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md` — mark Engineering Gate Hardening ACTIVE during PR A; keep AI Assistant V1A PLANNED.
- `docs/superpowers/specs/2026-09-17-engineering-gate-hardening-design.md` — only if the approved spec is not yet present in the repository; copy it verbatim from the approved artifact, status `APPROVED FOR IMPLEMENTATION`.
- `docs/superpowers/plans/2026-09-17-critical-api-e2e-stabilization-implementation.md` — commit this plan verbatim if not already present.

**Must not change in PR A**

- `.github/workflows/ci.yml`
- GitHub branch protection / required status checks
- production/API implementation files solely to make tests pass

---

### Task 1: Establish the PR A baseline and activate Engineering Gate Hardening

**Files:**
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`
- Create/verify: `docs/superpowers/specs/2026-09-17-engineering-gate-hardening-design.md`
- Create/verify: `docs/superpowers/plans/2026-09-17-critical-api-e2e-stabilization-implementation.md`

**Interfaces:**
- Consumes: current protected `main` and the approved Engineering Gate Hardening Design.
- Produces: a branch/worktree whose documentation says Hardening is ACTIVE, PR A is stabilization-only, and AI V1A remains PLANNED.

- [ ] **Step 1: Refresh and record the baseline without rewriting history**

Run:

```bash
git fetch origin
git status --short --branch
git log -5 --oneline origin/main
```

Expected: clean enough to create an isolated worktree; record the current `origin/main` SHA. Do not use `reset`, `rebase`, or force operations.

- [ ] **Step 2: Create an isolated worktree/branch for PR A**

Use the repository's normal worktree workflow. Suggested branch:

```text
feat/critical-api-e2e-stabilization
```

Suggested worktree:

```text
.worktrees/critical-api-e2e-stabilization
```

- [ ] **Step 3: Update lifecycle docs**

In the Lean Roadmap, change only the Engineering Gate Hardening state from `PLANNED` to `ACTIVE` and keep the sequence:

```text
Engineering Gate Lite        ✅ COMPLETED
Sales Workbench Lite         ✅ COMPLETED
Engineering Gate Hardening   ACTIVE
AI Assistant V1A             PLANNED
AI Assistant V1B             PLANNED
Production Essentials        PLANNED
```

In `HANDOFF.md`, record:

```text
Current task: Engineering Gate Hardening — PR A Critical API E2E Stabilization
Scope: stabilize dedicated Critical API E2E only; no CI/branch-protection change
Next after PR A merge: PR B Critical API E2E Gate Promotion
AI Assistant V1A remains PLANNED
```

- [ ] **Step 4: Verify protected files are untouched**

Run:

```bash
git status --short
```

Expected: no protected path is listed.

- [ ] **Step 5: Commit the lifecycle/design/plan activation**

```bash
git add HANDOFF.md \
  docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md \
  docs/superpowers/specs/2026-09-17-engineering-gate-hardening-design.md \
  docs/superpowers/plans/2026-09-17-critical-api-e2e-stabilization-implementation.md
git commit -m "docs: activate engineering gate hardening"
```

---

### Task 2: Add the dedicated Critical API E2E command

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/test/critical-api.e2e-spec.ts`

**Interfaces:**
- Consumes: existing `apps/api/test/jest-e2e.json`.
- Produces: `pnpm --filter @crm/api test:e2e:critical`, selecting only `test/critical-api.e2e-spec.ts`.

- [ ] **Step 1: Create the empty Critical suite shell**

Create `apps/api/test/critical-api.e2e-spec.ts` with a temporary deterministic smoke assertion so the command can be wired before the real scenarios are added:

```ts
describe('Critical API E2E', () => {
  it('is wired to the dedicated critical command', () => {
    expect(true).toBe(true);
  });
});
```

This temporary test must be removed by Task 7; it must not survive final PR A review.

- [ ] **Step 2: Add the package script**

Add exactly this sibling script in `apps/api/package.json` while preserving existing `test:e2e`:

```json
"test:e2e:critical": "NODE_OPTIONS=--experimental-vm-modules jest --config ./test/jest-e2e.json --runTestsByPath test/critical-api.e2e-spec.ts"
```

- [ ] **Step 3: Verify only the Critical file runs**

Run:

```bash
pnpm --filter @crm/api test:e2e:critical
```

Expected:

```text
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

No other E2E file may appear.

- [ ] **Step 4: Commit the dedicated entry point**

```bash
git add apps/api/package.json apps/api/test/critical-api.e2e-spec.ts
git commit -m "test: add critical api e2e entry point"
```

---

### Task 3: Fix the historical Auth E2E session-list contract drift

**Files:**
- Modify: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: live endpoint `GET /api/v1/me/sessions?kind=ACTIVE&page=1&limit=100` returning `{ items, page, limit, total }`.
- Produces: the existing Auth E2E aligned to the current contract, without changing API implementation.

- [ ] **Step 1: Start a fresh isolated PostgreSQL for focused Auth E2E**

Create a temporary compose override outside the repo so local services on 5432 are not reused:

```bash
cat >/tmp/crm-critical-postgres.yml <<'YAML'
services:
  postgres:
    ports:
      - "55434:5432"
YAML

docker compose -p crm-critical-auth \
  -f compose.yaml -f /tmp/crm-critical-postgres.yml \
  up -d --wait postgres
```

- [ ] **Step 2: Deploy migrations to the isolated database**

```bash
DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
  pnpm --filter @crm/database prisma:migrate:deploy
```

- [ ] **Step 3: Reproduce the known failure before editing**

```bash
DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
TEST_DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
TEST_DATABASE_URL='postgresql://crm_app:crm_app@localhost:55434/crm?schema=public' \
pnpm --filter @crm/api test:e2e -- \
  --runTestsByPath test/auth.e2e-spec.ts
```

Expected before the fix: failure around the old `sessions.body` array/`toHaveLength(2)` assumption. If the failure is a product behavior mismatch instead, STOP and report it as a separate product bug.

- [ ] **Step 4: Replace the array assertion with the paginated contract**

Update the session section to query the active page and assert the container before reading items:

```ts
const sessions = await second
  .get('/api/v1/me/sessions?kind=ACTIVE&page=1&limit=100')
  .expect(200);

expect(sessions.body).toMatchObject({
  page: 1,
  limit: 100,
  total: 2,
});

const sessionPage = sessions.body as {
  items: Array<Record<string, unknown>>;
  page: number;
  limit: number;
  total: number;
};
expect(sessionPage.items).toHaveLength(2);
expect(sessionPage.items[0]).not.toHaveProperty('tokenHash');

const oldSession = sessionPage.items.find(
  (item) => item.deviceSummary === 'Chrome / macOS',
);
expect(oldSession).toBeDefined();
const oldSessionId = oldSession?.id;
expect(typeof oldSessionId).toBe('string');
```

Keep the existing revoke assertion: deleting the first browser's session causes the first agent's `/api/v1/me` to become 401.

- [ ] **Step 5: Re-run the focused Auth E2E**

Use the same environment command as Step 3.

Expected:

```text
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

- [ ] **Step 6: Tear down the isolated DB**

```bash
docker compose -p crm-critical-auth \
  -f compose.yaml -f /tmp/crm-critical-postgres.yml \
  down -v
```

- [ ] **Step 7: Commit the test-only drift fix**

```bash
git add apps/api/test/auth.e2e-spec.ts
git commit -m "test: align auth e2e with paginated sessions"
```

---

### Task 4: Build the minimal Critical fixture and tenant-isolation scenario

**Files:**
- Create: `apps/api/test/helpers/critical-fixture.ts`
- Modify: `apps/api/test/critical-api.e2e-spec.ts`

**Interfaces:**
- Produces these test-only exports:

```ts
export interface CriticalActor {
  userId: string;
  memberId: string;
  cookie: string;
}

export interface CriticalHarness {
  app: INestApplication<App>;
  adminDatabase: PrismaClient;
  runtimeDatabase: PrismaClient;
}

export interface CriticalFixture {
  tenantA: { id: string; code: string };
  tenantB: { id: string; code: string };
  admin: CriticalActor;
  employee: CriticalActor;
  otherEmployee: CriticalActor;
  object: { id: string; code: string };
  ownedRecord: { id: string; version: number };
  otherRecord: { id: string; version: number };
  workflowRecord: { id: string; version: number };
  rollbackObject: { id: string; code: string };
  rollbackTargetObject: { id: string; code: string };
  rollbackRecord: { id: string; version: number };
}

export async function createCriticalHarness(): Promise<CriticalHarness>;
export async function provisionCriticalFixture(
  harness: CriticalHarness,
): Promise<CriticalFixture>;
export async function closeCriticalHarness(
  harness: CriticalHarness,
): Promise<void>;
```

The helper may add small private functions, but do not export a generic factory DSL.

- [ ] **Step 1: Write the tenant-isolation Critical test first**

Replace the temporary smoke-only suite with the real harness lifecycle and this first failing case:

```ts
describe('Critical API E2E', () => {
  let harness: CriticalHarness;
  let fixture: CriticalFixture;

  beforeAll(async () => {
    harness = await createCriticalHarness();
  });

  beforeEach(async () => {
    fixture = await provisionCriticalFixture(harness);
  });

  afterAll(async () => {
    await closeCriticalHarness(harness);
  });

  it('rejects a valid tenant A actor from tenant B workspace data', async () => {
    const before = await harness.adminDatabase.record.count({
      where: { tenantId: fixture.tenantB.id },
    });

    await request(harness.app.getHttpServer())
      .get(
        `/api/v1/workspaces/${fixture.tenantB.code}/objects/${fixture.object.code}/records`,
      )
      .set('Cookie', fixture.employee.cookie)
      .expect(403);

    expect(
      await harness.adminDatabase.record.count({
        where: { tenantId: fixture.tenantB.id },
      }),
    ).toBe(before);
  });
});
```

At this point imports/helper functions do not exist, so the test must fail to compile/run.

- [ ] **Step 2: Implement `createCriticalHarness()`**

It must:

```ts
process.env.NODE_ENV = 'test';
process.env.DEV_VERIFICATION_CODE = '123456';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.DATABASE_URL = requiredEnvironment('TEST_DATABASE_URL');
```

Then:

```ts
const { createDatabaseClient } = await import('@crm/database');
const adminDatabase = createDatabaseClient(
  requiredEnvironment('TEST_DATABASE_ADMIN_URL'),
);
const runtimeDatabase = createDatabaseClient(
  requiredEnvironment('TEST_DATABASE_URL'),
);
const app = (await createApp()) as INestApplication<App>;
```

Return `{ app, adminDatabase, runtimeDatabase }`.

- [ ] **Step 3: Implement deterministic cleanup/provisioning**

Use direct admin-DB seeding only for fixture/config setup. The runtime behavior under test must still go through HTTP with real session cookies.

Provision exactly:

```text
Tenant A code: critical-a
Tenant B code: critical-b
Admin + employee + other employee in Tenant A
At least one valid Tenant B member/data row
One published object code: leads
Employee object permission: create/read/update=true, readScope=OWN, updateScope=OWN
Field access: name=EDIT, secret=HIDDEN
Two Tenant A records: ownedRecord(employee-owned), otherRecord(otherEmployee-owned)
One workflowRecord for Task 6
One rollback source object code: deals
One rollback target object code: invoices
One rollbackRecord for Task 7
```

Create session cookies using the same repository-supported token hashing pattern already used by existing API E2E tests (`hashSessionToken`), but do not import private helpers from other E2E spec files.

- [ ] **Step 4: Implement `closeCriticalHarness()`**

It must close every owned resource without `--forceExit`:

```ts
await app.close();
await Promise.allSettled([
  adminDatabase.$disconnect(),
  runtimeDatabase.$disconnect(),
]);
```

- [ ] **Step 5: Run the single tenant-isolation test**

With a migrated isolated DB:

```bash
DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
TEST_DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
TEST_DATABASE_URL='postgresql://crm_app:crm_app@localhost:55434/crm?schema=public' \
pnpm --filter @crm/api test:e2e:critical -- \
  -t 'rejects a valid tenant A actor from tenant B workspace data'
```

Expected: PASS. If cross-tenant access succeeds or mutates Tenant B, STOP and report a product/security bug.

- [ ] **Step 6: Commit the minimal harness + tenant boundary**

```bash
git add apps/api/test/helpers/critical-fixture.ts \
  apps/api/test/critical-api.e2e-spec.ts
git commit -m "test: cover critical tenant isolation"
```

---

### Task 5: Add the Record CRUD / permission Critical scenario

**Files:**
- Modify: `apps/api/test/critical-api.e2e-spec.ts`
- Modify only if required for fixture data: `apps/api/test/helpers/critical-fixture.ts`

**Interfaces:**
- Consumes: `fixture.employee`, `fixture.object`, `ownedRecord`, `otherRecord`.
- Produces: one deterministic test covering create/read/OWN scope/hidden field/update/stale version.

- [ ] **Step 1: Write the Critical record test**

Add one test with this behavior sequence:

```ts
it('enforces OWN scope, hidden fields, and optimistic locking on records', async () => {
  const base = `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.object.code}/records`;

  const created = await request(harness.app.getHttpServer())
    .post(base)
    .set('Cookie', fixture.employee.cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ values: { name: 'Critical lead' } })
    .expect(201);

  expect(created.body.values).toMatchObject({ name: 'Critical lead' });
  expect(created.body.values).not.toHaveProperty('secret');

  const mine = await request(harness.app.getHttpServer())
    .get(`${base}/${fixture.ownedRecord.id}`)
    .set('Cookie', fixture.employee.cookie)
    .expect(200);
  expect(mine.body.values).not.toHaveProperty('secret');

  const page = await request(harness.app.getHttpServer())
    .get(base)
    .set('Cookie', fixture.employee.cookie)
    .expect(200);
  const visibleIds = page.body.items.map((item: { id: string }) => item.id);
  expect(visibleIds).toContain(fixture.ownedRecord.id);
  expect(visibleIds).toContain(created.body.id);
  expect(visibleIds).not.toContain(fixture.otherRecord.id);

  await request(harness.app.getHttpServer())
    .get(`${base}/${fixture.otherRecord.id}`)
    .set('Cookie', fixture.employee.cookie)
    .expect(404);

  const updated = await request(harness.app.getHttpServer())
    .patch(`${base}/${created.body.id}`)
    .set('Cookie', fixture.employee.cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ version: created.body.version, values: { name: 'Updated lead' } })
    .expect(200);

  await request(harness.app.getHttpServer())
    .patch(`${base}/${created.body.id}`)
    .set('Cookie', fixture.employee.cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ version: created.body.version, values: { name: 'Stale update' } })
    .expect(409);

  expect(updated.body.values).not.toHaveProperty('secret');
});
```

If the create DTO requires `ownerMemberId`, omit it so the server applies the existing actor/default behavior rather than adding unrelated fixture complexity.

- [ ] **Step 2: Run only this case and fix fixture data, not product code**

```bash
pnpm --filter @crm/api test:e2e:critical -- \
  -t 'enforces OWN scope, hidden fields, and optimistic locking on records'
```

Expected: PASS against the isolated PostgreSQL. If a documented security boundary fails, STOP and report.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/critical-api.e2e-spec.ts \
  apps/api/test/helpers/critical-fixture.ts
git commit -m "test: cover critical record permissions"
```

---

### Task 6: Add the Workflow Transition Critical scenario

**Files:**
- Modify: `apps/api/test/critical-api.e2e-spec.ts`
- Modify: `apps/api/test/helpers/critical-fixture.ts`

**Interfaces:**
- Consumes: a minimal active publication whose workflow has initial state `new` and transition key `qualify` to state `qualified`.
- Produces: a test covering runtime read, transition execution, version/state/history write, and stale-version rejection.

- [ ] **Step 1: Extend fixture provisioning with a minimal frozen workflow**

Seed only the runtime data needed for the already-published object:

```text
states:
  new        (initial)
  qualified
transitions:
  qualify: new → qualified
  reopen: qualified → new
  allowed role = EMPLOYEE (or the current repository equivalent)
actions = []
```

The `workflowRecord` must start in `new` with `version = 1`.

- [ ] **Step 2: Write the transition test**

```ts
it('executes an allowed workflow transition and rejects a stale version', async () => {
  const path = `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.object.code}/records/${fixture.workflowRecord.id}/workflow`;

  const runtime = await request(harness.app.getHttpServer())
    .get(path)
    .set('Cookie', fixture.employee.cookie)
    .expect(200);

  expect(runtime.body.currentState).toMatchObject({ key: 'new' });
  expect(runtime.body.availableTransitions).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: 'qualify' })]),
  );

  const executed = await request(harness.app.getHttpServer())
    .post(`${path}/transitions/qualify`)
    .set('Cookie', fixture.employee.cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ expectedVersion: fixture.workflowRecord.version })
    .expect(201);

  expect(executed.body.currentState).toMatchObject({ key: 'qualified' });
  expect(executed.body.version).toBe(fixture.workflowRecord.version + 1);

  const history = await request(harness.app.getHttpServer())
    .get(`${path}/history`)
    .set('Cookie', fixture.employee.cookie)
    .expect(200);
  expect(history.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ transitionKey: 'qualify' }),
    ]),
  );

  await request(harness.app.getHttpServer())
    .post(`${path}/transitions/reopen`)
    .set('Cookie', fixture.employee.cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ expectedVersion: fixture.workflowRecord.version })
    .expect(409);
});
```

If the actual history response is a wrapped/paginated DTO, assert that documented current shape instead of changing the API. The test must not hard-code a stale historical shape.

- [ ] **Step 3: Run only the workflow case**

```bash
pnpm --filter @crm/api test:e2e:critical -- \
  -t 'executes an allowed workflow transition and rejects a stale version'
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/critical-api.e2e-spec.ts \
  apps/api/test/helpers/critical-fixture.ts
git commit -m "test: cover critical workflow transition"
```

---

### Task 7: Add the representative Action atomicity rollback scenario

**Files:**
- Modify: `apps/api/test/critical-api.e2e-spec.ts`
- Modify: `apps/api/test/helpers/critical-fixture.ts`

**Interfaces:**
- Consumes: a published transition on `rollbackRecord` with exactly two representative actions: Action 1 is permitted and writes a durable side effect if committed; Action 2 deterministically fails because the actor lacks required target permission.
- Produces: proof that the real PostgreSQL transaction rolls back source state/version, Action 1 side effect, transition history, and success-looking audits.

- [ ] **Step 1: Extend the fixture with one minimal rollback transition**

Use the smallest typed Action sequence already supported by the Action Engine. Seed `fixture.rollbackObject.code = 'deals'` and `fixture.rollbackTargetObject.code = 'invoices'` with this shape:

```text
source object: deals
source state: open
transition: close-won
Action 1: CREATE_FOLLOW_UP (permitted)
Action 2: CREATE_RECORD into object invoices (employee canCreate=false)
```

Seed only the permissions/publications required for those two actions. Do not copy deadlock/concurrency machinery from `action-engine.e2e-spec.ts`.

- [ ] **Step 2: Write the atomicity test**

```ts
it('rolls back earlier action side effects when a later action is denied', async () => {
  const auditCountBefore = await harness.adminDatabase.auditLog.count({
    where: {
      tenantId: fixture.tenantA.id,
      action: { in: ['follow_up.created', 'record.transition_executed'] },
    },
  });

  const before = await harness.adminDatabase.record.findUniqueOrThrow({
    where: { id: fixture.rollbackRecord.id },
    select: { statusKey: true, version: true, data: true, ownerMemberId: true },
  });

  const response = await request(harness.app.getHttpServer())
    .post(
      `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.rollbackObject.code}/records/${fixture.rollbackRecord.id}/workflow/transitions/close-won`,
    )
    .set('Cookie', fixture.employee.cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ expectedVersion: fixture.rollbackRecord.version });

  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ code: 'ACTION_EXECUTION_FAILED' });

  expect(
    await harness.adminDatabase.recordFollowUp.count({
      where: { recordId: fixture.rollbackRecord.id },
    }),
  ).toBe(0);

  expect(
    await harness.adminDatabase.recordTransitionHistory.count({
      where: { recordId: fixture.rollbackRecord.id },
    }),
  ).toBe(0);

  const after = await harness.adminDatabase.record.findUniqueOrThrow({
    where: { id: fixture.rollbackRecord.id },
    select: { statusKey: true, version: true, data: true, ownerMemberId: true },
  });
  expect(after).toEqual(before);

  expect(
    await harness.adminDatabase.auditLog.count({
      where: {
        tenantId: fixture.tenantA.id,
        action: { in: ['follow_up.created', 'record.transition_executed'] },
      },
    }),
  ).toBe(auditCountBefore);
});
```

Use the actual Prisma model/property names from the current schema; do not change schema names merely to match this snippet.

- [ ] **Step 3: Run only the rollback case**

```bash
pnpm --filter @crm/api test:e2e:critical -- \
  -t 'rolls back earlier action side effects when a later action is denied'
```

Expected: PASS. If an earlier Action survives or source state/version moves, STOP and report a real product defect.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/critical-api.e2e-spec.ts \
  apps/api/test/helpers/critical-fixture.ts
git commit -m "test: cover critical action atomicity"
```

---

### Task 8: Add the Critical Auth/Session scenario and remove the temporary smoke test

**Files:**
- Modify: `apps/api/test/critical-api.e2e-spec.ts`
- Modify only if cleanup helpers are useful: `apps/api/test/helpers/critical-fixture.ts`

**Interfaces:**
- Produces: a Critical Auth test using real registration/login cookies and the current paginated session contract.

- [ ] **Step 1: Add a dedicated Critical Auth test using a phone reserved for this suite**

Use a fixed phone distinct from the existing Auth E2E phone, e.g. `13911113333`, and fixed verification code `123456`.

Test flow:

```ts
it('authenticates a session and revokes another active session', async () => {
  const first = request.agent(harness.app.getHttpServer());
  const second = request.agent(harness.app.getHttpServer());

  await first
    .post('/api/v1/auth/verification-challenges')
    .set('Origin', 'http://localhost:3000')
    .send({ phone: '13911113333', purpose: 'REGISTER', deviceKey: 'critical-one' })
    .expect(202);

  await first
    .post('/api/v1/auth/register')
    .set('Origin', 'http://localhost:3000')
    .send({
      phone: '13911113333',
      code: '123456',
      displayName: 'Critical User',
      password: 'critical-password1',
      deviceSummary: 'Critical Browser One',
    })
    .expect(201);

  await first.get('/api/v1/me').expect(200);

  await second
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({
      phone: '13911113333',
      password: 'critical-password1',
      deviceKey: 'critical-two',
      deviceSummary: 'Critical Browser Two',
    })
    .expect(200);

  const sessions = await second
    .get('/api/v1/me/sessions?kind=ACTIVE&page=1&limit=100')
    .expect(200);

  expect(sessions.body).toMatchObject({ page: 1, limit: 100, total: 2 });
  expect(sessions.body.items).toHaveLength(2);
  expect(sessions.body.items[0]).not.toHaveProperty('tokenHash');

  const firstSession = sessions.body.items.find(
    (item: { deviceSummary?: string }) =>
      item.deviceSummary === 'Critical Browser One',
  );
  expect(firstSession).toBeDefined();

  await second
    .delete(`/api/v1/me/sessions/${firstSession.id}`)
    .set('Origin', 'http://localhost:3000')
    .expect(200);

  await first.get('/api/v1/me').expect(401);
});
```

Ensure the suite cleanup deletes this test user's sessions/user/challenges before the next run.

- [ ] **Step 2: Remove the Task 2 smoke assertion**

Delete:

```ts
it('is wired to the dedicated critical command', () => {
  expect(true).toBe(true);
});
```

Final Critical suite must contain only real boundary tests.

- [ ] **Step 3: Run the whole Critical suite once**

```bash
pnpm --filter @crm/api test:e2e:critical
```

Expected: one suite, approximately 5 tests, all PASS, no open-handle/forced-exit requirement.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/critical-api.e2e-spec.ts \
  apps/api/test/helpers/critical-fixture.ts
git commit -m "test: complete critical api e2e suite"
```

---

### Task 9: Prove Critical suite stability with three clean database runs

**Files:**
- No product/test changes expected. If a stability issue requires test-only changes, make them in this PR and repeat all three runs from zero.

**Interfaces:**
- Consumes: final `test:e2e:critical` suite.
- Produces: three independent green executions on fresh PostgreSQL with normal teardown.

- [ ] **Step 1: Run three complete clean cycles**

From repo root:

```bash
set -euo pipefail
cat >/tmp/crm-critical-postgres.yml <<'YAML'
services:
  postgres:
    ports:
      - "55434:5432"
YAML

for run in 1 2 3; do
  echo "=== Critical clean run ${run}/3 ==="
  docker compose -p crm-critical-stability \
    -f compose.yaml -f /tmp/crm-critical-postgres.yml \
    down -v --remove-orphans || true

  docker compose -p crm-critical-stability \
    -f compose.yaml -f /tmp/crm-critical-postgres.yml \
    up -d --wait postgres

  DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
    pnpm --filter @crm/database prisma:migrate:deploy

  DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
  TEST_DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
  TEST_DATABASE_URL='postgresql://crm_app:crm_app@localhost:55434/crm?schema=public' \
    pnpm --filter @crm/api test:e2e:critical

done

docker compose -p crm-critical-stability \
  -f compose.yaml -f /tmp/crm-critical-postgres.yml \
  down -v --remove-orphans
```

Expected: all 3 runs PASS on the same commit. Record actual test counts and runtimes; do not invent them in docs.

- [ ] **Step 2: Fail closed on any intermittent result**

If any run fails without a code change, do not rerun until green and call it done. Diagnose in this order:

```text
fixture stale data
cleanup gaps
wall-clock dependence
cookie/session sharing
test-order dependence
open async resources
unnecessary lock/concurrency behavior
```

After any test-only fix, restart the 3-run proof from run 1.

- [ ] **Step 3: Confirm no retry/force-exit/sleep was introduced**

Run:

```bash
git grep -nE 'retryTimes|--forceExit|setTimeout\(|sleep\(' -- apps/api/test/critical-api.e2e-spec.ts apps/api/test/helpers/critical-fixture.ts apps/api/package.json || true
```

Manually distinguish legitimate Jest timeout APIs if present; the Critical suite should not rely on them unless the existing global E2E config requires a bounded timeout.

---

### Task 10: Run PR A final verification and update handoff evidence

**Files:**
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md` only if wording needs to record PR A readiness; Hardening remains ACTIVE.

**Interfaces:**
- Produces: a review-ready PR A with Critical suite stable and no CI infrastructure changes.

- [ ] **Step 1: Run focused Auth E2E one final time**

Against the isolated migrated DB:

```bash
pnpm --filter @crm/api test:e2e -- \
  --runTestsByPath test/auth.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run the repository's non-DB required checks**

```bash
pnpm typecheck
pnpm contracts:check
pnpm test
pnpm build
```

Expected: all exit 0. Record actual suite/test counts from output, not historical numbers.

- [ ] **Step 3: Run Database Integration with a fresh PostgreSQL**

Use a clean PostgreSQL lifecycle and current test URLs, then:

```bash
TEST_DATABASE_ADMIN_URL='postgresql://crm:crm@localhost:55434/crm?schema=public' \
TEST_DATABASE_URL='postgresql://crm_app:crm_app@localhost:55434/crm?schema=public' \
pnpm --filter @crm/database test:integration
```

Expected: exit 0; record actual counts.

- [ ] **Step 4: Verify PR A scope mechanically**

```bash
git diff --name-only origin/main...HEAD
```

Expected changed paths are limited to PR A test/package/docs scope. In particular, this command must produce no `.github/workflows/` path.

Also run:

```bash
git diff --name-only origin/main...HEAD | grep '^\.github/workflows/' && exit 1 || true
```

- [ ] **Step 5: Update HANDOFF with observed local evidence**

Record only what was actually observed:

```text
Critical API E2E: N tests, clean-run proof 3/3 green
Auth E2E: current paginated sessions contract green
Required Gate remains 5 checks; no CI/branch-protection change in PR A
Engineering Gate Hardening remains ACTIVE
Next task after PR A merge: PR B Gate Promotion
AI V1A remains PLANNED
```

Replace `N` with the observed count.

- [ ] **Step 6: Commit final PR A docs**

```bash
git add HANDOFF.md docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md
git commit -m "docs: record critical api e2e stabilization"
```

- [ ] **Step 7: Run code review before any push/PR request**

Review specifically for:

```text
No product implementation changes
No CI workflow changes
No branch-protection changes
Five Critical themes present
No hidden retries/forceExit/sleep
Runtime DB role remains crm_app
Fixture cleanup is deterministic
```

Stop and report the branch SHA, diff, verification results, and any findings. Do **not** push/open PR until the user explicitly authorizes it.

---

## PR A Exit Criteria

PR A is ready for user-authorized push/review only when all are true:

```text
Known Auth test drift fixed as test-only change
Critical API E2E has all five required themes
Dedicated test:e2e:critical command exists
Three fresh-DB clean runs are green on one commit
No retry / --forceExit / sleep workaround
Existing 5 required-gate commands pass locally
No .github/workflows change
No branch-protection change
No product bug silently fixed in this PR
Engineering Gate Hardening remains ACTIVE
AI Assistant V1A remains PLANNED
```

After PR A is merged and `main` is refreshed, execute the separate PR B plan:

`docs/superpowers/plans/2026-09-17-critical-api-e2e-gate-promotion-implementation.md`
