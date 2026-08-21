# Dynamic Objects and Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a tenant-configurable business-object designer and published-schema-driven record CRUD flow with server-enforced object, scope, and field permissions.

**Architecture:** Normalized object/field/view/role-permission tables are the editable draft. Publishing compiles an immutable `PublishedObjectSchema`; runtime navigation, forms, validation, permissions, and records read only the active publication, plus live member object overrides. PostgreSQL RLS enforces tenant isolation while deep API modules centralize publication, access resolution, and dynamic value validation.

**Tech Stack:** PostgreSQL 18, Prisma 7, NestJS 11, OpenAPI, Next.js 16, React 19, Ant Design 6, React Hook Form, Zod, TanStack Query, Jest, Vitest, Node PostgreSQL integration tests.

**Spec:** `docs/superpowers/specs/2026-08-21-dynamic-objects-records-design.md`

## Global Constraints

- Work inline on `main`; the user explicitly selected Inline Execution and approved direct development.
- Preserve the user's uncommitted `apps/web/src/app/(auth)/register/page.tsx` copy change and untracked `chat会话.md`.
- `tenant_id` remains a mandatory isolation key; the runtime database role remains `NOBYPASSRLS`.
- Runtime records use only `active_publication_id`; draft edits never change current forms or validation.
- No Baijie-specific object names, fields, stages, conversions, or metrics enter platform modules.
- Supported field types are exactly `TEXT`, `TEXTAREA`, `PHONE`, `EMAIL`, `NUMBER`, `MONEY`, `DATE`, `DATETIME`, `SINGLE_SELECT`, `MULTI_SELECT`, `MEMBER`, and `BOOLEAN`.
- `MONEY` is a normalized decimal string; `statusKey` remains null in this slice.
- Tenant administrators have fixed full access. Employee role access is published; member object overrides are live and field access remains role-level.
- Hidden fields never appear in schema or record responses; read-only/hidden values submitted by a client are rejected, not silently ignored.
- No Playwright. Web behavior uses component tests plus the user's final manual acceptance.
- Follow the approved “configuration ledger” visual language and tokens from the spec; Ant Design remains the only component system.

---

### Task 1: Add the Published-Object Database Model and RLS

**Files:**

- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0003_dynamic_objects_records/migration.sql`
- Modify: `packages/database/test/integration/helpers.mjs`
- Create: `packages/database/test/integration/dynamic-objects.test.mjs`
- Modify: `packages/database/schema-contract.test.mjs`
- Modify: `packages/database/package.json`

**Interfaces:**

- Consumes: existing `Tenant`, `TenantMember`, `ObjectDefinition`, `FieldDefinition`, `Record`, and `createDatabaseClient`.
- Produces: Prisma models `ObjectPublication`, `ViewDefinition`, `ObjectPermission`, `FieldPermission`, `RecordCounter`; `ObjectDefinition.activePublicationId/publishedAt/sortOrder`; RLS-protected tables and test cleanup.

- [x] **Step 1: Write the failing PostgreSQL integration test**

Create a test that inserts two tenants, object drafts, fields, default views, role policies, and publications under the admin connection, then uses `withSettings(runtime, { tenantId })` to assert tenant A cannot see tenant B configuration. Assert a direct runtime query without `app.tenant_id` returns zero rows. Attempt `UPDATE object_publications` and expect PostgreSQL rejection. Start two transactions that increment one `record_counters` row with `SELECT ... FOR UPDATE` and assert allocated numbers are `1` and `2`.

- [x] **Step 2: Run the integration test and observe RED**

Run:

```bash
set -a && source .env && set +a
pnpm --filter @crm/database build
node --test packages/database/test/integration/dynamic-objects.test.mjs
```

Expected: FAIL because the five new tables and `active_publication_id` do not exist.

- [x] **Step 3: Add exact Prisma enums and relations**

Add enums:

```prisma
enum ViewType { TABLE }
enum ViewStatus { ACTIVE INACTIVE }
enum PermissionSubjectType { ROLE MEMBER }
enum DataScope { ALL OWN NONE }
enum FieldAccess { EDIT READ_ONLY HIDDEN }
```

Add the five models with composite tenant foreign keys, uniqueness from the spec, and `Json @db.JsonB` configuration/change summary. Add two named relations from `ObjectDefinition` to publications so the object owns publication history and optionally selects `activePublication`.

- [x] **Step 4: Write migration SQL and RLS policies**

Create tables, FKs, indexes, and policies. Add an immutability trigger:

```sql
CREATE FUNCTION reject_object_publication_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'object_publications are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER object_publications_immutable_update
BEFORE UPDATE ON object_publications
FOR EACH ROW EXECUTE FUNCTION reject_object_publication_mutation();
```

Enable and force RLS on every new tenant table. Grant only required table privileges to `crm_app`; grant no UPDATE/DELETE on `object_publications`. The migration administrator retains DELETE solely for controlled test/maintenance cleanup, while UPDATE is rejected by the trigger for every role.

- [x] **Step 5: Extend cleanup and verify GREEN**

Delete new tables in FK-safe order before objects/tenants. Run:

```bash
pnpm --filter @crm/database prisma:format
pnpm --filter @crm/database prisma:validate
pnpm --filter @crm/database build
pnpm --filter @crm/database test
pnpm --filter @crm/database test:integration
```

Expected: schema contract and all PostgreSQL integration tests pass.

- [x] **Step 6: Commit**

```bash
git add packages/database
git commit -m "feat(database): add published object configuration model"
```

---

### Task 2: Define and Compile Published Object Schemas

**Files:**

- Create: `apps/api/src/modules/objects/object-schema.ts`
- Create: `apps/api/src/modules/objects/object-publication.policy.ts`
- Create: `apps/api/src/modules/objects/object-publication.policy.spec.ts`
- Modify: `apps/api/src/common/errors/api-error-code.ts`

**Interfaces:**

- Consumes: draft object, field, view, role permission, and field permission data.
- Produces: `PublishedField`, `PublishedObjectSchema`, `PublicationAnalysis`, `analyzePublication(input)`, and `compilePublication(input)`.

- [x] **Step 1: Write failing publication-policy tests**

Use literal fixtures. Assert the policy blocks: no required title field; unsupported title type; missing default view; default-view column referencing an inactive field; missing explicit employee role policy; duplicate option keys; making a new required field when active records exist. Assert it reports an added optional field as a non-blocking change. Assert the compiled schema exactly matches the stable structure in the spec and excludes draft timestamps/member overrides.

- [x] **Step 2: Run RED**

```bash
pnpm --filter @crm/api test -- object-publication.policy.spec.ts
```

Expected: FAIL because the schema and compiler modules do not exist.

- [x] **Step 3: Implement immutable schema types and analysis**

Define:

```ts
export interface PublicationAnalysis {
  blocking: Array<{ code: string; message: string; fieldKey?: string }>;
  warnings: Array<{ code: string; message: string; fieldKey?: string }>;
  changes: Array<{
    kind: "ADDED" | "UPDATED" | "INACTIVATED";
    fieldKey: string;
  }>;
}

export function analyzePublication(
  input: PublicationDraft,
): PublicationAnalysis;
export function compilePublication(
  input: PublicationDraft & {
    publication: PublishedObjectSchema["publication"];
  },
): PublishedObjectSchema;
```

Freeze no runtime objects; immutability is a database and interface invariant. Sort fields by `sortOrder` then `fieldKey` so snapshot output is deterministic.

- [x] **Step 4: Add stable error codes**

Add all spec codes to `API_ERROR_CODES` and Chinese messages. `PUBLICATION_BLOCKED` uses HTTP 422; config and record version conflicts use 409; forbidden fields/actions use 403; not-found codes use 404.

- [x] **Step 5: Verify GREEN and commit**

```bash
pnpm --filter @crm/api test -- object-publication.policy.spec.ts api-exception.filter.spec.ts
pnpm --filter @crm/api typecheck
git add apps/api/src/modules/objects apps/api/src/common/errors/api-error-code.ts
git commit -m "feat(objects): compile immutable published schemas"
```

---

### Task 3: Build the Dynamic Record Value Engine

**Files:**

- Create: `apps/api/src/modules/records/record-value-engine.ts`
- Create: `apps/api/src/modules/records/record-value-engine.spec.ts`
- Create: `apps/api/src/modules/objects/effective-access.ts`
- Create: `apps/api/src/modules/objects/effective-access.spec.ts`

**Interfaces:**

- Consumes: `PublishedObjectSchema`, `TenantContext`, optional live member override, existing record values.
- Produces: `EffectiveObjectAccess`, `resolveEffectiveAccess`, `validateRecordMutation`, `projectVisibleValues`.

- [ ] **Step 1: Write failing access matrix tests**

Assert tenant admin receives all actions/ALL/every field EDIT. Assert employee uses published role policy. Assert a live member override replaces action/scope values rather than unioning them. Assert missing employee permission resolves to no actions/NONE. Assert member overrides never change field access.

- [ ] **Step 2: Write failing value tests**

Table-drive each supported field type with hand-written valid and invalid expected values. Include lowercase email, UTC datetime, fixed-scale money string, deduplicated multi-select, inactive option rejection, MEMBER validator callback, missing required title, unknown field, read-only/hidden forged fields, PATCH missing-versus-null semantics, derived title, and hidden-field response projection.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @crm/api test -- effective-access.spec.ts record-value-engine.spec.ts
```

