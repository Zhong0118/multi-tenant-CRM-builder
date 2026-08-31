# Componentized Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the opportunity-specific tenant dashboard with a five-widget, draft-and-publication dashboard engine that binds to arbitrary published business objects and enforces current tenant permissions.

**Architecture:** A typed V2 dashboard definition is parsed and compiled by one deep `DashboardEngine` module. Tenant dashboard definitions store an editable draft and point to an immutable publication; runtime evaluation compiles visible widgets into parameterized record queries after applying the current user's effective object, field, and `ALL/OWN/NONE` access. Business templates can carry the same dashboard definition as an initialization preset.

**Tech Stack:** NestJS 11, Prisma 7/PostgreSQL JSONB and RLS, Next.js 16/React 19, Ant Design 6, dnd-kit, OpenAPI-generated TypeScript contracts, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-componentized-dashboard-design.md`

## Global Constraints

- Work on the current `main` checkout as requested; do not create a worktree.
- Preserve `.superpowers/sdd/2026-08-26-platform-business-template-designer/progress.md`, `apps/web/src/app/(auth)/register/page.tsx`, `chat会话.md`, `.claude/worktrees/`, `.codegraph/`, `.superpowers/brainstorm/`, and unrelated design documents.
- One tenant has one dashboard definition; widgets target `ALL`, `TENANT_ADMIN`, or `EMPLOYEE` audiences.
- Runtime reads only the active immutable publication; saving a draft never changes the active dashboard.
- Do not infer business meaning from object or field names.
- Employees never receive data outside current object, field, and `ALL/OWN/NONE` access.
- Support only `METRIC`, `STATUS_DISTRIBUTION`, `TREND`, `LEADERBOARD`, and `RECORD_LIST` widgets in V2.
- Support AND-only filters and the operators explicitly listed in the spec.
- Limit a dashboard to 24 widgets, record-list columns to 8, and record-list rows to 20.
- Do not add a cache, formula language, cross-object joins, pivot tables, or multiple dashboards.
- Keep verification focused: task-level tests, API/Web typechecks, contract drift, and one administrator/employee browser flow.

---

## File Structure

### Backend dashboard module

- `apps/api/src/modules/dashboards/dashboard-definition.ts`: V2 draft/publication types, strict structural parser, legacy adapter, normalization, semantic validator, and publication compiler.
- `apps/api/src/modules/dashboards/dashboard-definition.spec.ts`: focused parser, legacy conversion, widget validation, and permission-independent compilation tests.
- `apps/api/src/modules/dashboards/dashboard-engine.ts`: audience/access projection, query-plan construction, result isolation, and standard runtime result assembly.
- `apps/api/src/modules/dashboards/dashboard-engine.spec.ts`: focused audience, `OWN`, hidden-field, and isolated-failure tests through the engine interface.
- `apps/api/src/modules/dashboards/dashboard.types.ts`: persistence records, catalog, query-plan, widget-result, and API-facing domain types.
- `apps/api/src/modules/dashboards/dashboards.repository.ts`: Prisma persistence adapter plus parameterized widget query execution.
- `apps/api/src/modules/dashboards/dashboards.service.ts`: administrator draft/preview/publication use cases and runtime overview orchestration.
- `apps/api/src/modules/dashboards/dashboards.service.spec.ts`: draft concurrency, publish atomicity, and old-publication preservation tests.
- `apps/api/src/modules/dashboards/dashboards.controller.ts`: configuration, preview, publication, and overview routes.
- `apps/api/src/modules/dashboards/dto.ts`: OpenAPI DTOs for V2 configuration and runtime widget results.

### Database and template module

- `packages/database/prisma/schema.prisma`: dashboard definition/publication relations.
- `packages/database/prisma/migrations/0009_componentized_dashboards/migration.sql`: additive schema, legacy publication backfill, constraints, indexes, and RLS.
- `apps/api/src/modules/business-templates/business-template.schema.ts`: optional dashboard preset on template configuration.
- `apps/api/src/modules/business-templates/business-template-publication.policy.ts`: dashboard validation/compilation during template publication and checksum normalization.
- `apps/api/src/modules/business-templates/template-application.repository.ts`: create a tenant dashboard draft while applying a template.
- `apps/api/src/modules/business-templates/template-application.service.spec.ts`: focused preset-copy regression.

### Web dashboard module

- `apps/web/src/features/dashboard/dashboard-types.ts`: client-safe V2 draft, publication summary, candidate, issue, and result types.
- `apps/web/src/features/dashboard/dashboard-api.ts`: save-draft, preview, and publish calls.
- `apps/web/src/features/dashboard/dashboard-server.ts`: configuration and published overview loaders.
- `apps/web/src/features/dashboard/dashboard-builder.tsx`: three-column editor shell, dirty state, save, preview, and publish flow.
- `apps/web/src/features/dashboard/dashboard-widget-library.tsx`: five add-widget actions and current widget outline.
- `apps/web/src/features/dashboard/dashboard-canvas.tsx`: sortable widget cards, width controls, copy/delete, and inline issues.
- `apps/web/src/features/dashboard/dashboard-widget-inspector.tsx`: common properties plus per-widget field and filter editors.
- `apps/web/src/features/dashboard/dashboard-renderer.tsx`: shared administrator/employee published widget grid.
- `apps/web/src/features/dashboard/dashboard-builder.test.tsx`: focused add/delete/save/publish interaction tests.
- `apps/web/src/features/dashboard/dashboard-configuration.module.css`: fixed three-column builder layout and responsive behavior.
- `apps/web/src/features/dashboard/workbench.module.css`: published widget grid and common states.
- `apps/web/src/features/dashboard/admin-workbench.tsx`: thin wrapper around the shared renderer plus administrator actions.
- `apps/web/src/features/dashboard/employee-workbench.tsx`: thin wrapper around the shared renderer.
- `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/dashboard/page.tsx`: render `DashboardBuilder`.

### Contracts and demo

- `packages/contracts/openapi.json`: regenerated API schema.
- `packages/contracts/src/generated/openapi.ts`: regenerated client types.
- `apps/api/src/scripts/seed-demo-company.ts`: seed a V2 dashboard draft/publication or use the legacy adapter deterministically.

---

### Task 1: Define and validate the V2 dashboard language

**Files:**
- Create: `apps/api/src/modules/dashboards/dashboard-definition.ts`
- Create: `apps/api/src/modules/dashboards/dashboard-definition.spec.ts`
- Modify: `apps/api/src/modules/dashboards/dashboard.types.ts`

**Interfaces:**
- Consumes: `PublishedObjectSchema` from `apps/api/src/modules/objects/object-schema.ts`.
- Produces:
  - `parseDashboardDraft(value: unknown): DashboardDefinitionV2`
  - `normalizeDashboardDraft(value: DashboardDefinitionV2): DashboardDefinitionV2`
  - `migrateLegacyDashboard(value: unknown): DashboardDefinitionV2`
  - `validateDashboardDraft(value: DashboardDefinitionV2, catalog: DashboardCatalog): DashboardConfigurationIssue[]`
  - `compileDashboardPublication(value: DashboardDefinitionV2, catalog: DashboardCatalog): PublishedDashboardDefinitionV2`

- [ ] **Step 1: Write focused failing parser and migration tests**

Cover one structurally valid widget of each type, duplicate widget IDs, the 24-widget limit, an invalid filter/operator pair, and deterministic conversion of the existing `opportunity` configuration. Assert stable migrated IDs such as `legacy-opportunity-total`, `legacy-opportunity-pipeline`, `legacy-opportunity-trend`, `legacy-opportunity-leaderboard`, and `legacy-opportunity-records`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @crm/api test -- dashboard-definition.spec.ts --runInBand`

