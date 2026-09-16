# Sales Workbench Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing personal Follow-up capability into a fixed employee-home workbench that shows overdue, today, and next-7-calendar-day items without introducing a second task domain or a new Dashboard widget type.

**Architecture:** Add one read-only `GET /workspaces/:tenantCode/follow-ups/workbench` endpoint inside the existing Follow-up module. The endpoint derives the current actor and tenant on the server, reuses existing object/effective-access scopes, calculates tenant-calendar buckets on the API side, and returns bounded previews plus counts. The web app replaces the static Follow-up summary link with a React Query-powered personal workbench; completion continues through the existing Follow-up PATCH command path and audit/version checks.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 18/RLS, TypeScript, Next.js 16, React 19, TanStack Query 5, Ant Design 6, Jest 30, Vitest 4, OpenAPI-generated contracts.

**Spec:** `docs/superpowers/specs/2026-09-17-sales-workbench-lite-design.md`

## Global Constraints

- Implementation baseline is the latest `origin/main`; this plan was written against `aa505d37766816fc751a91280f6cd82d1153eae5`.
- `main` is protected for everyone; all changes go through a feature branch and pull request.
- Do not reset, rebase, force-push, deploy, or bypass required checks.
- Do not push or open a PR unless the user explicitly authorizes it in the execution conversation.
- Never modify:
  - `apps/web/src/app/(auth)/register/page.tsx`
  - `chat会话.md`
  - `.superpowers/sdd/2026-08-26-platform-business-template-designer/progress.md`
- Do not add a Dashboard widget type, Dashboard publication field, Prisma model, migration, Redis flow, Worker flow, Automation trigger, AI capability, team task center, supervisor view, or notification system.
- `/follow-ups/workbench` always means the current actor's personal Follow-ups. It accepts no `memberId`, `assigneeMemberId`, `userId`, `tenantId`, or role override.
- Workbench reads use tenant timezone calendar boundaries; invalid timezone fails closed.
- Workbench reads only `OPEN` Follow-ups whose linked Record remains visible to the current actor.
- Workbench completion must reuse existing `PATCH /follow-ups/:id`; no new write endpoint is allowed.
- Preview limit is exactly 5 per bucket, ordered by `dueAt ASC, id ASC`.
- Upcoming means the next 7 tenant calendar days excluding today.
- The employee personal workbench remains visible when Dashboard state is `UNCONFIGURED`.
- Tenant-admin home behavior must remain unchanged in this task.
- CI / gate infrastructure changes must not be mixed into this product PR. If a CI defect is discovered, stop and report it for a separate PR.
- API Critical E2E is not promoted in this task; Engineering Gate Hardening remains the next stage after Sales Workbench Lite.
- Use TDD for each behavior slice: failing focused test → minimal implementation → focused green test → commit.
- New tests should avoid expensive named-role queries where a stable label/text/test-id assertion is sufficient.

---

## File Structure

### Create

```text
apps/api/src/modules/follow-ups/follow-up-workbench-time.ts
apps/api/src/modules/follow-ups/follow-up-workbench-time.spec.ts
apps/web/src/features/follow-ups/follow-up-workbench.tsx
apps/web/src/features/follow-ups/follow-up-workbench.test.tsx
docs/audits/2026-09-17/sales-workbench-lite-acceptance.md   # only after real hosted acceptance
```

### Modify

```text
apps/api/src/modules/follow-ups/follow-ups.controller.ts
apps/api/src/modules/follow-ups/follow-ups.dto.ts
apps/api/src/modules/follow-ups/follow-ups.service.ts
apps/api/src/modules/follow-ups/follow-ups.service.spec.ts
apps/api/src/modules/follow-ups/follow-ups.repository.ts
apps/api/src/modules/follow-ups/follow-ups.repository.spec.ts

apps/web/src/features/follow-ups/follow-up-api.ts
apps/web/src/features/follow-ups/follow-up-panel.tsx
apps/web/src/features/follow-ups/follow-ups.module.css
apps/web/src/features/dashboard/employee-workbench.tsx
apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx
apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx

packages/contracts/openapi.json
packages/contracts/src/generated/openapi.ts

docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md
HANDOFF.md
```

### Delete after replacement is proven

```text
apps/web/src/features/follow-ups/follow-up-summary.tsx
```

Do not leave both the old static summary link and the new personal workbench on the employee home.

---

### Task 0: Refresh baseline, promote the task, and create the isolated worktree

**Files:**
- Read: `HANDOFF.md`
- Read: `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`
- Read: `docs/superpowers/briefs/2026-09-16-sales-workbench-lite-stage-brief.md`
- Read: `docs/superpowers/specs/2026-09-17-sales-workbench-lite-design.md`
- Modify only after implementation is authorized:
  - `HANDOFF.md`
  - `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`