Expected: FAIL on missing functions.

- [ ] **Step 4: Implement the two deep modules**

Use one field-type switch inside `record-value-engine.ts`; services/controllers must not switch on field types. Export:

```ts
export function resolveEffectiveAccess(input: {
  schema: PublishedObjectSchema;
  role: "TENANT_ADMIN" | "EMPLOYEE";
  memberOverride?: ObjectAccessPolicy;
}): EffectiveObjectAccess;

export async function validateRecordMutation(input: {
  mode: "CREATE" | "UPDATE";
  schema: PublishedObjectSchema;
  access: EffectiveObjectAccess;
  submitted: Record<string, unknown>;
  current?: Record<string, unknown>;
  memberExists: (id: string) => Promise<boolean>;
}): Promise<{ values: Record<string, unknown>; title: string }>;
```

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --filter @crm/api test -- effective-access.spec.ts record-value-engine.spec.ts
pnpm --filter @crm/api lint
pnpm --filter @crm/api typecheck
git add apps/api/src/modules/objects apps/api/src/modules/records
git commit -m "feat(records): validate dynamic values and access"
```

---

### Task 4: Implement Object Draft and Publication Use Cases

**Files:**

- Create: `apps/api/src/modules/objects/dto/object.dto.ts`
- Modify: `apps/api/src/modules/objects/dto/index.ts`
- Create: `apps/api/src/modules/objects/objects.repository.ts`
- Modify: `apps/api/src/modules/objects/objects.service.ts`
- Create: `apps/api/src/modules/objects/objects.service.spec.ts`
- Modify: `apps/api/src/modules/objects/objects.controller.ts`
- Modify: `apps/api/src/modules/objects/objects.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Delete: `apps/api/src/modules/fields/fields.controller.ts`
- Delete: `apps/api/src/modules/fields/fields.module.ts`
- Delete: `apps/api/src/modules/fields/fields.service.ts`
- Delete: `apps/api/src/modules/views/views.controller.ts`
- Delete: `apps/api/src/modules/views/views.module.ts`
- Delete: `apps/api/src/modules/views/views.service.ts`
- Delete: `apps/api/src/modules/permissions/permissions.controller.ts`
- Delete: `apps/api/src/modules/permissions/permissions.module.ts`
- Delete: `apps/api/src/modules/permissions/permissions.service.ts`

**Interfaces:**

- Consumes: Task 1 Prisma models, Task 2 compiler, `TenantContext`, `AuditService`.
- Produces: every configuration route in spec section 7.1 except live member override; `OBJECTS_REPOSITORY` interface and transactional Prisma adapter.

- [ ] **Step 1: Write failing service tests**