Expected: FAIL because `dashboard-definition.ts` and its exported functions do not exist.

- [ ] **Step 3: Implement the V2 discriminated unions and structural parser**

Use a shared base with `id`, `type`, `title`, optional `description`, `audience`, `objectCode`, `width`, `sortOrder`, and `filters`. Define the five widget variants with the exact constraints from the spec. Draft fields required for publication may be empty strings, but unknown keys, invalid enum values, duplicate IDs, malformed values, and more than 24 widgets are structural errors.

- [ ] **Step 4: Implement semantic validation, compilation, and legacy conversion**

Validate object existence, field type, option keys, filter compatibility, list limits, and required fields. Compilation must sort widgets, attach referenced object publication IDs and field/option display metadata, and throw only when semantic issues remain. Legacy conversion must be pure and idempotent.

- [ ] **Step 5: Run the focused test**

Run: `pnpm --filter @crm/api test -- dashboard-definition.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/api/src/modules/dashboards/dashboard-definition.ts apps/api/src/modules/dashboards/dashboard-definition.spec.ts apps/api/src/modules/dashboards/dashboard.types.ts
git commit -m "feat(dashboard): define componentized dashboard language"
```

### Task 2: Add draft and immutable publication persistence

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0009_componentized_dashboards/migration.sql`
- Modify: `apps/api/src/modules/dashboards/dashboards.repository.ts`
- Test: `packages/database/schema-contract.test.mjs`

**Interfaces:**
- Consumes: `DashboardDefinitionV2` and `PublishedDashboardDefinitionV2` from Task 1.
- Produces repository methods:
  - `getDefinition(context): Promise<DashboardDefinitionRecord | null>`
  - `saveDraft(context, expectedVersion, draft): Promise<DashboardDefinitionRecord | null>`
  - `publishDraft(context, expectedVersion, compiled, actorMemberId): Promise<DashboardPublicationRecord | null>`
  - `getActivePublication(context): Promise<DashboardPublicationRecord | null>`

- [ ] **Step 1: Extend the schema contract with failing assertions**

Assert that `TenantDashboardConfiguration` exposes mapped `draftVersion`, mapped `draftConfiguration`, nullable `activePublicationId`, nullable `sourceTemplateVersionId`, and a publication relation. Assert that `TenantDashboardPublication` has tenant-scoped unique publication numbers and a composite relation to the publishing tenant member.

- [ ] **Step 2: Run the database contract test and verify failure**

Run: `pnpm --filter @crm/database test`

Expected: FAIL because the publication model and relations are absent.

- [ ] **Step 3: Update Prisma models without discarding legacy columns**

Map `draftVersion` to the existing `version` column and `draftConfiguration` to the existing `configuration` column. Add `active_publication_id` and `source_template_version_id`. Add `TenantDashboardPublication` with `publication_no`, `source_draft_version`, JSONB `configuration`, publisher, timestamps, tenant-scoped uniqueness, and active-definition relation.

- [ ] **Step 4: Write the additive SQL migration and legacy backfill**

Create the publication table, indexes, foreign keys, and RLS policy using `app.tenant_id`. For each existing dashboard definition, insert publication number 1 containing its unchanged legacy JSON and update `active_publication_id`. Do not rewrite legacy JSON in SQL; Task 1's adapter handles it. Add the foreign key only after the backfill.

- [ ] **Step 5: Implement repository persistence methods**

Lock the definition row for save/publish. `saveDraft` changes only draft JSON/version. `publishDraft` checks `expectedVersion`, assigns `MAX(publication_no)+1` under the same tenant lock, inserts the immutable record, switches `activePublicationId`, and returns the publication. No update method for publication records is exposed.

- [ ] **Step 6: Validate Prisma and run the contract test**

Run: `pnpm --filter @crm/database exec prisma validate && pnpm --filter @crm/database test`

Expected: both commands PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/0009_componentized_dashboards/migration.sql packages/database/schema-contract.test.mjs apps/api/src/modules/dashboards/dashboards.repository.ts
git commit -m "feat(dashboard): persist drafts and publications"
```