**Interfaces:**
- Consumes: current protected `origin/main`
- Produces: `feat/sales-workbench-lite` isolated worktree and an ACTIVE task record

- [ ] **Step 1: Refresh repository state**

```bash
git fetch origin
git status --short --branch
git log -10 --oneline origin/main
git rev-parse origin/main
```

If files listed in this plan changed materially since `aa505d3`, re-read those diffs before editing.

- [ ] **Step 2: Create the isolated worktree**

```bash
git worktree add .worktrees/sales-workbench-lite -b feat/sales-workbench-lite origin/main
cd .worktrees/sales-workbench-lite
```

Do not copy a developer `.env` into the worktree.

- [ ] **Step 3: Verify runtime versions**

```bash
node --version
pnpm --version
node -p "require('./package.json').engines.node"
node -p "require('./package.json').packageManager"
```

Expected: Node 24+ and pnpm 11.19.0.

- [ ] **Step 4: Install and build internal prerequisites**

```bash
pnpm install --frozen-lockfile
pnpm --filter @crm/contracts --filter @crm/database build
```

- [ ] **Step 5: Run focused baseline tests**

```bash
pnpm --filter @crm/api test -- follow-ups.service.spec.ts follow-ups.repository.spec.ts --runInBand
pnpm --filter @crm/web test:unit -- follow-up-panel.test.tsx workspace-home-view.test.tsx
```

- [ ] **Step 6: Mark Sales Workbench Lite ACTIVE only after implementation is authorized**

Change only Sales Workbench Lite from `PLANNED` to `ACTIVE` in the Lean Roadmap. Keep Engineering Gate Hardening `PLANNED, not ACTIVE`. Record the same current-task fact in `HANDOFF.md`.

- [ ] **Step 7: Commit activation docs**

```bash
git add HANDOFF.md docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md
git commit -m "docs: activate sales workbench lite"
```

Do not push unless explicitly authorized.

---

### Task 1: Add deterministic tenant-calendar bucket boundaries

**Files:**
- Create: `apps/api/src/modules/follow-ups/follow-up-workbench-time.ts`
- Create: `apps/api/src/modules/follow-ups/follow-up-workbench-time.spec.ts`
- Modify: `apps/api/src/modules/follow-ups/follow-ups.repository.ts`
- Test: `apps/api/src/modules/follow-ups/follow-up-workbench-time.spec.ts`

**Interfaces:**

```ts
export interface FollowUpWorkbenchRange {
  todayStart: Date;
  tomorrowStart: Date;
  day8Start: Date;
}

export function followUpWorkbenchRange(
  now: Date,
  timeZone: string,
): FollowUpWorkbenchRange;

export function isValidFollowUpTimeZone(value: string | null): value is string;
```

Repository adds:

```ts
getTenantTimezone(context: TenantContext): Promise<string | null>;
```

- [ ] **Step 1: Write failing boundary tests**

```ts
import {
  followUpWorkbenchRange,
  isValidFollowUpTimeZone,
} from './follow-up-workbench-time';

describe('follow-up workbench tenant calendar', () => {
  it('uses tenant midnight instead of UTC midnight', () => {
    const range = followUpWorkbenchRange(
      new Date('2026-09-17T02:00:00.000Z'),
      'Asia/Shanghai',
    );

    expect(range.todayStart.toISOString()).toBe('2026-09-16T16:00:00.000Z');
    expect(range.tomorrowStart.toISOString()).toBe('2026-09-17T16:00:00.000Z');
    expect(range.day8Start.toISOString()).toBe('2026-09-24T16:00:00.000Z');
  });

  it('adds calendar days across the spring DST transition', () => {
    const range = followUpWorkbenchRange(
      new Date('2026-03-08T20:00:00.000Z'),
      'America/Los_Angeles',
    );

    expect(range.todayStart.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(range.tomorrowStart.toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(range.day8Start.toISOString()).toBe('2026-03-16T07:00:00.000Z');
    expect(range.tomorrowStart.getTime() - range.todayStart.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it('rejects an invalid timezone', () => {
    expect(isValidFollowUpTimeZone('Not/A_Timezone')).toBe(false);
    expect(() =>
      followUpWorkbenchRange(new Date(), 'Not/A_Timezone'),
    ).toThrow('Invalid tenant timezone');
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @crm/api test -- follow-up-workbench-time.spec.ts --runInBand
```

- [ ] **Step 3: Implement the helper**

Public structure:

```ts
export interface FollowUpWorkbenchRange {
  todayStart: Date;
  tomorrowStart: Date;
  day8Start: Date;
}

export function isValidFollowUpTimeZone(
  value: string | null,
): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function followUpWorkbenchRange(
  now: Date,
  timeZone: string,
): FollowUpWorkbenchRange {
  if (!isValidFollowUpTimeZone(timeZone)) {
    throw new Error('Invalid tenant timezone');
  }

  const today = localDateAt(now, timeZone);
  return {
    todayStart: localMidnightUtc(today, timeZone),
    tomorrowStart: localMidnightUtc(addCalendarDays(today, 1), timeZone),
    day8Start: localMidnightUtc(addCalendarDays(today, 8), timeZone),
  };
}
```

Implement `localDateAt`, `addCalendarDays`, and `localMidnightUtc` with `Intl.DateTimeFormat(...).formatToParts()` and the offset-candidate strategy already used in the web `dashboard-timezone.ts`. `localMidnightUtc` must resolve local midnight to a real UTC instant; it must not use `midnight + N * 24h`.

Calendar-date addition:

```ts
function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
```

- [ ] **Step 4: Run boundary tests**

```bash
pnpm --filter @crm/api test -- follow-up-workbench-time.spec.ts --runInBand
```

- [ ] **Step 5: Add tenant timezone lookup to `FollowUpsRepository`**

```ts
getTenantTimezone(context: TenantContext): Promise<string | null> {
  return this.runner.withTenant(context, async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: context.tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone ?? null;
  });
}
```

- [ ] **Step 6: Add timezone repository coverage**

Extend the repository test harness with:

```ts
tenant: {
  findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Shanghai' }),
},
```

Add:

```ts
it('reads the current tenant timezone through the tenant context runner', async () => {
  const fixture = harness();

  await expect(
    fixture.repository.getTenantTimezone(context),
  ).resolves.toBe('Asia/Shanghai');

  expect(fixture.tx.tenant.findUnique).toHaveBeenCalledWith({
    where: { id: context.tenantId },
    select: { timezone: true },
  });
});
```

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter @crm/api test -- follow-up-workbench-time.spec.ts follow-ups.repository.spec.ts --runInBand
```

- [ ] **Step 8: Commit**

```bash
git add \
  apps/api/src/modules/follow-ups/follow-up-workbench-time.ts \
  apps/api/src/modules/follow-ups/follow-up-workbench-time.spec.ts \
  apps/api/src/modules/follow-ups/follow-ups.repository.ts \
  apps/api/src/modules/follow-ups/follow-ups.repository.spec.ts

git commit -m "feat: add follow-up workbench calendar boundaries"
```

---

### Task 2: Add the repository Workbench read model

**Files:**
- Modify: `apps/api/src/modules/follow-ups/follow-ups.dto.ts`
- Modify: `apps/api/src/modules/follow-ups/follow-ups.repository.ts`
- Modify: `apps/api/src/modules/follow-ups/follow-ups.repository.spec.ts`

**Interfaces:**

```ts
FollowUpWorkbenchItemDto
FollowUpWorkbenchCountsDto
FollowUpWorkbenchPreviewDto
FollowUpWorkbenchResponseDto
```

Repository:

```ts
workbench(
  context: TenantContext,
  scopes: FollowUpScope[],
  range: FollowUpWorkbenchRange,
  timezone: string,
): Promise<FollowUpWorkbenchResponseDto>;
```

- [ ] **Step 1: Add exact DTOs**

```ts
export class FollowUpWorkbenchItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() recordId!: string;
  @ApiProperty() recordTitle!: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty() objectName!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty() version!: number;
  @ApiProperty() overdue!: boolean;
  @ApiProperty() canManage!: boolean;
}

export class FollowUpWorkbenchCountsDto {
  @ApiProperty() allOpen!: number;
  @ApiProperty() overdue!: number;
  @ApiProperty() today!: number;
  @ApiProperty() upcoming!: number;
}

export class FollowUpWorkbenchPreviewDto {
  @ApiProperty({ type: FollowUpWorkbenchItemDto, isArray: true })
  overdue!: FollowUpWorkbenchItemDto[];

  @ApiProperty({ type: FollowUpWorkbenchItemDto, isArray: true })
  today!: FollowUpWorkbenchItemDto[];

  @ApiProperty({ type: FollowUpWorkbenchItemDto, isArray: true })
  upcoming!: FollowUpWorkbenchItemDto[];
}