Test tenant-admin-only mutation, normalized lowercase object code, duplicate conflict, optimistic draft update, stable key/type after first publication, field inactivation instead of deletion, deterministic field and object reorder, publication analysis, blocked publish, serial publication numbers, active publication pointer update, archive rules, and audit event contents. Use an in-memory repository that implements the exact production repository interface; assert returned behavior, not mock call existence.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/api test -- objects.service.spec.ts
```

- [ ] **Step 3: Implement DTOs**

DTOs expose controlled properties only. Define separate discriminated field config DTOs; reject unknown properties globally. `CreateObjectDefinitionDto` contains `name`, lowercase `code`, optional controlled icon. `PublishObjectDto` and analysis DTO contain only `expectedVersion`.

- [ ] **Step 4: Implement repository transactions**

Every repository entry uses `DatabaseContextRunner.withTenant(context, work)`. `publish` locks the object row, reloads the complete draft, repeats analysis, inserts publication and audit, then updates `activePublicationId/status/publishedAt` atomically. Use a SQL increment/query for publication number under the same object lock.

- [ ] **Step 5: Implement controllers and remove shallow placeholder modules**

Register configuration routes under `workspaces/:tenantCode/object-definitions`, including `PUT /object-definitions/order`, guarded by `SessionAuthGuard` and `WorkspaceGuard`; service enforces `TENANT_ADMIN`. Remove `FieldsModule`, `ViewsModule`, and `PermissionsModule` imports from `AppModule` and delete their nine empty controller/module/service files listed above because field, view, and permission behavior now lives behind the Objects module interface. Keep each existing `dto/index.ts` as an empty reserved directory marker required by the repository architecture.

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @crm/api test -- objects.service.spec.ts
pnpm --filter @crm/api test
pnpm --filter @crm/api lint
pnpm --filter @crm/api typecheck
git add apps/api
git commit -m "feat(objects): add draft and publication endpoints"
```

---

### Task 5: Resolve Runtime Schemas and Accessible Object Navigation

**Files:**

- Create: `apps/api/src/modules/objects/published-object.repository.ts`
- Create: `apps/api/src/modules/objects/published-object.service.ts`
- Create: `apps/api/src/modules/objects/published-object.service.spec.ts`
- Modify: `apps/api/src/modules/objects/objects.controller.ts`
- Modify: `apps/api/src/modules/objects/objects.module.ts`

**Interfaces:**

- Consumes: active publication JSON, live `ObjectPermission` member row, Task 3 access resolver.
- Produces: `listAccessible(context)`, `resolveRuntimeSchema(context, objectCode)`, `ResolvedObjectSchema { schema, access, visibleSchema }`, and runtime `GET /objects`, `GET /objects/:objectCode/schema`.

- [ ] **Step 1: Write failing runtime resolver tests**

Assert unpublished/archived objects are absent, employee no-read objects are absent, admin sees every active object in `sortOrder`, member override changes access immediately, hidden fields are removed from fields/default-view columns, and a cross-tenant/missing code maps to `OBJECT_NOT_FOUND`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/api test -- published-object.service.spec.ts
```

- [ ] **Step 3: Implement repository and service**

Parse persisted JSON through a strict runtime validator before treating it as `PublishedObjectSchema`; malformed snapshots raise `INTERNAL_ERROR` and log no field values. Do not return draft versions or member override internals to Web.

- [ ] **Step 4: Add runtime endpoints and verify**

```bash
pnpm --filter @crm/api test -- published-object.service.spec.ts
pnpm --filter @crm/api typecheck
git add apps/api/src/modules/objects
git commit -m "feat(objects): resolve accessible published schemas"
```

---

### Task 6: Implement Tenant-Scoped Dynamic Record CRUD

**Files:**

- Create: `apps/api/src/modules/records/dto/record.dto.ts`
- Modify: `apps/api/src/modules/records/dto/index.ts`
- Create: `apps/api/src/modules/records/records.repository.ts`
- Modify: `apps/api/src/modules/records/records.service.ts`
- Create: `apps/api/src/modules/records/records.service.spec.ts`
- Modify: `apps/api/src/modules/records/records.controller.ts`
- Modify: `apps/api/src/modules/records/records.module.ts`
- Create: `apps/api/test/dynamic-records.e2e-spec.ts`

**Interfaces:**

- Consumes: `PublishedObjectService`, `RecordValueEngine`, `ContextRunner`, Prisma `Record/RecordCounter`, `AuditService`.
- Produces: nested record list/create/read/update/delete routes and permission-projected response DTOs.

- [ ] **Step 1: Write failing service behavior tests**

Assert CREATE action, admin owner validation, employee owner forced to self, OWN list/read/update, stable page/limit/sort, title search, hidden projection, optimistic update conflict, soft delete admin-only, record-not-found privacy, and audit before/after values excluding hidden data from response but retaining server-side audited normalized values.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/api test -- records.service.spec.ts
```

- [ ] **Step 3: Implement repository and record numbers**

Create record in one tenant transaction. Lock/upsert `record_counters`, allocate the current number, increment, insert record with `statusKey: null`, and append audit. List predicates include tenant/object/deleted, access OWN predicate, title search, optional owner for admins, and an ID tie-breaker after requested sort.

- [ ] **Step 4: Implement DTO/controller**