### Task 3: Build the permission-aware dashboard engine and generic query adapter

**Files:**
- Create: `apps/api/src/modules/dashboards/dashboard-engine.ts`
- Create: `apps/api/src/modules/dashboards/dashboard-engine.spec.ts`
- Modify: `apps/api/src/modules/dashboards/dashboard.types.ts`
- Modify: `apps/api/src/modules/dashboards/dashboards.repository.ts`
- Modify: `apps/api/src/modules/dashboards/dashboards.module.ts`

**Interfaces:**
- Consumes: compiled publication, `TenantContext`, resolved object access, request period, and `DashboardQueryExecutor`.
- Produces:
  - `DashboardEngine.evaluate(input: DashboardEvaluationInput): Promise<DashboardRuntimeResult>`
  - `DashboardQueryExecutor.execute(context, plans): Promise<Map<string, DashboardWidgetResult>>`

- [ ] **Step 1: Write failing engine tests through the public interface**

Use a fake catalog/access resolver and query executor. Assert audience exclusion, employee `OWN` owner injection, `NONE` exclusion, hidden-field exclusion, administrator `ALL`, leaderboard collapse under `OWN`, and one executor failure becoming one `UNAVAILABLE` widget while another widget stays ready.

- [ ] **Step 2: Run the focused engine test and verify failure**

Run: `pnpm --filter @crm/api test -- dashboard-engine.spec.ts --runInBand`

Expected: FAIL because `DashboardEngine` does not exist.

- [ ] **Step 3: Implement access projection and query-plan compilation**