export class FollowUpWorkbenchResponseDto {
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: FollowUpWorkbenchCountsDto })
  counts!: FollowUpWorkbenchCountsDto;
  @ApiProperty({ type: FollowUpWorkbenchPreviewDto })
  preview!: FollowUpWorkbenchPreviewDto;
}
```

- [ ] **Step 2: Extend repository test harness with `count` and `findMany`**

```ts
recordFollowUp: {
  // existing mocks...
  count: jest.fn(),
  findMany: jest.fn(),
},
```

- [ ] **Step 3: Write failing current-assignee and bucket predicate tests**

Use:

```ts
const range = {
  todayStart: new Date('2026-09-16T16:00:00.000Z'),
  tomorrowStart: new Date('2026-09-17T16:00:00.000Z'),
  day8Start: new Date('2026-09-24T16:00:00.000Z'),
};
```

Assert every Workbench query includes:

```ts
{
  tenantId: context.tenantId,
  assigneeMemberId: context.memberId,
  status: 'OPEN',
}
```

Assert:

```ts
overdue: { dueAt: { lt: range.todayStart } }

today: {
  dueAt: {
    gte: range.todayStart,
    lt: range.tomorrowStart,
  },
}

upcoming: {
  dueAt: {
    gte: range.tomorrowStart,
    lt: range.day8Start,
  },
}
```

Every preview must use:

```ts
orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
take: 5,
```

- [ ] **Step 4: Add a failing zero-scope test**

For `scopes=[]`, expect exactly:

```ts
{
  timezone: 'Asia/Shanghai',
  counts: { allOpen: 0, overdue: 0, today: 0, upcoming: 0 },
  preview: { overdue: [], today: [], upcoming: [] },
}
```

and no `count`/`findMany` calls.

- [ ] **Step 5: Verify failure**

```bash
pnpm --filter @crm/api test -- follow-ups.repository.spec.ts --runInBand
```

- [ ] **Step 6: Implement `FollowUpsRepository.workbench`**

Base filter:

```ts
const base: Prisma.RecordFollowUpWhereInput = {
  tenantId: context.tenantId,
  assigneeMemberId: context.memberId,
  status: 'OPEN',
  record: {
    tenantId: context.tenantId,
    deletedAt: null,
    OR: scopes.map((scope) => ({
      objectId: scope.objectId,
      ownerMemberId: scope.ownerMemberId,
    })),
  },
};
```

Use four counts plus three preview queries in the same `withTenant` callback. Preview order is `dueAt ASC, id ASC`; `take` is 5.

Derive `canManage` exactly as the existing list path does:

```ts
const scope = scopes.find((entry) => entry.objectId === row.record.objectId);
const canManage =
  !!scope?.canUpdate &&
  (!scope.updateOwnerMemberId ||
    scope.updateOwnerMemberId === row.record.ownerMemberId);
```

Return only the safe Workbench item fields. Do not return `assigneeMemberId`, `assigneeName`, or `status`.

- [ ] **Step 7: Add safe-shape coverage**

Assert the item contains only:

```text
id
recordId
recordTitle
objectCode
objectName
title
dueAt
version
overdue
canManage
```

and explicitly:

```ts
expect(item).not.toHaveProperty('assigneeMemberId');
expect(item).not.toHaveProperty('assigneeName');
expect(item).not.toHaveProperty('status');
```

- [ ] **Step 8: Run repository tests**

```bash
pnpm --filter @crm/api test -- follow-ups.repository.spec.ts --runInBand
```

- [ ] **Step 9: Commit**

```bash
git add \
  apps/api/src/modules/follow-ups/follow-ups.dto.ts \
  apps/api/src/modules/follow-ups/follow-ups.repository.ts \
  apps/api/src/modules/follow-ups/follow-ups.repository.spec.ts

git commit -m "feat: add personal follow-up workbench query"
```

---

### Task 3: Expose the Workbench service and HTTP endpoint

**Files:**
- Modify: `apps/api/src/modules/follow-ups/follow-ups.service.ts`
- Modify: `apps/api/src/modules/follow-ups/follow-ups.service.spec.ts`
- Modify: `apps/api/src/modules/follow-ups/follow-ups.controller.ts`
- Generated: `packages/contracts/openapi.json`
- Generated: `packages/contracts/src/generated/openapi.ts`

**Interfaces:**

```ts
FollowUpsService.workbench(
  context: TenantContext,
): Promise<FollowUpWorkbenchResponseDto>;
```

HTTP:

```http
GET /workspaces/:tenantCode/follow-ups/workbench
```

- [ ] **Step 1: Extract existing readable-scope resolution**

Move the current `list()` scope loop into:

```ts
private async resolveReadableScopes(
  context: TenantContext,
): Promise<FollowUpScope[]> {
  const navigation = await this.objects.listAccessible(context);
  const scopes: FollowUpScope[] = [];

  for (const object of navigation) {
    try {
      const resolved = await this.objects.resolveRuntimeSchema(
        context,
        object.code,
      );
      scopes.push({
        objectId: resolved.schema.object.id,
        ownerMemberId:
          resolved.access.readScope === 'OWN' ? context.memberId : undefined,
        canUpdate:
          resolved.access.canUpdate && resolved.access.updateScope !== 'NONE',
        updateOwnerMemberId:
          resolved.access.updateScope === 'OWN'
            ? context.memberId
            : undefined,
      });
    } catch (error) {
      if (
        !(error instanceof ApiException) ||
        ![403, 404].includes(error.getStatus())
      ) {
        throw error;
      }
    }
  }

  return scopes;
}
```

Make existing `list()` call this helper, preserving current list semantics.

- [ ] **Step 2: Add failing service tests**

Extend repository mocks:

```ts
getTenantTimezone: jest.fn().mockResolvedValue('Asia/Shanghai'),
workbench: jest.fn().mockResolvedValue({
  timezone: 'Asia/Shanghai',
  counts: { allOpen: 0, overdue: 0, today: 0, upcoming: 0 },
  preview: { overdue: [], today: [], upcoming: [] },
}),
```

Use fake time:

```ts
jest.useFakeTimers();
jest.setSystemTime(new Date('2026-09-17T02:00:00.000Z'));
```

Assert the repository receives current-actor scopes and the exact calendar range. Restore timers after the test.

Add invalid-timezone coverage:

```ts
repository.getTenantTimezone.mockResolvedValue('Not/A_Timezone');