Use JSON object validation for `values`, UUID validation for owner, and integer constraints for version/page/limit. PATCH missing values preserve current values; explicit null reaches the value engine. DELETE responds `{ accepted: true }`.

- [ ] **Step 5: Write and run API E2E**

The E2E provisions platform admin, tenant admin, employee, a published object, and records. Prove cross-tenant denial, OWN scope, hidden/read-only handling, concurrent record numbers, and optimistic update conflict through HTTP rather than direct service calls.

```bash
set -a && source .env && set +a
pnpm --filter @crm/api test -- records.service.spec.ts
pnpm --filter @crm/api test:e2e -- dynamic-records.e2e-spec.ts
pnpm --filter @crm/api lint
pnpm --filter @crm/api typecheck
git add apps/api
git commit -m "feat(records): add published-schema CRUD"
```

---

### Task 7: Add Live Member Object Overrides

**Files:**

- Modify: `apps/api/src/modules/memberships/dto/membership.dto.ts`
- Modify: `apps/api/src/modules/memberships/memberships.controller.ts`
- Modify: `apps/api/src/modules/memberships/memberships.repository.ts`
- Modify: `apps/api/src/modules/memberships/memberships.service.ts`
- Modify: `apps/api/src/modules/memberships/memberships.service.spec.ts`
- Modify: `apps/api/test/dynamic-records.e2e-spec.ts`

**Interfaces:**

- Consumes: published objects and `ObjectPermission` MEMBER rows.
- Produces: `GET /workspaces/:tenantCode/members/:memberId/object-access`, `PUT /workspaces/:tenantCode/members/:memberId/object-access/:objectId`, inherited/override response, immediate resolver behavior.

- [ ] **Step 1: Write failing membership tests**

Assert only tenant admins can read/change access, the GET result joins every active published object with inherited and optional override values, target is an active employee in the same tenant, object is currently published/active, `mode: INHERIT` deletes the MEMBER row, `mode: OVERRIDE` replaces the entire action/scope policy, employee delete remains false, and every change writes audit.

- [ ] **Step 2: Run RED and implement**

```bash
pnpm --filter @crm/api test -- memberships.service.spec.ts
```

Add DTO:

```ts
type MemberObjectAccessInput =
  | { mode: "INHERIT" }
  | {
      mode: "OVERRIDE";
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      readScope: "ALL" | "OWN" | "NONE";
      updateScope: "ALL" | "OWN" | "NONE";
    };
```

- [ ] **Step 3: Extend E2E and commit**

Change an employee from published OWN access to a NONE override and assert the next schema/record request is rejected without republishing. Restore INHERIT and assert access returns.

```bash
pnpm --filter @crm/api test -- memberships.service.spec.ts
pnpm --filter @crm/api test:e2e -- dynamic-records.e2e-spec.ts
git add apps/api
git commit -m "feat(members): add live object access overrides"
```

---

### Task 8: Generate and Lock the OpenAPI Contract

**Files:**

- Modify: `packages/contracts/openapi.json`
- Modify: `packages/contracts/src/generated/openapi.ts`
- Modify: `packages/contracts/contract-drift.test.mjs`

**Interfaces:**

- Consumes: all Task 4–7 DTO decorators/routes.
- Produces: generated path/types consumed by Web.

- [ ] **Step 1: Extend the contract test before generation**