Resolve current access for every referenced object once. Build only plans whose audience and required fields are visible. Add the current member owner predicate for employee `OWN`; never accept an arbitrary employee owner ID from query input. Return administrator-only diagnostic reasons in preview mode.

- [ ] **Step 4: Implement parameterized filter and aggregation SQL**

Replace the opportunity-specific aggregate method with per-widget query methods behind `DashboardQueryExecutor`. Use `Prisma.sql`, `Prisma.join`, and validated field keys; values remain bound parameters. Implement count/sum/avg, single-select distribution, date truncation, record owner/member grouping, and limited record projection. Apply AND-only filters and tenant/object/deleted/owner predicates to every query.

- [ ] **Step 5: Run engine and existing dashboard tests**

Run: `pnpm --filter @crm/api test -- dashboard-engine.spec.ts dashboards.service.spec.ts dashboard-configuration.spec.ts --runInBand`

Expected: PASS after updating legacy expectations to use the adapter, with no broad suite required.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/api/src/modules/dashboards
git commit -m "feat(dashboard): evaluate permission-aware widgets"
```

### Task 4: Expose draft, preview, publish, and runtime use cases

**Files:**
- Modify: `apps/api/src/modules/dashboards/dashboards.service.ts`
- Modify: `apps/api/src/modules/dashboards/dashboards.service.spec.ts`
- Modify: `apps/api/src/modules/dashboards/dashboards.controller.ts`
- Modify: `apps/api/src/modules/dashboards/dto.ts`
- Modify: `apps/api/src/modules/dashboards/dashboards.module.ts`

**Interfaces:**
- Consumes: Task 1 parser/compiler, Task 2 repository, Task 3 engine.
- Produces:
  - `getConfiguration(context)` returning draft, active publication summary, candidates, and issues.
  - `saveDraft(context, {expectedVersion, configuration})`.
  - `preview(context, {expectedVersion, period})`.
  - `publish(context, {expectedVersion})`.
  - `getOverview(context, period)` returning widget results from the active publication.

- [ ] **Step 1: Replace service tests with failing draft/publication cases**

Test administrator-only save, employee rejection, incomplete draft save, optimistic conflict, successful publication, semantic publication rejection, old publication preservation, preview diagnostics, active-publication overview, and employee scope delegation to the engine.

- [ ] **Step 2: Run the focused service test and verify failure**

Run: `pnpm --filter @crm/api test -- dashboards.service.spec.ts --runInBand`

Expected: FAIL against the old immediate-save service.

- [ ] **Step 3: Implement service methods and audit calls**

Save structurally valid drafts without requiring semantic completeness. Publish only the saved version, compile against current object publications, create `dashboard.published`, and leave the active pointer unchanged on failure. Save emits `dashboard.draft_saved`. Overview reads active publication only; absence yields `UNCONFIGURED`.

- [ ] **Step 4: Add controller routes and OpenAPI DTOs**

Keep `GET/PUT configuration`; add `POST preview` and `POST publications`. Keep `GET overview` and period validation. Publication accepts only `expectedVersion`. DTOs model the five runtime result variants and component-level issue paths.

- [ ] **Step 5: Run service test and API typecheck**

Run: `pnpm --filter @crm/api test -- dashboards.service.spec.ts dashboard-definition.spec.ts dashboard-engine.spec.ts --runInBand && pnpm --filter @crm/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/api/src/modules/dashboards
git commit -m "feat(dashboard): add draft preview and publish APIs"
```

### Task 5: Carry dashboard presets through business templates

**Files:**
- Modify: `apps/api/src/modules/business-templates/business-template.schema.ts`
- Modify: `apps/api/src/modules/business-templates/business-template-publication.policy.ts`
- Modify: `apps/api/src/modules/business-templates/business-template-publication.policy.spec.ts`
- Modify: `apps/api/src/modules/business-templates/template-application.repository.ts`
- Modify: `apps/api/src/modules/business-templates/template-application.service.ts`
- Modify: `apps/api/src/modules/business-templates/template-application.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 draft parser/validator and existing template objects.
- Produces optional `dashboard?: DashboardDefinitionV2` in `BusinessTemplateConfiguration` and tenant dashboard draft creation during application.

- [ ] **Step 1: Write failing template publication and application tests**

Assert that an old template without `dashboard` still publishes, a valid preset is included in the compiled version/checksum, an invalid field reference blocks publication with a dashboard widget path, and applying a preset creates a tenant draft with `sourceTemplateVersionId` but no active publication.

