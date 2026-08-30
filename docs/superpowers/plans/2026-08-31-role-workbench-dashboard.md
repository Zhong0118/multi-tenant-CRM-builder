# Role Workbench Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real-data company-admin and employee workbenches, add tenant dashboard metric mapping, and keep every selected record-status filter visible.

**Architecture:** Extend the existing empty `dashboards` NestJS module into a tenant-scoped configuration and aggregation boundary. Store versioned dashboard configuration in its own tenant-owned row, validate mappings against active published object snapshots, aggregate dynamic JSON record values in PostgreSQL, and render the same metrics through role-specific Next.js views whose scope is enforced by the API.

**Tech Stack:** NestJS, Prisma/PostgreSQL JSONB, OpenAPI generated contracts, Next.js 16, React 19, Ant Design 6, `@ant-design/charts`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-role-workbench-dashboard-design.md`

## Global Constraints

- Do not modify `apps/web/src/app/(auth)/register/page.tsx` or `chat会话.md`.
- Do not hard-code Baijie object names or field keys in dashboard core code.
- Employee metrics must obey effective object access, field visibility, and `OWN`/`ALL` scope.
- Use real persisted records only; render honest unconfigured and empty states.
- Preserve draft → immutable publication → runtime snapshot behavior.
- Keep selected filter tags visible; toolbar height may grow.
- Use targeted tests and one admin plus one employee browser flow, not a full smoke matrix.
- Stage only files owned by the current task; preserve unrelated working-tree changes.

---

## File Structure

### Database and API

- `packages/database/prisma/schema.prisma`: add the tenant-owned dashboard configuration relation.
- `packages/database/prisma/migrations/0007_tenant_dashboard_configuration/migration.sql`: table, constraints, indexes, and RLS policy.
- `apps/api/src/modules/dashboards/dashboard.types.ts`: domain configuration, validation issue, query, and projection types.
- `apps/api/src/modules/dashboards/dashboard-configuration.ts`: strict JSON parsing and published-schema compatibility validation.
- `apps/api/src/modules/dashboards/dashboards.repository.ts`: tenant-scoped persistence and PostgreSQL aggregation.
- `apps/api/src/modules/dashboards/dashboards.service.ts`: authorization, configuration validation, and role-scoped orchestration.
- `apps/api/src/modules/dashboards/dashboards.controller.ts`: workspace routes.
- `apps/api/src/modules/dashboards/dashboards.module.ts`: repository wiring and infrastructure imports.
- `apps/api/src/modules/dashboards/dto/dashboard.dto.ts`: OpenAPI request/response DTOs.
- `apps/api/src/modules/dashboards/dto/index.ts`: DTO exports.
- `apps/api/src/modules/dashboards/dashboard-configuration.spec.ts`: configuration compatibility tests.
- `apps/api/src/modules/dashboards/dashboards.service.spec.ts`: admin/employee scope and aggregate projection tests.
- `packages/contracts/openapi.json`, `packages/contracts/src/generated/openapi.ts`: regenerated API contracts.

### Web

- `apps/web/src/features/records/record-list.tsx`: remove responsive tag collapsing.
- `apps/web/src/features/records/record-list.module.css`: visible tag wrapping and filter toolbar sizing.
- `apps/web/src/features/records/record-list.test.tsx`: selected status tag regression.
- `apps/web/src/features/dashboard/dashboard-api.ts`: typed server loaders and admin configuration mutation.
- `apps/web/src/features/dashboard/dashboard-types.ts`: narrow generated DTOs into view types.
- `apps/web/src/features/dashboard/dashboard-configuration-form.tsx`: admin semantic mapping form.
- `apps/web/src/features/dashboard/dashboard-configuration.module.css`: configuration form layout.
- `apps/web/src/features/dashboard/admin-workbench.tsx`: company result, pipeline, trend, leaderboard, and attention views.
- `apps/web/src/features/dashboard/employee-workbench.tsx`: personal metrics, pipeline, attention, and recent work.
- `apps/web/src/features/dashboard/workbench-charts.tsx`: chart-only client boundary.
- `apps/web/src/features/dashboard/workbench.module.css`: full-width dashboard layout.
- `apps/web/src/app/(workspace)/workspace/[tenantCode]/page.tsx`: load role-scoped dashboard data.
- `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx`: dispatch configured, unconfigured, and partial states by role.
- `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home.module.css`: remove the current hero/card-grid homepage layout.
- `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/page.tsx`: add dashboard configuration entry.
- `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/dashboard/page.tsx`: admin-only configuration page.
- `apps/web/package.json`, `pnpm-lock.yaml`: add `@ant-design/charts`.

---

### Task 1: Keep All Selected Status Filters Visible

**Files:**
- Modify: `apps/web/src/features/records/record-list.tsx`
- Modify: `apps/web/src/features/records/record-list.module.css`
- Test: `apps/web/src/features/records/record-list.test.tsx`

**Interfaces:**
- Consumes: existing published `SINGLE_SELECT` option filters and URL query serialization.
- Produces: the same filter values and API query, with every selected label rendered.

- [ ] **Step 1: Add the regression assertion**

Render a record list with a published status field, select two options, and assert both labels remain in the document and no collapsed `+ 1 ...` indicator is rendered.

```tsx
await user.click(screen.getByRole("combobox", { name: "状态" }));
await user.click(screen.getByText("待跟进"));
await user.click(screen.getByRole("combobox", { name: "状态" }));
await user.click(screen.getByText("已联系"));
expect(screen.getByText("待跟进")).toBeVisible();
expect(screen.getByText("已联系")).toBeVisible();
expect(screen.queryByText(/^\+\s*1/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Verify the current behavior fails**

Run:

```bash
pnpm --filter @crm/web test:unit -- apps/web/src/features/records/record-list.test.tsx
```

Expected: the new collapsed-tag assertion fails against `maxTagCount="responsive"`.

- [ ] **Step 3: Remove collapsing and allow wrapping**

Delete `maxTagCount="responsive"` from the dynamic option filter `Select`. Give the popup an explicit matching width only if necessary, but do not limit visible tags. Update CSS so `.optionFilter` has `min-width: 240px`, a practical desktop `max-width`, and an auto-height selector whose selection overflow wraps.

```css
.optionFilter {
  min-width: 240px;
  max-width: 360px;
}

.optionFilter :global(.ant-select-selector) {
  min-height: 32px !important;
  height: auto !important;
  align-items: flex-start;
}

.optionFilter :global(.ant-select-selection-overflow) {
  flex-wrap: wrap;
  gap: 2px;
}

.optionFilter :global(.ant-select-selection-item) {
  font-size: 12px;
}
```

- [ ] **Step 4: Run the focused web test and typecheck**

```bash
pnpm --filter @crm/web test:unit -- apps/web/src/features/records/record-list.test.tsx
pnpm --filter @crm/web typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit the isolated UX fix**

```bash
git add apps/web/src/features/records/record-list.tsx apps/web/src/features/records/record-list.module.css apps/web/src/features/records/record-list.test.tsx
git commit -m "fix(records): keep selected status filters visible"
```

### Task 2: Add Versioned Tenant Dashboard Configuration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0007_tenant_dashboard_configuration/migration.sql`
- Create: `apps/api/src/modules/dashboards/dashboard.types.ts`
- Create: `apps/api/src/modules/dashboards/dashboard-configuration.ts`
- Create: `apps/api/src/modules/dashboards/dashboard-configuration.spec.ts`

**Interfaces:**
- Produces: `DashboardConfiguration`, `DashboardConfigurationIssue`, `parseDashboardConfiguration(value)`, and `validateDashboardConfiguration(configuration, publishedObjects)`.
- Stores: one `TenantDashboardConfiguration` row per tenant with `version`, `configuration`, and timestamps.

- [ ] **Step 1: Write strict parser and compatibility tests**

Cover one valid opportunity mapping and failures for a missing object, a non-select stage field, a non-number amount field, and option keys absent from the active publication.

```ts
expect(
  validateDashboardConfiguration(validConfiguration, publishedObjects),
).toEqual([]);
expect(
  validateDashboardConfiguration(
    { ...validConfiguration, opportunity: { ...validConfiguration.opportunity, amountFieldKey: "customer_name" } },
    publishedObjects,
  ),
).toContainEqual(expect.objectContaining({ code: "AMOUNT_FIELD_TYPE_INVALID" }));
```

- [ ] **Step 2: Verify tests fail because the parser does not exist**

```bash
pnpm --filter @crm/api test -- dashboard-configuration.spec.ts
```

Expected: module or exported symbol not found.

- [ ] **Step 3: Add the database model and migration**

Add a one-to-one relation from `Tenant` and this model:

```prisma
model TenantDashboardConfiguration {
  tenantId      String   @id @map("tenant_id") @db.Uuid
  version       Int      @default(1)
  configuration Json     @db.JsonB
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@map("tenant_dashboard_configurations")
}
```

The SQL migration must enable RLS and add `USING/WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)` policies following the existing tenant-owned table policies.

- [ ] **Step 4: Implement strict configuration parsing and published-field validation**

Use exact keys; reject extra root or nested keys. Validate `stageFieldKey` as `SINGLE_SELECT`, `amountFieldKey` as `NUMBER`, date fields as `DATE` or `DATETIME`, and every option key against active options in the published snapshot. Return structured issues rather than silently dropping invalid mappings.

- [ ] **Step 5: Generate Prisma client and run focused tests**

```bash
pnpm --filter @crm/database build
pnpm --filter @crm/api test -- dashboard-configuration.spec.ts
```

Expected: build and focused tests pass.

- [ ] **Step 6: Commit configuration domain and schema**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/0007_tenant_dashboard_configuration/migration.sql apps/api/src/modules/dashboards/dashboard.types.ts apps/api/src/modules/dashboards/dashboard-configuration.ts apps/api/src/modules/dashboards/dashboard-configuration.spec.ts
git commit -m "feat(dashboard): add tenant metric configuration"
```

### Task 3: Implement Configuration and Role-Scoped Aggregation APIs

**Files:**
- Create: `apps/api/src/modules/dashboards/dashboards.repository.ts`
- Modify: `apps/api/src/modules/dashboards/dashboards.service.ts`
- Modify: `apps/api/src/modules/dashboards/dashboards.controller.ts`
- Modify: `apps/api/src/modules/dashboards/dashboards.module.ts`
- Create: `apps/api/src/modules/dashboards/dto/dashboard.dto.ts`
- Modify: `apps/api/src/modules/dashboards/dto/index.ts`
- Create: `apps/api/src/modules/dashboards/dashboards.service.spec.ts`
- Modify: `packages/contracts/openapi.json`
- Modify: `packages/contracts/src/generated/openapi.ts`

**Interfaces:**
- Consumes: `DashboardConfiguration`, `TenantContext`, active publication snapshots, `DatabaseContextRunner`.
- Produces: `getConfiguration`, `saveConfiguration`, and `getOverview` service methods plus typed DTOs.
- Endpoint shape: `GET/PUT /api/v1/workspaces/:tenantCode/dashboard/configuration` and `GET /api/v1/workspaces/:tenantCode/dashboard/overview`.

- [ ] **Step 1: Write service tests for admin and employee scope**

Assert that only tenant admins can save configuration, employee overview queries carry `ownerMemberId=context.memberId` for `OWN`, admin queries have no forced owner, a missing configuration returns `state: "UNCONFIGURED"`, and an invalidated mapping returns `state: "NEEDS_REPAIR"` with issues.

```ts
expect(repository.aggregateOverview).toHaveBeenCalledWith(
  context,
  expect.objectContaining({ ownerMemberId: context.memberId }),
);
```

- [ ] **Step 2: Verify focused tests fail**

```bash
pnpm --filter @crm/api test -- dashboards.service.spec.ts
```

Expected: service methods and repository token are missing.

- [ ] **Step 3: Implement repository persistence and aggregation**

Use one tenant transaction for configuration reads/writes and aggregation. The overview result must contain:

```ts
interface DashboardOverview {
  state: "READY" | "UNCONFIGURED" | "NEEDS_REPAIR";
  period: { from: string; to: string; timezone: string };
  metrics: Array<{ key: string; label: string; value: number | null; format: "COUNT" | "MONEY" | "PERCENT" }>;
  pipeline: Array<{ optionKey: string; label: string; color: string; count: number; amount: number }>;
  trend: Array<{ date: string; wonCount: number; wonAmount: number }>;
  attention: Array<{ key: string; label: string; count: number; href: string }>;
  leaderboard: Array<{ memberId: string; displayName: string; wonCount: number; wonAmount: number; activeAmount: number }>;
  records: Array<{ id: string; title: string; ownerMemberId: string | null; ownerName: string | null; stageKey: string | null; amount: number | null; dueAt: string | null; updatedAt: string }>;
}
```

Build SQL fragments only from field keys that passed strict identifier validation; pass values as query parameters. Use `CASE WHEN (data ->> amountKey) ~ numericRegex THEN ...::numeric ELSE 0 END` so malformed legacy JSON cannot crash the query.

- [ ] **Step 4: Add guarded controller routes and DTOs**

Apply `SessionAuthGuard` and `WorkspaceGuard`, take `TenantContext` from `@CurrentTenant()`, validate `from/to` as ISO dates, and reject ranges longer than 366 days. The service, not the client, decides whether leaderboard data is returned.

- [ ] **Step 5: Regenerate contracts and run API checks**

```bash
pnpm contracts:generate
pnpm --filter @crm/api test -- dashboard-configuration.spec.ts dashboards.service.spec.ts
pnpm --filter @crm/api typecheck
```

Expected: generated contracts change only for dashboard routes/DTOs and checks pass.

- [ ] **Step 6: Commit the API slice**

```bash
git add apps/api/src/modules/dashboards packages/contracts/openapi.json packages/contracts/src/generated/openapi.ts
git commit -m "feat(dashboard): expose scoped workspace metrics"
```

### Task 4: Build the Company-Admin Dashboard Configuration Page

**Files:**
- Create: `apps/web/src/features/dashboard/dashboard-api.ts`
- Create: `apps/web/src/features/dashboard/dashboard-types.ts`
- Create: `apps/web/src/features/dashboard/dashboard-configuration-form.tsx`
- Create: `apps/web/src/features/dashboard/dashboard-configuration.module.css`
- Create: `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/dashboard/page.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/page.tsx`

**Interfaces:**
- Consumes: generated dashboard configuration DTOs and existing active published object candidates.
- Produces: an admin-only form that saves a valid semantic mapping and refreshes the workbench.

- [ ] **Step 1: Add typed API loaders and mutation**

Implement server loading for configuration/candidates and a client mutation that sends `expectedVersion` with the complete configuration. Convert API errors through the existing `toApiError` boundary.

- [ ] **Step 2: Build a guided mapping form**

Use a two-column desktop form: left side contains object/field mapping; right side shows “可生成指标” and validation issues. Filter candidate fields by compatible published type. Stage options use their configured colors and require each active option to be assigned to `进行中`, `成交`, `失败`, or `不参与统计`.

- [ ] **Step 3: Add honest states and save feedback**

Disable save when required mappings are incomplete. After save, show a success message and link back to `/workspace/{tenantCode}`. If a previously selected field is no longer published, keep its issue visible and require replacement.

- [ ] **Step 4: Add the settings entry and role guard**

Only `TENANT_ADMIN` can render the route. Add “工作台与指标” as a first-class settings card beside business tables and members rather than hiding it inside the object designer.

- [ ] **Step 5: Run web typecheck**

```bash
pnpm --filter @crm/web typecheck
```

Expected: pass.

- [ ] **Step 6: Commit the configuration UI**

```bash
git add apps/web/src/features/dashboard/dashboard-api.ts apps/web/src/features/dashboard/dashboard-types.ts apps/web/src/features/dashboard/dashboard-configuration-form.tsx apps/web/src/features/dashboard/dashboard-configuration.module.css 'apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/dashboard/page.tsx' 'apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/page.tsx'
git commit -m "feat(web): configure workspace dashboard metrics"
```

### Task 5: Replace the Workspace Home With Role-Specific Workbenches

**Files:**
- Create: `apps/web/src/features/dashboard/admin-workbench.tsx`
- Create: `apps/web/src/features/dashboard/employee-workbench.tsx`
- Create: `apps/web/src/features/dashboard/workbench-charts.tsx`
- Create: `apps/web/src/features/dashboard/workbench.module.css`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/page.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home.module.css`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `DashboardOverview` from Task 3 and workspace role.
- Produces: `AdminWorkbench` and `EmployeeWorkbench` with shared `PipelineChart` and `TrendChart`.

- [ ] **Step 1: Add `@ant-design/charts`**

```bash
pnpm --filter @crm/web add @ant-design/charts
```

Expected: web package and lockfile contain one new direct dependency.

- [ ] **Step 2: Update workspace-home tests for role-specific content**

Admin test must assert team leaderboard and attention modules. Employee test must assert personal metric copy and absence of team leaderboard. Unconfigured tests must assert the admin configuration action and employee explanatory state.

- [ ] **Step 3: Verify the new workbench tests fail**

```bash
pnpm --filter @crm/web test:unit -- 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx'
```

Expected: current navigation homepage does not contain the required modules.

- [ ] **Step 4: Build shared chart boundaries**

Use a horizontal interval/funnel-like chart for pipeline stages and a dual series line/column chart for trend. Keep chart data and click callbacks typed; dynamic import the chart client boundary so the server page remains SSR-safe.

```tsx
<PipelineChart
  data={overview.pipeline}
  onStageClick={(optionKey) => router.push(recordHref({ filters: { [stageFieldKey]: [optionKey] } }))}
/>
```

- [ ] **Step 5: Build the admin workbench**

Render one compact KPI band, a 2:1 pipeline/attention row, trend, Ant Table leaderboard, and risk-record table. Admin global filters include period and owner. Tables use built-in sorter configuration for won amount, won count, active amount, due date, and updated time.

- [ ] **Step 6: Build the employee workbench**

Reuse metric and chart primitives but change hierarchy: personal KPI band, my pipeline, today/overdue attention, priority records, trend, and recent work. Do not render employee selector or team leaderboard.

- [ ] **Step 7: Implement full-width responsive styling**

Remove the old reading-hero and object-card grid as the dominant layout. Use full content width, compact divider-based KPI cells, 8–10px outer surfaces, straight table interiors, a 2:1 desktop analysis grid, and a one-column mobile layout.

- [ ] **Step 8: Run focused tests and typecheck**

```bash
pnpm --filter @crm/web test:unit -- 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx'
pnpm --filter @crm/web typecheck
```

Expected: pass.

- [ ] **Step 9: Commit role workbenches**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/features/dashboard/admin-workbench.tsx apps/web/src/features/dashboard/employee-workbench.tsx apps/web/src/features/dashboard/workbench-charts.tsx apps/web/src/features/dashboard/workbench.module.css 'apps/web/src/app/(workspace)/workspace/[tenantCode]/page.tsx' 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.tsx' 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home.module.css' 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx'
git commit -m "feat(web): add admin and employee workbenches"
```

### Task 6: Seed a Clear Demonstration Company and Verify the Core Flow

**Files:**
- Modify: `apps/api/src/scripts/demo-company-fixture.ts`
- Modify: `apps/api/src/scripts/demo-company-fixture.spec.ts`
- Modify: `apps/api/src/scripts/seed-demo-company.ts` only if invocation input must change.
- Modify: `HANDOFF.md` only if it already documents local login credentials and startup commands.

**Interfaces:**
- Consumes: existing demo tenant, two tenant-admin accounts, eight employee accounts, published objects, and records.
- Produces: one configured workbench with records distributed across employees, stages, dates, and amounts.

- [ ] **Step 1: Extend the existing idempotent seed**

Ensure the demo company has 5–6 published objects, a dashboard opportunity mapping, and enough records to show at least four stages, multiple owners, a recent win, an overdue item, an unassigned record, and different employee totals. Use deterministic identifiers and upserts so rerunning the seed is safe.

- [ ] **Step 2: Apply migration and seed the configured local database**

Use the repository's existing migration and seed commands after checking its package scripts. Do not switch between Docker and host PostgreSQL silently; use the active `DATABASE_URL` documented for the current dev session.

- [ ] **Step 3: Run bounded verification**

```bash
pnpm --filter @crm/database build
pnpm --filter @crm/api typecheck
pnpm --filter @crm/web typecheck
git diff --check
```

Then run only the focused dashboard API tests, record-filter test, and workspace-home test from Tasks 1, 3, and 5.

- [ ] **Step 4: Perform two browser checks**

As a company administrator: confirm all selected status tags remain visible, dashboard configuration loads, team totals and leaderboard render, and a pipeline stage opens filtered real records.

As an employee: confirm the workbench differs from admin, only personal records contribute, no employee selector or team leaderboard appears, and an attention item opens an authorized record list.

- [ ] **Step 5: Commit seed and handoff updates**

```bash
git add apps/api/src/scripts/demo-company-fixture.ts apps/api/src/scripts/demo-company-fixture.spec.ts apps/api/src/scripts/seed-demo-company.ts HANDOFF.md
git commit -m "chore(demo): seed role dashboard data"
```

Omit any unchanged path from `git add`; never stage the whole repository.

---

## Self-Review

- Spec coverage: visible multi-select tags, configurable mappings, administrator aggregates, employee scope, charts, lists, attention states, settings entry, responsive layout, real data, drill-down, and bounded verification all have owning tasks.
- Scope intentionally deferred: target/quota configuration, probability-weighted forecasts, full activity timeline, template-carried dashboard mappings, and drag-reordering dashboard modules remain second-stage features from the spec.
- Type consistency: Tasks 3 and 5 share the single `DashboardOverview` shape; configuration field names match the design spec; role scope is decided by the API rather than UI parameters.
- Placeholder scan: implementation steps name concrete validation, data shapes, files, and commands, including the repository's existing demo-company fixture and seed entrypoint.