await expect(service.workbench(context)).rejects.toMatchObject({
  code: 'INTERNAL_ERROR',
});

expect(repository.workbench).not.toHaveBeenCalled();
```

- [ ] **Step 3: Verify failure**

```bash
pnpm --filter @crm/api test -- follow-ups.service.spec.ts --runInBand
```

- [ ] **Step 4: Implement `FollowUpsService.workbench`**

```ts
async workbench(context: TenantContext) {
  const [scopes, timezone] = await Promise.all([
    this.resolveReadableScopes(context),
    this.repository.getTenantTimezone(context),
  ]);

  if (!isValidFollowUpTimeZone(timezone)) {
    throw new ApiException('INTERNAL_ERROR', 500, {
      message: '租户时区配置无效，请联系平台管理员。',
    });
  }

  return this.repository.workbench(
    context,
    scopes,
    followUpWorkbenchRange(new Date(), timezone),
    timezone,
  );
}
```

No actor-selection argument is accepted.

- [ ] **Step 5: Run service tests**

```bash
pnpm --filter @crm/api test -- follow-ups.service.spec.ts --runInBand
```

- [ ] **Step 6: Add the controller route**

Import `FollowUpWorkbenchResponseDto` and add directly after the list route:

```ts
@Get('workbench')
@ApiOkResponse({ type: FollowUpWorkbenchResponseDto })
workbench(@CurrentTenant() context: TenantContext) {
  return this.service.workbench(context);
}
```

Do not add `@Query()`.

- [ ] **Step 7: Run API typecheck and focused tests**

```bash
pnpm --filter @crm/api typecheck
pnpm --filter @crm/api test -- \
  follow-up-workbench-time.spec.ts \
  follow-ups.service.spec.ts \
  follow-ups.repository.spec.ts \
  --runInBand
```

- [ ] **Step 8: Generate contracts**

```bash
pnpm contracts:generate
grep -n 'follow-ups/workbench' packages/contracts/openapi.json
grep -n 'FollowUpWorkbenchResponseDto' packages/contracts/src/generated/openapi.ts
```

- [ ] **Step 9: Commit API and generated contracts**

```bash
git add \
  apps/api/src/modules/follow-ups/follow-ups.controller.ts \
  apps/api/src/modules/follow-ups/follow-ups.service.ts \
  apps/api/src/modules/follow-ups/follow-ups.service.spec.ts \
  packages/contracts/openapi.json \
  packages/contracts/src/generated/openapi.ts

git commit -m "feat: expose personal follow-up workbench api"
```

- [ ] **Step 10: Verify contract drift is clean**

```bash
pnpm contracts:check
```

---

### Task 4: Add the typed web client and shared query keys

**Files:**
- Modify: `apps/web/src/features/follow-ups/follow-up-api.ts`
- Modify: `apps/web/src/features/follow-ups/follow-up-panel.tsx`

**Interfaces:**

```ts
export type FollowUpWorkbench =
  components['schemas']['FollowUpWorkbenchResponseDto'];

export type FollowUpWorkbenchItem =
  components['schemas']['FollowUpWorkbenchItemDto'];

export const followUpQueryKeys = {
  root: (tenantCode: string) =>
    ['workspace', tenantCode, 'follow-ups'] as const,
  workbench: (tenantCode: string) =>
    ['workspace', tenantCode, 'follow-ups', 'workbench'] as const,
};