Assert exact paths for object definitions/publications/runtime schema/records/member access, plus the stable error envelope and `PublishedObjectSchemaResponseDto` component.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/contracts test
```

- [ ] **Step 3: Generate, inspect, and verify GREEN**

```bash
pnpm contracts:generate
pnpm --filter @crm/contracts test
pnpm --filter @crm/contracts typecheck
pnpm contracts:check
git add packages/contracts
git commit -m "feat(contracts): expose dynamic object APIs"
```

---

### Task 9: Build Typed Web Object/Record Modules and Dynamic Navigation

**Files:**

- Create: `apps/web/src/features/objects/object-api.ts`
- Create: `apps/web/src/features/objects/object-types.ts`
- Create: `apps/web/src/features/records/record-api.ts`
- Create: `apps/web/src/features/records/dynamic-field.tsx`
- Create: `apps/web/src/features/records/dynamic-field.test.tsx`
- Modify: `apps/web/src/components/navigation/workspace-navigation.ts`
- Modify: `apps/web/src/components/layout/workspace-shell.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/layout.tsx`
- Create: `apps/web/src/lib/auth/require-runtime-objects.ts`
- Create: `apps/web/src/lib/auth/require-runtime-objects.test.ts`

**Interfaces:**

- Consumes: generated OpenAPI paths.
- Produces: typed browser/server operations, `DynamicField`, server-fetched accessible object navigation.

- [ ] **Step 1: Write failing dynamic-field and navigation tests**

Render literal published fields and assert correct Ant controls, labels, option state, MEMBER options, read-only text/lock explanation, hidden omission, money/date normalization handoff, keyboard labels, and employee-hidden object navigation omission.

- [ ] **Step 2: Run RED and implement typed modules**

```bash
pnpm --filter @crm/web test:unit -- dynamic-field.test.tsx require-runtime-objects.test.ts
```

Object and record API modules call generated paths only and translate failures through `toApiError`. `WorkspaceShell` accepts `businessObjects` separately from system navigation and labels the two groups “业务对象” and “工作空间”.

- [ ] **Step 3: Verify and commit**

```bash
pnpm --filter @crm/web test
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
git add apps/web
git commit -m "feat(web): add dynamic object clients and navigation"
```

---

### Task 10: Build the Configuration-Ledger Object Designer

**Files:**

- Create: `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/objects/page.tsx`
- Create: `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/objects/new/page.tsx`
- Create: `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/objects/[objectId]/page.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/page.tsx`
- Create: `apps/web/src/features/objects/object-list.tsx`
- Create: `apps/web/src/features/objects/create-object-form.tsx`
- Create: `apps/web/src/features/objects/object-designer.tsx`
- Create: `apps/web/src/features/objects/field-ledger.tsx`
- Create: `apps/web/src/features/objects/field-editor-drawer.tsx`
- Create: `apps/web/src/features/objects/publication-panel.tsx`
- Create: `apps/web/src/features/objects/object-preview.tsx`
- Create: `apps/web/src/features/objects/objects.module.css`
- Create: `apps/web/src/features/objects/object-designer.test.tsx`
- Create: `apps/web/src/features/objects/publication-panel.test.tsx`

**Interfaces:**

- Consumes: Task 9 object API/types and approved visual tokens.
- Produces: tenant-admin object list/create/designer/preview/publication pages.

- [ ] **Step 1: Write failing behavior tests**

Assert list empty/action states, lowercase code validation, object status copy, stable field key display, type lock after publication, field access labels, reorder result, admin/employee preview differences, unpublished-change badge, blocking-versus-warning publication content, version-conflict preservation, and no mobile editing controls below the desktop breakpoint.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @crm/web test:unit -- object-designer.test.tsx publication-panel.test.tsx
```

- [ ] **Step 3: Implement the approved visual system**

Use CSS variables for Ledger Ink, Working Blue, Canvas, Paper, Rule, Verified Teal, and Review Amber. `FieldLedger` is the single signature element: one structural rule, sortable field rows, monospace stable keys, explicit type/required/access text. Keep page radius 6–8px and avoid gradient/stat-card decoration.

- [ ] **Step 4: Implement interactions**

Only one primary action (“发布变更”). Field drawer sections are Display, Data Type, Validation/Options, Employee Access. Publication opens analysis first; blocking rows cannot confirm. React Query invalidates only tenant/object keys. 409 leaves draft controls untouched and offers reload.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @crm/web test
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
pnpm --filter @crm/web build
git add apps/web
git commit -m "feat(web): add configuration-ledger object designer"
```

---

### Task 11: Build Dynamic Record List, Form, and Detail Pages

**Files:**

- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/objects/[objectCode]/page.tsx`
- Create: `apps/web/src/app/(workspace)/workspace/[tenantCode]/objects/[objectCode]/new/page.tsx`
- Create: `apps/web/src/app/(workspace)/workspace/[tenantCode]/objects/[objectCode]/[recordId]/page.tsx`
- Create: `apps/web/src/features/records/record-list.tsx`
- Create: `apps/web/src/features/records/record-form.tsx`
- Create: `apps/web/src/features/records/record-detail-drawer.tsx`
- Create: `apps/web/src/features/records/record-query-state.ts`
- Create: `apps/web/src/features/records/records.module.css`
- Create: `apps/web/src/features/records/record-form.test.tsx`
- Create: `apps/web/src/features/records/record-list.test.tsx`
- Create: `apps/web/src/features/records/record-detail-drawer.test.tsx`