- [ ] **Step 2: Run the two focused suites and verify failure**

Run: `pnpm --filter @crm/api test -- business-template-publication.policy.spec.ts template-application.service.spec.ts --runInBand`

Expected: FAIL because the schema and application store do not support dashboard presets.

- [ ] **Step 3: Extend template parsing, publication analysis, compilation, and checksum normalization**

Treat `dashboard` as optional for backward compatibility. Validate widget object codes and field keys against active template objects. Preserve the normalized dashboard in compiled template versions and stable checksum generation.

- [ ] **Step 4: Copy the preset during template application**

Inside the existing template-application transaction, create `TenantDashboardConfiguration` with draft version 1, the preset JSON, the applied template version ID, and a null active publication. Templates without a preset do not create a dashboard definition.

- [ ] **Step 5: Run focused template and dashboard tests**

Run: `pnpm --filter @crm/api test -- business-template-publication.policy.spec.ts template-application.service.spec.ts dashboard-definition.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/api/src/modules/business-templates
git commit -m "feat(template): initialize tenant dashboard presets"
```

### Task 6: Regenerate contracts and create the tenant dashboard builder

**Files:**
- Modify: `packages/contracts/openapi.json`
- Modify: `packages/contracts/src/generated/openapi.ts`
- Modify: `apps/web/src/features/dashboard/dashboard-types.ts`
- Modify: `apps/web/src/features/dashboard/dashboard-api.ts`
- Modify: `apps/web/src/features/dashboard/dashboard-server.ts`
- Create: `apps/web/src/features/dashboard/dashboard-builder.tsx`
- Create: `apps/web/src/features/dashboard/dashboard-widget-library.tsx`
- Create: `apps/web/src/features/dashboard/dashboard-canvas.tsx`
- Create: `apps/web/src/features/dashboard/dashboard-widget-inspector.tsx`
- Create: `apps/web/src/features/dashboard/dashboard-builder.test.tsx`
- Modify: `apps/web/src/features/dashboard/dashboard-configuration.module.css`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/dashboard/page.tsx`
- Remove: `apps/web/src/features/dashboard/dashboard-configuration-form.tsx`
- Remove: `apps/web/src/features/dashboard/dashboard-configuration-form.test.tsx`

**Interfaces:**
- Consumes: generated V2 OpenAPI schemas and the existing published-object candidate envelope.
- Produces `DashboardBuilder({tenantCode, initial})` and browser calls `saveDashboardDraft`, `previewDashboardDraft`, and `publishDashboardDraft`.

- [ ] **Step 1: Generate OpenAPI and typed contracts**

Run: `pnpm --filter @crm/api openapi:generate && pnpm --filter @crm/contracts generate`

Expected: generated files include configuration, preview, publication, and five widget result schemas.

- [ ] **Step 2: Write focused failing builder tests**

Test adding each component type through the library, selecting and deleting a component, dirty-state copy, save-draft request with expected version, publish disabled before saving, publish enabled after save, and inline issue focus. Mock only the three dashboard API calls.

- [ ] **Step 3: Run the focused web test and verify failure**

Run: `pnpm --filter @crm/web test:unit -- dashboard-builder.test.tsx`

Expected: FAIL because `DashboardBuilder` does not exist.

- [ ] **Step 4: Implement client types and API calls**

Parse generated responses defensively at the server boundary. Keep local draft state as V2, preserve server version/publication summary, and expose typed result unions to the renderer.

- [ ] **Step 5: Implement the three-column builder**

Use the already installed dnd-kit packages. Left column adds widgets and selects the outline item; center uses sortable cards with width, copy, delete, and inline issue controls; right column edits common and type-specific properties. Use explicit save, preview, and publish actions. Preserve local content on 409, show server version, and warn before leaving a dirty page.

- [ ] **Step 6: Implement responsive CSS without a drawer**

Desktop uses a fixed left library, flexible canvas, and fixed right inspector within the content area. Narrow layouts stack library, canvas, and inspector. Ensure internal columns scroll independently and do not stretch the application sidebar.

- [ ] **Step 7: Run the builder test and Web typecheck**

Run: `pnpm --filter @crm/web test:unit -- dashboard-builder.test.tsx && pnpm --filter @crm/web typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add packages/contracts apps/web/src/features/dashboard 'apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/dashboard/page.tsx'
git commit -m "feat(web): build componentized dashboard editor"
```

### Task 7: Render published widgets for administrators and employees

**Files:**
- Create: `apps/web/src/features/dashboard/dashboard-renderer.tsx`
- Modify: `apps/web/src/features/dashboard/admin-workbench.tsx`
- Modify: `apps/web/src/features/dashboard/employee-workbench.tsx`
- Modify: `apps/web/src/features/dashboard/workbench-charts.tsx`
- Modify: `apps/web/src/features/dashboard/workbench-elements.tsx`
- Modify: `apps/web/src/features/dashboard/workbench.module.css`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx`
- Modify: `apps/api/src/scripts/seed-demo-company.ts`