followUpApi.workbench(tenantCode: string): Promise<FollowUpWorkbench>;
```

- [ ] **Step 1: Add generated type aliases and query keys**

Import:

```ts
import type { components } from '@crm/contracts';
```

Add the types and query-key helpers shown above.

- [ ] **Step 2: Add Workbench request**

```ts
const WORKBENCH_PATH =
  '/api/v1/workspaces/{tenantCode}/follow-ups/workbench' as const;
```

Add:

```ts
async workbench(tenantCode: string): Promise<FollowUpWorkbench> {
  return dataOrThrow(
    await browserApiClient.GET(WORKBENCH_PATH, {
      params: { path: { tenantCode } },
    }),
  );
},
```

- [ ] **Step 3: Reuse the root key in `FollowUpPanel`**

Replace the local array key with:

```ts
const key = followUpQueryKeys.root(tenantCode);
```

Keep all existing panel behavior.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @crm/web typecheck
pnpm --filter @crm/web test:unit -- follow-up-panel.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add \
  apps/web/src/features/follow-ups/follow-up-api.ts \
  apps/web/src/features/follow-ups/follow-up-panel.tsx

git commit -m "feat: add follow-up workbench web client"
```

---

### Task 5: Build the Personal Follow-up Workbench component

**Files:**
- Create: `apps/web/src/features/follow-ups/follow-up-workbench.tsx`
- Create: `apps/web/src/features/follow-ups/follow-up-workbench.test.tsx`
- Modify: `apps/web/src/features/follow-ups/follow-ups.module.css`

**Interfaces:**

```tsx
export function PersonalFollowUpWorkbench(props: {
  tenantCode: string;
  api?: typeof followUpApi;
}): JSX.Element;
```

- [ ] **Step 1: Create the test harness**

Use `QueryClientProvider` exactly as the existing `follow-up-panel.test.tsx` does.

Fixture:

```ts
const item = {
  id: 'task-1',
  recordId: 'record-1',
  recordTitle: '项目 A',
  objectCode: 'opportunities',
  objectName: '商机',
  title: '确认客户反馈',
  dueAt: '2026-09-17T01:00:00.000Z',
  version: 3,
  overdue: false,
  canManage: true,
};

const workbench = {
  timezone: 'Asia/Shanghai',
  counts: { allOpen: 9, overdue: 2, today: 1, upcoming: 4 },
  preview: {
    overdue: [{ ...item, id: 'overdue-1', overdue: true }],
    today: [item],
    upcoming: [
      { ...item, id: 'upcoming-1', dueAt: '2026-09-18T01:00:00.000Z' },
    ],
  },
};
```

Fake API includes all existing methods plus `workbench`.

- [ ] **Step 2: Write failing render tests**

Assert counts, three preview headings, the Record link, and tenant-timezone rendering. For `2026-09-17T01:00:00.000Z` in `Asia/Shanghai`, the visible time must represent `09/17 09:00`.

- [ ] **Step 3: Write failing permission/completion tests**

`canManage=false` => no 完成 button.

`canManage=true` => clicking 完成 calls:

```ts
api.update('northwind', 'task-1', {
  version: 3,
  status: 'DONE',
});
```

and causes the Workbench query to refetch.

- [ ] **Step 4: Write failing error-isolation test**

A rejected Workbench query must render:

```text
跟进事项暂时无法加载
重试
```

without throwing the containing page.

- [ ] **Step 5: Verify failure**

```bash
pnpm --filter @crm/web test:unit -- follow-up-workbench.test.tsx
```

- [ ] **Step 6: Implement the component**

Query:

```ts
const query = useQuery({
  queryKey: followUpQueryKeys.workbench(tenantCode),
  queryFn: () => api.workbench(tenantCode),
  refetchInterval: 60_000,
});
```

Completion mutation:

```ts
const complete = useMutation({
  mutationFn: (task: FollowUpWorkbenchItem) =>
    api.update(tenantCode, task.id, {
      version: task.version,
      status: 'DONE',
    }),
  onSuccess: async () => {
    setError(undefined);
    await client.invalidateQueries({
      queryKey: followUpQueryKeys.root(tenantCode),
    });
  },
  onError: async (caught) => {
    setError(toApiError(caught).message);
    await client.invalidateQueries({
      queryKey: followUpQueryKeys.root(tenantCode),
    });
  },
});
```

The root invalidation refreshes both the Workbench and the full Follow-up page queries.

Render only:

```text
已逾期
今日
近期
```

as preview lists. `allOpen` is count-only.

Date rendering must explicitly use `query.data.timezone`.

- [ ] **Step 7: Add responsive CSS**

Add dedicated Workbench classes. Preview buckets stay vertically stacked. At `max-width: 640px`, use a two-by-two count grid and vertical item layout; never render four horizontal cards.