**Interfaces:**

- Consumes: runtime schema and record API from Task 9.
- Produces: published-schema-driven list/create/deep-link detail/update/delete UI.

- [ ] **Step 1: Write failing list/query tests**

Assert server pagination, title search, admin owner filter, OWN page title, URL persistence, default-view visible columns, no create button without access, distinct empty-versus-filter-empty states, and record deep link.

- [ ] **Step 2: Write failing form/detail tests**

Assert published field order, values built without hidden fields, read-only normal text, first-error focus, preserved values on API error, owner behavior by role, PATCH version inclusion, conflict reload prompt, desktop 640px drawer, mobile full screen, focus restoration, and admin-only soft-delete confirmation.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @crm/web test:unit -- record-list.test.tsx record-form.test.tsx record-detail-drawer.test.tsx
```

- [ ] **Step 4: Implement pages and styling**

Use one primary action per page. Keep table/default columns stable during loading. Use `router.replace` for query state and preserve the list URL when opening/closing detail. Do not show an activity timeline placeholder; show only fields and audit metadata available in this slice.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @crm/web test
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
pnpm --filter @crm/web build
git add apps/web
git commit -m "feat(web): add dynamic record workspace"
```

---

### Task 12: Build the Member Object Access Page

**Files:**

- Create: `apps/web/src/app/(workspace)/workspace/[tenantCode]/members/[memberId]/access/page.tsx`
- Create: `apps/web/src/features/members/member-object-access.tsx`
- Create: `apps/web/src/features/members/member-object-access.test.tsx`
- Modify: `apps/web/src/features/members/member-table.tsx`
- Modify: `apps/web/src/features/members/members.module.css`

**Interfaces:**

- Consumes: member list, accessible published objects for admins, member override endpoint.
- Produces: inherited-versus-override permission matrix and navigation from member management.

- [ ] **Step 1: Write failing tests**

Assert employees show an “访问权限” link, admins do not receive editable downgrade controls, each published object shows inherited values, switching to override reveals the complete action/scope form, save replaces the whole policy, switching back to inherit deletes override, and copy says the change is immediate.

- [ ] **Step 2: Run RED, implement, verify, commit**

```bash
pnpm --filter @crm/web test:unit -- member-object-access.test.tsx member-table.test.tsx
pnpm --filter @crm/web test
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
git add apps/web
git commit -m "feat(web): add member object access controls"
```

---

### Task 13: Update Delivery Documentation and Run the Complete Gate

**Files:**

- Modify: `README.md`
- Modify: `docs/design/02-页面功能列表.md`
- Modify: `docs/design/03-数据模型定义.md`
- Modify: `docs/design/06-页面设计.md`
- Modify: `docs/superpowers/specs/2026-08-21-dynamic-objects-records-design.md`
- Modify: `package.json` only if a missing existing verification script must be composed; do not add Playwright.

**Interfaces:**

- Consumes: completed slice and actual verification output.
- Produces: truthful delivery status, manual acceptance checklist, root verification path.

- [ ] **Step 1: Update documents truthfully**

Mark second-slice models/routes/pages implemented only after their tests pass. Add local migration command, tenant-admin object workflow, supported field types, publication warning, and manual acceptance sequence. Change spec state to `已实现；待项目负责人人工验收` before handoff and to `已实现；人工验收通过` only after the user confirms.

- [ ] **Step 2: Run complete automated verification**

```bash
set -a && source .env && set +a
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @crm/database test:integration
pnpm --filter @crm/api test:e2e
pnpm contracts:check
pnpm build
pnpm --filter @crm/database prisma:validate
git diff --check
```

Expected: every command exits 0. Existing user changes remain unstaged.

- [ ] **Step 3: Commit automated delivery state**

```bash
git add README.md docs package.json
git commit -m "docs: deliver dynamic objects and records slice"
```

- [ ] **Step 4: Hand off manual acceptance**

Ask the project owner to run exactly:

```text
管理员创建对象 → 添加标题/普通/只读/隐藏字段 → 配置员工 OWN 权限
→ 发布 → 管理员创建并编辑记录 → 员工登录验证导航、OWN、只读、隐藏
→ 管理员修改成员覆盖为 NONE 并确认立即失效 → 恢复继承
```

Do not claim browser acceptance before this confirmation.