**Interfaces:**
- Consumes: `DashboardRuntimeResult` returned by `loadDashboardOverview`.
- Produces a shared `DashboardRenderer` with five render adapters and role-specific empty/action wrappers.

- [ ] **Step 1: Write failing runtime rendering tests**

Assert ordered width classes, one rendering case per widget type, empty data state, one `UNAVAILABLE` widget without hiding ready siblings, administrator configuration action, and employee “not enabled” copy.

- [ ] **Step 2: Run the focused workspace test and verify failure**

Run: `pnpm --filter @crm/web test:unit -- workspace-home-view.test.tsx`

Expected: FAIL because the old workbenches expect opportunity-specific overview arrays.

- [ ] **Step 3: Implement the shared renderer and thin role wrappers**

Map the five result variants to existing chart primitives where they fit, and use the existing record table/detail links for record lists. Render API-provided labels and colors. Do not reconstruct business semantics on the client.

- [ ] **Step 4: Update demo seed for deterministic V2 data**

Seed a saved V2 draft and an active publication containing representative components for the existing opportunity object. Keep the existing ten members, object definitions, and records; do not add a second fake dataset.

- [ ] **Step 5: Run focused Web test, API dashboard tests, and typechecks**

Run: `pnpm --filter @crm/web test:unit -- workspace-home-view.test.tsx dashboard-builder.test.tsx && pnpm --filter @crm/api test -- dashboard-definition.spec.ts dashboard-engine.spec.ts dashboards.service.spec.ts --runInBand && pnpm --filter @crm/api typecheck && pnpm --filter @crm/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add apps/web/src/features/dashboard 'apps/web/src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx' apps/api/src/scripts/seed-demo-company.ts
git commit -m "feat(web): render published dashboard widgets"
```

### Task 8: Apply migration and perform focused end-to-end verification

**Files:**
- Modify only files required by defects found in this task.

**Interfaces:**
- Consumes all earlier tasks.
- Produces an applied local migration, regenerated demo, clean focused verification, and a browser-verified administrator/employee workflow.

- [ ] **Step 1: Apply the local database migration**

Run: `pnpm --filter @crm/database prisma:migrate:deploy`

Expected: migration `0009_componentized_dashboards` applies successfully to the configured local PostgreSQL database.

- [ ] **Step 2: Reseed the existing demo company**

Run: `pnpm --filter @crm/api demo:seed`

Expected: existing demo tenant is updated deterministically with one active V2 dashboard publication.

- [ ] **Step 3: Run the final focused automated checks**

Run:

```bash
pnpm --filter @crm/api test -- dashboard-definition.spec.ts dashboard-engine.spec.ts dashboards.service.spec.ts business-template-publication.policy.spec.ts template-application.service.spec.ts --runInBand
pnpm --filter @crm/web test:unit -- dashboard-builder.test.tsx workspace-home-view.test.tsx
pnpm --filter @crm/api typecheck
pnpm --filter @crm/web typecheck
pnpm --filter @crm/contracts test
git diff --check
```

Expected: all commands PASS; the Ant Design jsdom pseudo-element warning is acceptable only if no assertion fails.

- [ ] **Step 4: Verify one administrator flow in the browser**

Open the demo tenant dashboard settings, add or edit one widget, save the draft, confirm the live dashboard is unchanged, preview, publish, and confirm the new publication appears on the administrator home. Check the browser console for new errors.

- [ ] **Step 5: Verify one employee flow in the browser**

Open the same tenant as an employee with `OWN` access. Confirm administrator-only widgets are absent, employee/all widgets display only owned data, hidden fields are not rendered, record-list rows open existing details, and the browser console has no new errors.

- [ ] **Step 6: Commit verification fixes if any**

Run `git status --short`, stage only the dashboard files changed to correct a verified defect, then commit them with `git commit -m "fix(dashboard): resolve componentized workflow defects"`. Skip this commit when Step 3 through Step 5 require no code changes.