- [ ] **Step 8: Run component tests**

```bash
pnpm --filter @crm/web test:unit -- follow-up-workbench.test.tsx
```

- [ ] **Step 9: Run FollowUpPanel regression**

```bash
pnpm --filter @crm/web test:unit -- follow-up-panel.test.tsx
```

- [ ] **Step 10: Commit**

```bash
git add \
  apps/web/src/features/follow-ups/follow-up-workbench.tsx \
  apps/web/src/features/follow-ups/follow-up-workbench.test.tsx \
  apps/web/src/features/follow-ups/follow-ups.module.css

git commit -m "feat: add personal follow-up workbench ui"
```

---

### Task 6: Integrate employee home and preserve UNCONFIGURED behavior

**Files:**
- Modify: `apps/web/src/features/dashboard/employee-workbench.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx`
- Delete: `apps/web/src/features/follow-ups/follow-up-summary.tsx`

- [ ] **Step 1: Replace the static employee summary**

In `employee-workbench.tsx`, replace `FollowUpSummary` with:

```tsx
<PersonalFollowUpWorkbench tenantCode={tenantCode} />
```

Keep it before `<DashboardRenderer />`.

- [ ] **Step 2: Mock Workbench in home composition tests**

Add:

```ts
vi.mock('@/features/follow-ups/follow-up-workbench', () => ({
  PersonalFollowUpWorkbench: ({ tenantCode }: { tenantCode: string }) => (
    <section data-testid="personal-follow-up-workbench">
      follow-ups:{tenantCode}
    </section>
  ),
}));
```

- [ ] **Step 3: Split UNCONFIGURED by role**

Keep the current admin branch unchanged.

For employees render:

```tsx
<div className={styles.home}>
  <PageHeader
    title="我的工作台"
    description={`${userName}，这里会使用 ${tenantName} 的真实业务记录生成工作摘要。`}
  />
  <PersonalFollowUpWorkbench tenantCode={tenantCode} />
  <StatePanel
    title="工作台尚未启用"
    description="公司管理员发布工作台后，这里会显示你有权限查看的结果。"
  />
  <BusinessObjectBar
    tenantCode={tenantCode}
    objects={businessObjects}
    role="EMPLOYEE"
  />
</div>
```

- [ ] **Step 4: Extend the existing UNCONFIGURED test**

Employee branch must contain `personal-follow-up-workbench` and must not contain the 配置工作台 link.

Admin branch must not contain `personal-follow-up-workbench`.

- [ ] **Step 5: Run home tests**

```bash
pnpm --filter @crm/web test:unit -- workspace-home-view.test.tsx
```

- [ ] **Step 6: Delete the obsolete static summary**

```bash
rm apps/web/src/features/follow-ups/follow-up-summary.tsx
grep -R "follow-up-summary\|FollowUpSummary" apps/web/src || true
```

Expected: no remaining references.

- [ ] **Step 7: Run all focused web tests**

```bash
pnpm --filter @crm/web test:unit -- \
  follow-up-workbench.test.tsx \
  follow-up-panel.test.tsx \
  workspace-home-view.test.tsx
```

- [ ] **Step 8: Commit**

```bash
git add \
  apps/web/src/features/dashboard/employee-workbench.tsx \
  'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx' \
  'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx' \
  apps/web/src/features/follow-ups/follow-up-summary.tsx

git commit -m "feat: surface follow-ups on employee home"
```

---

### Task 7: Run local acceptance and all five current gates

- [ ] **Step 1: Focused API**

```bash
pnpm --filter @crm/api test -- \
  follow-up-workbench-time.spec.ts \
  follow-ups.service.spec.ts \
  follow-ups.repository.spec.ts \
  --runInBand
```

- [ ] **Step 2: Focused web**

```bash
pnpm --filter @crm/web test:unit -- \
  follow-up-workbench.test.tsx \
  follow-up-panel.test.tsx \
  workspace-home-view.test.tsx
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @crm/contracts --filter @crm/database build
pnpm typecheck
```

- [ ] **Step 4: Contracts**

```bash
pnpm contracts:check
```

- [ ] **Step 5: Unit Tests**

```bash
pnpm test
```

Record actual test counts.

- [ ] **Step 6: Build**

```bash
pnpm build
```

- [ ] **Step 7: Database Integration in an isolated Compose project**

Create `/tmp/sales-workbench-compose.override.yml`:

```yaml
services:
  postgres:
    ports: !override
      - "55433:5432"
```

Run:

```bash
docker compose \
  -p sales-workbench-verify \
  -f compose.yaml \
  -f /tmp/sales-workbench-compose.override.yml \
  up -d --wait postgres

TEST_DATABASE_ADMIN_URL="postgresql://crm:crm@localhost:55433/crm?schema=public" \
TEST_DATABASE_URL="postgresql://crm_app:crm_app@localhost:55433/crm?schema=public" \
pnpm --filter @crm/database test:integration

docker compose \
  -p sales-workbench-verify \
  -f compose.yaml \
  -f /tmp/sales-workbench-compose.override.yml \
  down -v
```

Do not use the developer's default Compose volume.

- [ ] **Step 8: Inspect scope**

```bash
git status --short
git diff --name-only origin/main...HEAD
git diff --check
```

No changes should appear under:

```text
.github/workflows/**
packages/database/prisma/**
apps/api/src/modules/workflows/**
apps/api/src/modules/automation/**
```

- [ ] **Step 9: Verify no actor-selection query path was introduced**

```bash
grep -R "assigneeMemberId.*Query\|memberId.*Query" \
  apps/api/src/modules/follow-ups \
  || true
```

Manually confirm the Workbench controller accepts no actor-selection query parameter.

---

### Task 8: Push and verify protected hosted CI

> Execute only with explicit user authorization.

- [ ] **Step 1: Push**

```bash
git push -u origin feat/sales-workbench-lite
```

- [ ] **Step 2: Open PR**

Suggested title:

```text
feat: add sales workbench lite
```

PR body must state the fixed personal Workbench scope and all non-goals, including no Dashboard widget, DB migration, AI, Automation, CI change, or Critical API E2E promotion.

- [ ] **Step 3: Require hosted green checks**

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
```

All five must be green. Branch protection applies to administrators too.

- [ ] **Step 4: If unrelated CI/product debt appears**

Stop, report it, and split it into a separate PR. Do not bundle unrelated fixes.

---

### Task 9: Write observed acceptance and close the stage

**Files:**
- Create: `docs/audits/2026-09-17/sales-workbench-lite-acceptance.md`
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`

- [ ] **Step 1: Record observed facts only**

Include:

```text
baseline SHA
feature PR number
merge commit
hosted CI run id/URL
five check conclusions
actual focused API count
actual focused web count
actual full unit count
Database Integration result
tenant-timezone/DST evidence
employee isolation evidence
UNCONFIGURED Dashboard evidence
known exclusions
```

- [ ] **Step 2: Record exact security evidence**

Acceptance must explicitly prove:

```text
no actor-selection parameter
assignee fixed to context.memberId
tenant/RLS boundary preserved
inaccessible Record removes Follow-up from Workbench
safe DTO excludes assignee/tenant/user/Record-values metadata
```

- [ ] **Step 3: Close the roadmap stage**

Change Sales Workbench Lite `ACTIVE` → `COMPLETED`.

Keep Engineering Gate Hardening `PLANNED` and identify it as the next stage before AI V1A.

Do not mark AI V1A active.

- [ ] **Step 4: Update HANDOFF**

Record the final Workbench behavior, no Dashboard schema change, no migration, current-actor-only endpoint, and reuse of the audited/versioned PATCH path.

- [ ] **Step 5: Verify docs**

```bash
git diff --check
grep -R "Sales Workbench Lite" \
  HANDOFF.md \
  docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md \
  docs/audits/2026-09-17/sales-workbench-lite-acceptance.md
```

- [ ] **Step 6: Commit closeout**

```bash
git add \
  HANDOFF.md \
  docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md \
  docs/audits/2026-09-17/sales-workbench-lite-acceptance.md

git commit -m "docs: close sales workbench lite"
```

Push/merge only with explicit user authorization and the protected PR flow.

---

## Definition of Done

```text
[ ] GET /workspaces/:tenantCode/follow-ups/workbench exists
[ ] endpoint accepts no actor-selection parameter
[ ] workbench is hard-bound to context.memberId
[ ] tenant timezone controls today/upcoming boundaries
[ ] DST boundary test passes
[ ] overdue / today / upcoming are non-overlapping
[ ] upcoming covers exactly next 7 tenant calendar days excluding today
[ ] counts are full-set counts; previews max 5
[ ] inaccessible Records do not leak Follow-up metadata
[ ] employee home shows Personal Follow-up Workbench
[ ] Dashboard UNCONFIGURED still shows Personal Follow-up Workbench
[ ] tenant-admin home behavior is unchanged
[ ] only canManage items show Complete
[ ] completion reuses existing versioned/audited PATCH
[ ] old static FollowUpSummary is removed
[ ] Typecheck green
[ ] Contracts green
[ ] Unit Tests green
[ ] Database Integration green
[ ] Build green
[ ] acceptance contains observed evidence
[ ] HANDOFF and Lean Roadmap synchronized
[ ] Engineering Gate Hardening remains next before AI V1A
```
