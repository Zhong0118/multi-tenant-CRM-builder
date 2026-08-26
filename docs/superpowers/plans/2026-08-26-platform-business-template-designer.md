# Platform Business Template Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, fully tested platform business-template designer that publishes immutable multi-object template versions and safely instantiates the current version as editable object drafts in an empty draft tenant.

**Architecture:** Store each editable template and immutable version as a JSONB aggregate behind a small lifecycle interface. Reuse one pure object-configuration policy for both tenant-object publication and template publication, then use a separate transactional application module to hydrate normalized tenant object, field, view, and permission rows with fresh IDs.

**Tech Stack:** NestJS 11, Prisma 7/PostgreSQL RLS, Next.js 16, React 19, Ant Design 6, TanStack Query, generated OpenAPI TypeScript contracts, Jest, Vitest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-26-platform-business-template-designer-design.md`

## Global Constraints

- Platform admins create reusable templates; tenant admins own and publish the resulting tenant object drafts.
- Applying a template never creates an `object_publication` or changes an active tenant schema.
- Only the current immutable template version can be applied, and only to a `DRAFT` tenant with no object rows of any status.
- Supported field types are exactly `TEXT`, `TEXTAREA`, `PHONE`, `EMAIL`, `NUMBER`, `MONEY`, `DATE`, `DATETIME`, `SINGLE_SELECT`, `MULTI_SELECT`, `MEMBER`, and `BOOLEAN`; `ATTACHMENT` remains blocked.
- Web code uses generated OpenAPI paths and types; generated contract files are regenerated, never hand-edited.
- Keep `apps/web/src/app/(auth)/register/page.tsx`, `chat会话.md`, `.claude/worktrees/`, and the untracked V2/V3/08 design documents untouched and unstaged.
- Work locally on `main`; do not reset, rebase, push, deploy, or run `git add .`.
- Each task starts with a failing behavior test, implements the smallest passing slice, and commits only its listed files.

---

### Task 1: Share Object-Configuration Publication Rules

**Files:**
- Create: `apps/api/src/modules/objects/object-configuration.policy.ts`
- Create: `apps/api/src/modules/objects/object-configuration.policy.spec.ts`
- Modify: `apps/api/src/modules/objects/object-publication.policy.ts`
- Modify: `apps/api/src/modules/objects/object-publication.policy.spec.ts`

**Interfaces:**
- Consumes: existing `PublicationDraftField`, `PublishedField`, `PublishedFieldAccess`, and `PublishedDataScope` types.
- Produces: `analyzeObjectConfiguration(input: ObjectConfigurationDraft): ObjectConfigurationAnalysis` and `compileObjectConfiguration(input: CompleteObjectConfigurationDraft): ObjectConfigurationSnapshot`.
- Preserves: `analyzePublication()` and `compilePublication()` signatures used by `ObjectsService`.

- [ ] **Step 1: Write failing behavior tests through the existing publication interface**

Add a literal valid object fixture to `object-publication.policy.spec.ts` and prove that missing field access and type-incompatible validation are blockers through the existing `analyzePublication()` behavior:

```ts
it('requires employee access for every active field', () => {
  const input = validObjectConfiguration();
  delete input.employeeAccess!.fields.email;

  expect(analyzePublication(input).blocking).toContainEqual({
    code: 'EMPLOYEE_FIELD_ACCESS_REQUIRED',
    message: '每个已启用字段都必须配置员工字段权限。',
    fieldKey: 'email',
  });
});

it('rejects numeric validation on a text field', () => {
  const input = validObjectConfiguration();
  input.fields[0].validation = { min: 1 };

  expect(analyzePublication(input).blocking).toContainEqual({
    code: 'FIELD_VALIDATION_INCOMPATIBLE',
    message: '字段校验配置与字段类型不匹配。',
    fieldKey: 'name',
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @crm/api test -- object-publication.policy.spec.ts --runInBand
```

Expected: FAIL because existing publication analysis does not report either blocker.

- [ ] **Step 3: Implement the shared pure policy**

Move title-field, supported-type, duplicate-option, default-view, employee-access, field-access coverage, and validation-shape checks behind these types:

```ts
export interface ObjectConfigurationDraft {
  object: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
  };
  fields: PublicationDraftField[];
  defaultView: PublicationDraft['defaultView'];
  employeeAccess: PublicationDraft['employeeAccess'];
  previousFields?: PublishedField[];
}

export interface ObjectConfigurationSnapshot {
  object: Omit<PublishedObjectSchema['object'], 'id'> & { id: string };
  fields: PublishedField[];
  defaultView: PublishedObjectSchema['defaultView'];
  employeeAccess: PublishedObjectSchema['employeeAccess'];
}
```

Keep existing-record missing-value checks and publication metadata assembly in `object-publication.policy.ts`. Delegate common checks and snapshot compilation to the new policy. Move the two common-rule tests into `object-configuration.policy.spec.ts` once both still pass through the extracted interface; retain existing-record tests in `object-publication.policy.spec.ts`.

- [ ] **Step 4: Run shared and existing publication tests and verify GREEN**

Run:

```bash
pnpm --filter @crm/api test -- object-configuration.policy.spec.ts object-publication.policy.spec.ts --runInBand
```

Expected: PASS with existing object publication behavior unchanged.

- [ ] **Step 5: Commit the shared policy**

```bash
git add apps/api/src/modules/objects/object-configuration.policy.ts apps/api/src/modules/objects/object-configuration.policy.spec.ts apps/api/src/modules/objects/object-publication.policy.ts apps/api/src/modules/objects/object-publication.policy.spec.ts
git commit -m "refactor(api): share object configuration publication rules"
```

---

### Task 2: Add Template Persistence, Immutability, and RLS

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0004_business_templates/migration.sql`
- Create: `packages/database/test/integration/business-templates.test.mjs`
- Modify: `packages/database/test/integration/helpers.mjs`

**Interfaces:**
- Produces Prisma models: `BusinessTemplate`, `BusinessTemplateVersion`, and `BusinessTemplateApplication`.
- Produces relation: `ObjectDefinition.sourceTemplateVersion` using the existing `sourceTemplateVersionId` column.
- Enforces runtime-role access through `app.user_id`; versions and applications are append-only to `crm_app`.

- [ ] **Step 1: Write a failing raw-database integration test**

Use raw SQL so the test compiles before Prisma models are generated:

```js
test('platform template rows require an active platform administrator', async () => {
  const platform = await createUser('+8613900000201', true);
  const regular = await createUser('+8613900000202', false);
  const templateId = randomUUID();

  await assert.rejects(() =>
    withSettings(runtime, { userId: regular.id }, (tx) =>
      tx.$executeRawUnsafe(
        'INSERT INTO business_templates (id, code, name, draft_configuration, created_by_user_id, updated_at) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid, now())',
        templateId,
        'sales',
        '销售模板',
        JSON.stringify({ schemaVersion: 1, objects: [] }),
        platform.id,
      ),
    ),
  );

  await withSettings(runtime, { userId: platform.id }, (tx) =>
    tx.$executeRawUnsafe(
      'INSERT INTO business_templates (id, code, name, draft_configuration, created_by_user_id, updated_at) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid, now())',
      templateId,
      'sales',
      '销售模板',
      JSON.stringify({ schemaVersion: 1, objects: [] }),
      platform.id,
    ),
  );
});
```

Add a second test that inserts a version as the platform admin, then proves runtime `UPDATE` and `DELETE` both reject it.

- [ ] **Step 2: Run the focused database test and verify RED**

Run:

```bash
pnpm --filter @crm/database test:integration
```

Expected: FAIL because `business_templates` does not exist.

- [ ] **Step 3: Add the Prisma models and migration**

Define the models with these required shapes:

```prisma
model BusinessTemplate {
  id                 String                     @id @default(uuid(7)) @db.Uuid
  code               String                     @unique @db.VarChar(64)
  name               String                     @db.VarChar(100)
  description        String?                    @db.VarChar(1000)
  draftVersion       Int                        @default(1) @map("draft_version")
  draftConfiguration Json                       @map("draft_configuration") @db.JsonB
  activeVersionId    String?                    @unique @map("active_version_id") @db.Uuid
  publishedAt        DateTime?                  @map("published_at") @db.Timestamptz(3)
  createdByUserId    String                     @map("created_by_user_id") @db.Uuid
  archivedAt         DateTime?                  @map("archived_at") @db.Timestamptz(3)
  createdAt          DateTime                   @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime                   @updatedAt @map("updated_at") @db.Timestamptz(3)
  versions           BusinessTemplateVersion[] @relation("BusinessTemplateVersions")
  activeVersion      BusinessTemplateVersion?  @relation("ActiveBusinessTemplateVersion", fields: [activeVersionId], references: [id], onDelete: Restrict)
  creator            User                       @relation("BusinessTemplateCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)

  @@map("business_templates")
}

model BusinessTemplateVersion {
  id                    String                        @id @default(uuid(7)) @db.Uuid
  templateId            String                        @map("template_id") @db.Uuid
  versionNo             Int                           @map("version_no")
  sourceDraftVersion    Int                           @map("source_draft_version")
  schemaVersion         Int                           @map("schema_version")
  configuration         Json                          @db.JsonB
  configurationChecksum String                        @map("configuration_checksum") @db.Char(64)
  changeSummary         Json                          @map("change_summary") @db.JsonB
  publishedByUserId     String                        @map("published_by_user_id") @db.Uuid
  publishedAt           DateTime                      @default(now()) @map("published_at") @db.Timestamptz(3)
  template              BusinessTemplate              @relation("BusinessTemplateVersions", fields: [templateId], references: [id], onDelete: Restrict)
  activeForTemplate     BusinessTemplate?             @relation("ActiveBusinessTemplateVersion")
  applications          BusinessTemplateApplication[]
  sourceObjects         ObjectDefinition[]

  @@unique([templateId, versionNo])
  @@map("business_template_versions")
}
```

Define `BusinessTemplateApplication` with the exact fields from the spec and `@@unique([tenantId, templateVersionId])`. Add named `User` and `Tenant` relations required by Prisma.

In SQL, grant `SELECT, INSERT, UPDATE` on `business_templates`, only `SELECT, INSERT` on versions/applications, enable and force RLS, and use a platform-admin predicate that also requires `users.status = 'ACTIVE'`. Add an immutable-update trigger for versions, matching the existing object-publication trigger. Add the real foreign key from `object_definitions.source_template_version_id`.

- [ ] **Step 4: Generate Prisma client, deploy migration, and verify GREEN**

Run:

```bash
pnpm --filter @crm/database prisma:generate
pnpm --filter @crm/database prisma:migrate:deploy
pnpm --filter @crm/database test:integration
pnpm --filter @crm/database prisma:validate
```

Expected: all commands exit 0; the integration test proves admin access and version immutability.

- [ ] **Step 5: Commit persistence**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/0004_business_templates/migration.sql packages/database/test/integration/business-templates.test.mjs packages/database/test/integration/helpers.mjs
git commit -m "feat(database): add platform business templates"
```

---

### Task 3: Define Template Configuration and Publication Policy

**Files:**
- Create: `apps/api/src/modules/business-templates/business-template.schema.ts`
- Create: `apps/api/src/modules/business-templates/business-template-publication.policy.ts`
- Create: `apps/api/src/modules/business-templates/business-template-publication.policy.spec.ts`

**Interfaces:**
- Consumes: `analyzeObjectConfiguration()` and `compileObjectConfiguration()` from Task 1.
- Produces: `BusinessTemplateConfiguration`, `TemplateObjectConfiguration`, `TemplatePublicationAnalysis`, `analyzeTemplatePublication()`, `compileTemplateVersion()`, and `checksumTemplateConfiguration()`.

- [ ] **Step 1: Write failing template-publication tests**

Cover three observable breaks with hand-authored fixtures:

```ts
it('publishes a complete two-object template as a stable aggregate', () => {
  const analysis = analyzeTemplatePublication(validTemplate(), null);
  expect(analysis.blocking).toEqual([]);
  expect(analysis.objectCount).toBe(2);
  expect(analysis.fieldCount).toBe(4);
});

it('blocks duplicate active object codes', () => {
  const input = validTemplate();
  input.objects[1].code = input.objects[0].code;
  expect(analyzeTemplatePublication(input, null).blocking).toContainEqual({
    code: 'TEMPLATE_OBJECT_CODE_DUPLICATE',
    message: '业务对象代码在模板内必须唯一。',
    objectId: input.objects[1].id,
  });
});

it('locks published field keys and types', () => {
  const previous = validTemplate();
  const current = structuredClone(previous);
  current.objects[0].fields[0].type = 'NUMBER';
  expect(analyzeTemplatePublication(current, previous).blocking).toContainEqual({
    code: 'TEMPLATE_FIELD_IDENTITY_LOCKED',
    message: '已发布字段的字段键和类型不能修改。',
    objectId: current.objects[0].id,
    fieldKey: 'name',
  });
});
```

- [ ] **Step 2: Run the policy test and verify RED**

```bash
pnpm --filter @crm/api test -- business-template-publication.policy.spec.ts --runInBand
```

Expected: FAIL because the template schema and policy do not exist.

- [ ] **Step 3: Implement aggregate validation, compilation, and checksum**

Use `schemaVersion: 1`, sort objects and fields by `sortOrder` plus stable code/key before checksum, and serialize a recursively key-sorted object before SHA-256. The checksum interface is:

```ts
export function checksumTemplateConfiguration(
  configuration: BusinessTemplateConfiguration,
): string {
  return createHash('sha256')
    .update(stableJson(configuration))
    .digest('hex');
}
```

Template blockers aggregate shared object blockers and add `objectId`. Change summaries use literal `ADDED | UPDATED | INACTIVATED` entries for objects and fields.

- [ ] **Step 4: Run the focused policy tests and verify GREEN**

```bash
pnpm --filter @crm/api test -- business-template-publication.policy.spec.ts object-configuration.policy.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit the template policy**

```bash
git add apps/api/src/modules/business-templates/business-template.schema.ts apps/api/src/modules/business-templates/business-template-publication.policy.ts apps/api/src/modules/business-templates/business-template-publication.policy.spec.ts
git commit -m "feat(api): define business template publication policy"
```

---

### Task 4: Build the Template Lifecycle HTTP Slice

**Files:**
- Create: `apps/api/src/modules/business-templates/business-templates.repository.ts`
- Create: `apps/api/src/modules/business-templates/business-templates.service.ts`
- Create: `apps/api/src/modules/business-templates/business-templates.service.spec.ts`
- Create: `apps/api/src/modules/business-templates/business-template.presenter.ts`
- Create: `apps/api/src/modules/business-templates/business-templates.controller.ts`
- Create: `apps/api/src/modules/business-templates/business-templates.module.ts`
- Create: `apps/api/src/modules/business-templates/dto/business-template.dto.ts`
- Create: `apps/api/src/modules/business-templates/dto/index.ts`
- Modify: `apps/api/src/common/errors/api-error-code.ts`
- Modify: `apps/api/src/app.module.ts`
- Generated: `packages/contracts/openapi.json`
- Generated: `packages/contracts/src/generated/openapi.ts`

**Interfaces:**
- Consumes: Task 2 Prisma models and Task 3 publication policy.
- Produces all template list/create/detail/save/analyze/publish/version endpoints from the spec.
- Repository seam: `BusinessTemplateRepository.withActor(actorId, work)` with a real Prisma adapter and an in-memory service-test adapter.

- [ ] **Step 1: Write failing lifecycle service tests**

Create an in-memory store that mirrors complete template rows and assert real returned state, not mock call counts:

```ts
it('saves the whole draft with optimistic locking', async () => {
  const { service } = fixture();
  const created = await service.create(platformAdmin, {
    code: 'sales',
    name: '销售模板',
    description: null,
  }, meta);

  const saved = await service.saveDraft(platformAdmin, created.id, {
    expectedVersion: 1,
    name: '销售模板',
    description: '标准销售对象',
    configuration: validTemplateConfiguration(),
  }, meta);

  expect(saved).toMatchObject({ draftVersion: 2, hasUnpublishedChanges: true });
  expect(saved.configuration.objects).toHaveLength(2);
});

it('publishes without consuming the draft version', async () => {
  const { service } = publishedFixture();
  const version = await service.publish(platformAdmin, 'template-1', 2, meta);
  expect(version).toMatchObject({ versionNo: 1, sourceDraftVersion: 2 });
  await expect(service.detail(platformAdmin, 'template-1')).resolves.toMatchObject({
    draftVersion: 2,
    activeVersion: { versionNo: 1, sourceDraftVersion: 2 },
    hasUnpublishedChanges: false,
  });
});
```

Add tests for duplicate code mapping to validation, stale save returning `TEMPLATE_VERSION_CONFLICT`, and blocked publication returning `TEMPLATE_PUBLICATION_BLOCKED` with grouped issues.

- [ ] **Step 2: Run lifecycle tests and verify RED**

```bash
pnpm --filter @crm/api test -- business-templates.service.spec.ts --runInBand
```

Expected: FAIL because the lifecycle module does not exist.

- [ ] **Step 3: Implement repository, lifecycle service, presenter, DTOs, and Controller**

Use this service surface:

```ts
export class BusinessTemplatesService {
  list(actor: AuthenticatedUser, query: TemplatePageQuery): Promise<TemplatePage>;
  create(actor: AuthenticatedUser, input: CreateTemplateInput, meta: RequestMeta): Promise<TemplateDetail>;
  detail(actor: AuthenticatedUser, templateId: string): Promise<TemplateDetail>;
  saveDraft(actor: AuthenticatedUser, templateId: string, input: SaveTemplateDraftInput, meta: RequestMeta): Promise<TemplateDetail>;
  analyzePublication(actor: AuthenticatedUser, templateId: string, expectedVersion: number): Promise<TemplatePublicationAnalysis>;
  publish(actor: AuthenticatedUser, templateId: string, expectedVersion: number, meta: RequestMeta): Promise<TemplateVersion>;
  listVersions(actor: AuthenticatedUser, templateId: string): Promise<TemplateVersion[]>;
}
```

All nested DTOs declare `@ApiProperty({ type: ... })` explicitly. `SaveBusinessTemplateDraftDto` carries `expectedVersion`, `name`, `description`, and the full typed `configuration`. The list query accepts page, limit, and optional `hasActiveVersion`. The detail presenter compares against the active version once on the server and adds `publishedCode` to each object plus `publishedFieldKey` and `publishedType` to each field; save DTOs never accept those derived lock facts.

Register `SessionAuthGuard` and `PlatformAdminGuard` at Controller class level. Add only the four agreed template error codes and messages.

- [ ] **Step 4: Verify service tests and generate contracts**

```bash
pnpm --filter @crm/api test -- business-templates.service.spec.ts business-template-publication.policy.spec.ts --runInBand
pnpm contracts:generate
pnpm contracts:check
pnpm --filter @crm/api typecheck
```

Expected: all commands exit 0 and generated contracts contain the eight lifecycle paths.

- [ ] **Step 5: Commit the lifecycle slice**

```bash
git add apps/api/src/modules/business-templates apps/api/src/common/errors/api-error-code.ts apps/api/src/app.module.ts packages/contracts/openapi.json packages/contracts/src/generated/openapi.ts
git commit -m "feat(api): add business template lifecycle"
```

---

### Task 5: Deliver Template List and Creation Pages

**Files:**
- Create: `apps/web/src/features/templates/template-api.ts`
- Create: `apps/web/src/features/templates/template-types.ts`
- Create: `apps/web/src/features/templates/template-list.tsx`
- Create: `apps/web/src/features/templates/template-list.test.tsx`
- Create: `apps/web/src/features/templates/create-template-form.tsx`
- Create: `apps/web/src/features/templates/create-template-form.test.tsx`
- Create: `apps/web/src/features/templates/templates.module.css`
- Replace: `apps/web/src/app/(platform)/platform/templates/page.tsx`
- Create: `apps/web/src/app/(platform)/platform/templates/new/page.tsx`
- Modify: `apps/web/architecture-contract.test.mjs`

**Interfaces:**
- Consumes generated template DTOs from Task 4.
- Produces `TemplateApi` with `list`, `create`, `detail`, `saveDraft`, `analyzePublication`, `publish`, and `listVersions` methods for later tasks.
- Produces routes `/platform/templates` and `/platform/templates/new`.

- [ ] **Step 1: Write failing visible-page tests**

```tsx
it('shows an actionable empty state without fake metrics', () => {
  render(<TemplateList data={{ items: [], page: 1, limit: 20, total: 0 }} />);
  expect(screen.getByText('还没有业务模板')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '新建模板' })).toHaveAttribute(
    'href',
    '/platform/templates/new',
  );
  expect(screen.queryByText(/行业/)).not.toBeInTheDocument();
});

it('creates a template and navigates to its editor', async () => {
  const api = templateApi({ create: vi.fn().mockResolvedValue(templateDetail()) });
  const navigate = vi.fn();
  renderWithQuery(<CreateTemplateForm api={api} navigate={navigate} />);
  fireEvent.change(screen.getByLabelText('模板名称'), {
    target: { value: '销售模板' },
  });
  fireEvent.change(screen.getByLabelText('模板代码'), {
    target: { value: 'sales' },
  });
  fireEvent.change(screen.getByLabelText('模板说明'), {
    target: { value: '标准销售对象' },
  });
  fireEvent.click(screen.getByRole('button', { name: '创建模板' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/platform/templates/template-1'));
});
```

- [ ] **Step 2: Run focused Web tests and verify RED**

```bash
pnpm --filter @crm/web test:unit -- src/features/templates/template-list.test.tsx src/features/templates/create-template-form.test.tsx
```

Expected: FAIL because the feature files do not exist.

- [ ] **Step 3: Implement generated-contract client, list, form, and routes**

Use `createServerApiClient()` in server pages and `browserApiClient` in the injected client module. The list uses a bordered Ant Design table with columns from the spec and a single `PageHeader` action. The form uses React Hook Form plus Zod for name, global code pattern `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, and description length.

Use real template names from test fixtures; do not seed or render fake operational statistics.

- [ ] **Step 4: Run Web tests, architecture check, lint, and typecheck**

```bash
pnpm --filter @crm/web test:unit -- src/features/templates/template-list.test.tsx src/features/templates/create-template-form.test.tsx
pnpm --filter @crm/web test:architecture
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
```

Expected: PASS and `/platform/templates` no longer renders `PagePlaceholder`.

- [ ] **Step 5: Commit list and creation pages**

```bash
git add apps/web/src/features/templates apps/web/src/app/'(platform)'/platform/templates/page.tsx apps/web/src/app/'(platform)'/platform/templates/new/page.tsx apps/web/architecture-contract.test.mjs
git commit -m "feat(web): add business template list and creation"
```

---

### Task 6: Build the Multi-Object Template Editor and Publication Flow

**Files:**
- Create: `apps/web/src/features/objects/configuration-view.ts`
- Modify: `apps/web/src/features/objects/field-ledger.tsx`
- Modify: `apps/web/src/features/objects/field-editor-drawer.tsx`
- Modify: `apps/web/src/features/objects/object-preview.tsx`
- Modify: `apps/web/src/features/objects/object-designer.tsx`
- Modify: `apps/web/src/features/objects/object-designer.test.tsx`
- Create: `apps/web/src/features/templates/template-editor.tsx`
- Create: `apps/web/src/features/templates/template-editor.test.tsx`
- Create: `apps/web/src/features/templates/template-object-editor.tsx`
- Create: `apps/web/src/features/templates/template-publication-panel.tsx`
- Create: `apps/web/src/features/templates/template-draft.ts`
- Modify: `apps/web/src/features/templates/templates.module.css`
- Create: `apps/web/src/app/(platform)/platform/templates/[templateId]/page.tsx`

**Interfaces:**
- Consumes `TemplateApi` and generated `BusinessTemplateDetailResponseDto`.
- Produces pure view interfaces `ConfigurableFieldView` and `ConfigurableObjectView` used by both tenant and template designers.
- Produces immutable local draft helpers `addObject`, `addField`, `updateField`, `reorderObjects`, `reorderFields`, `setDefaultView`, and `setEmployeeAccess`, plus `toTemplateConfiguration()` that serializes the editor view to the canonical aggregate.

- [ ] **Step 1: Write failing local-draft and editor tests**

Test local state through exported pure helpers and visible behavior:

```ts
it('adds a field with a stable template-local id and complete employee access', () => {
  const next = addField(emptyTemplateDraft(), 'object-1', {
    id: 'field-1',
    fieldKey: 'name',
    label: '名称',
    type: 'TEXT',
  });
  expect(next.objects[0].fields[0]).toMatchObject({
    id: 'field-1',
    fieldKey: 'name',
    type: 'TEXT',
    employeeAccess: 'EDIT',
  });
});
```

```tsx
it('marks local edits unsaved and disables publication until save succeeds', async () => {
  const api = templateApi();
  renderEditor(templateDetail(), api);
  fireEvent.click(screen.getByRole('button', { name: '新建业务对象' }));
  expect(screen.getByText('有未保存变更')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '发布模板' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '发布模板' })).toBeEnabled());
});
```

Add a regression assertion that the existing tenant `ObjectDesigner` still renders its field ledger and locks published field types.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @crm/web test:unit -- src/features/templates/template-editor.test.tsx src/features/objects/object-designer.test.tsx
```

Expected: FAIL because the template editor and shared view interfaces do not exist.

- [ ] **Step 3: Extract presentation-only object views**

Define:

```ts
export interface ConfigurableFieldView {
  id: string;
  fieldKey: string;
  label: string;
  type: PublishedFieldType;
  required: boolean;
  validation: FieldValidationView;
  config: FieldConfigView;
  status: 'ACTIVE' | 'INACTIVE';
  publishedType: PublishedFieldType | null;
  employeeAccess: PublishedFieldAccess;
}
```

Make `FieldLedger`, `FieldEditorDrawer`, and `ObjectPreview` consume this view rather than generated tenant DTOs. Keep API mutations and publication state inside `ObjectDesigner`; only presentation is shared. In the template editor view, `employeeAccess` is derived per field for editing; `toTemplateConfiguration()` writes it only to the owning object's `employeeAccess.fields` map so the saved aggregate has one permission source.

- [ ] **Step 4: Implement the template editor and local aggregate operations**

Use a 240px template manifest rail and one active object editor. Every local operation returns a new aggregate. “保存草稿” sends the full aggregate with the current server `draftVersion`; a conflict preserves local data and displays the request ID.

The page sections are exactly “基本设置 / 字段 / 列表视图 / 员工权限”. The publish panel first calls analysis; blockers are grouped by object. Confirmation calls `publish(templateId, expectedVersion)`, closes the panel, and refreshes template detail and version history.

- [ ] **Step 5: Run focused and full Web unit tests**

```bash
pnpm --filter @crm/web test:unit -- src/features/templates/template-editor.test.tsx src/features/objects/object-designer.test.tsx
pnpm --filter @crm/web test:unit
pnpm --filter @crm/web typecheck
```

Expected: PASS; existing tenant designer behavior remains green.

- [ ] **Step 6: Commit the editor**

```bash
git add apps/web/src/features/objects/configuration-view.ts apps/web/src/features/objects/field-ledger.tsx apps/web/src/features/objects/field-editor-drawer.tsx apps/web/src/features/objects/object-preview.tsx apps/web/src/features/objects/object-designer.tsx apps/web/src/features/objects/object-designer.test.tsx apps/web/src/features/templates/template-editor.tsx apps/web/src/features/templates/template-editor.test.tsx apps/web/src/features/templates/template-object-editor.tsx apps/web/src/features/templates/template-publication-panel.tsx apps/web/src/features/templates/template-draft.ts apps/web/src/features/templates/templates.module.css apps/web/src/app/'(platform)'/platform/templates/'[templateId]'/page.tsx
git commit -m "feat(web): add multi-object template designer"
```

---

### Task 7: Implement Transactional Template Application

**Files:**
- Create: `apps/api/src/modules/business-templates/template-application.repository.ts`
- Create: `apps/api/src/modules/business-templates/template-application.service.ts`
- Create: `apps/api/src/modules/business-templates/template-application.service.spec.ts`
- Create: `apps/api/src/modules/business-templates/template-application.controller.ts`
- Modify: `apps/api/src/modules/business-templates/business-templates.module.ts`
- Modify: `apps/api/src/modules/business-templates/dto/business-template.dto.ts`
- Generated: `packages/contracts/openapi.json`
- Generated: `packages/contracts/src/generated/openapi.ts`

**Interfaces:**
- Consumes immutable template versions and normalized tenant configuration tables.
- Produces `summarizeTarget(actor, tenantId)` and `apply(actor, templateId, templateVersionId, tenantId, meta)`.
- Produces `GET /platform/tenants/:tenantId/business-configuration` and `POST /platform/business-templates/:templateId/applications`.

- [ ] **Step 1: Write failing service tests for real outcomes**

Use an in-memory transactional store that commits a cloned state only when work resolves:

```ts
it('creates complete tenant drafts with fresh identities', async () => {
  const { service, store } = applicationFixture();
  const result = await service.apply(platformAdmin, {
    templateId: 'template-1',
    templateVersionId: 'version-1',
    tenantId: 'tenant-1',
  }, meta);

  expect(result.objects).toEqual([
    { templateObjectId: 'template-object-1', objectId: 'tenant-object-1', code: 'customers', name: '客户' },
  ]);
  expect(store.objects[0]).toMatchObject({
    tenantId: 'tenant-1',
    sourceTemplateVersionId: 'version-1',
    status: 'DRAFT',
    activePublicationId: null,
  });
  expect(store.publications).toEqual([]);
});

it('returns the first application on an exact retry', async () => {
  const { service, store } = applicationFixture();
  const input = {
    templateId: 'template-1',
    templateVersionId: 'version-1',
    tenantId: 'tenant-1',
  };
  const first = await service.apply(platformAdmin, input, meta);
  const second = await service.apply(platformAdmin, input, meta);
  expect(second).toEqual(first);
  expect(store.objects).toHaveLength(1);
});

it('rolls back every object when hydration fails', async () => {
  const { service, store } = applicationFixture({
    objectCount: 2,
    failAfterObject: 1,
  });
  await expect(service.apply(platformAdmin, {
    templateId: 'template-1',
    templateVersionId: 'version-1',
    tenantId: 'tenant-1',
  }, meta)).rejects.toBeDefined();
  expect(store.objects).toEqual([]);
  expect(store.applications).toEqual([]);
});
```

Add tests for a non-`DRAFT` target, any existing object row, stale active version, archived template, and checksum mismatch. All rejected business cases map to `TEMPLATE_APPLICATION_NOT_ALLOWED` except missing template/tenant.

- [ ] **Step 2: Run application tests and verify RED**

```bash
pnpm --filter @crm/api test -- template-application.service.spec.ts --runInBand
```

Expected: FAIL because the application module does not exist.

- [ ] **Step 3: Implement one deep transaction and fresh-ID hydration**

The repository transaction must execute in this order:

```ts
return repository.transaction(actor.id, async (store) => {
  const repeated = await store.findApplication(input.tenantId, input.templateVersionId);
  if (repeated) return repeated;
  await store.lockTemplate(input.templateId);
  await store.lockTenant(input.tenantId);
  const source = await store.requireApplicableVersion(input);
  await store.enterTenant(input.tenantId);
  await store.assertTenantEmpty(input.tenantId);
  const hydrated = hydrateTenantConfiguration(source.configuration, idGenerator);
  await store.insertTenantConfiguration(hydrated, source.id);
  const application = await store.createApplication(hydrated.result);
  await store.appendAudit(applicationAudit(application, meta));
  return application;
});
```

Generate separate UUIDs for every object, field, view, object permission, and field permission. Insert no publication or record counter. Recompute checksum before hydration.

- [ ] **Step 4: Implement typed HTTP responses and regenerate contracts**

The business-configuration summary returns:

```ts
interface TenantBusinessConfigurationSummary {
  objectCount: number;
  canApplyTemplate: boolean;
  blockingReason: 'TENANT_NOT_DRAFT' | 'TARGET_NOT_EMPTY' | null;
  application: TemplateApplicationSummary | null;
}
```

The application response includes application ID, template/version facts, tenant facts, object ID mapping, and applied time. Register both routes behind the same platform guards.

Run:

```bash
pnpm --filter @crm/api test -- template-application.service.spec.ts --runInBand
pnpm contracts:generate
pnpm contracts:check
pnpm --filter @crm/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit transactional application**

```bash
git add apps/api/src/modules/business-templates/template-application.repository.ts apps/api/src/modules/business-templates/template-application.service.ts apps/api/src/modules/business-templates/template-application.service.spec.ts apps/api/src/modules/business-templates/template-application.controller.ts apps/api/src/modules/business-templates/business-templates.module.ts apps/api/src/modules/business-templates/dto/business-template.dto.ts packages/contracts/openapi.json packages/contracts/src/generated/openapi.ts
git commit -m "feat(api): apply templates to draft tenants"
```

---

### Task 8: Add Company Business-Configuration and Apply UI

**Files:**
- Create: `apps/web/src/features/templates/template-application.tsx`
- Create: `apps/web/src/features/templates/template-application.test.tsx`
- Modify: `apps/web/src/features/templates/template-api.ts`
- Modify: `apps/web/src/features/templates/template-types.ts`
- Modify: `apps/web/src/features/templates/templates.module.css`
- Modify: `apps/web/src/app/(platform)/platform/tenants/[tenantId]/page.tsx`
- Modify: `apps/web/src/features/tenants/create-tenant-form.tsx`
- Modify: `apps/web/src/features/tenants/create-tenant-form.test.tsx`

**Interfaces:**
- Consumes generated business-configuration summary and application response.
- Produces `TenantBusinessConfiguration` with template selection, preview, confirmation, success result, and disabled-state explanation.

- [ ] **Step 1: Write failing application UI tests**

```tsx
it('explains that applying creates drafts and confirms the selected current version', async () => {
  const api = templateApi({
    list: vi.fn().mockResolvedValue(publishedTemplatePage()),
    apply: vi.fn().mockResolvedValue(applicationResult()),
  });
  renderWithQuery(
    <TenantBusinessConfiguration
      tenant={draftTenant()}
      initialSummary={emptyBusinessConfiguration()}
      api={api}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '应用业务模板' }));
  expect(await screen.findByText('将创建对象草稿，不会直接上线')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
  expect(await screen.findByText('已生成 2 个对象草稿')).toBeInTheDocument();
});

it('does not offer overwrite when the company already has objects', () => {
  renderWithQuery(
    <TenantBusinessConfiguration
      tenant={draftTenant()}
      initialSummary={{ objectCount: 1, canApplyTemplate: false, blockingReason: 'TARGET_NOT_EMPTY', application: null }}
      api={templateApi()}
    />,
  );
  expect(screen.queryByRole('button', { name: '应用业务模板' })).not.toBeInTheDocument();
  expect(screen.getByText('公司已有业务对象，不能使用初始化模板覆盖。')).toBeInTheDocument();
});
```

Extend the existing create-tenant test to assert the success link targets `/platform/tenants/tenant-a#business-configuration`.

- [ ] **Step 2: Run focused Web tests and verify RED**

```bash
pnpm --filter @crm/web test:unit -- src/features/templates/template-application.test.tsx src/features/tenants/create-tenant-form.test.tsx
```

Expected: FAIL because the business-configuration UI and link do not exist.

- [ ] **Step 3: Implement the company business-configuration section**

Fetch tenant detail and business-configuration summary in parallel on the server page. The client component loads `hasActiveVersion=true` templates only when the modal opens. Show version, object count, and object names before confirmation.

After success, render a ledger of generated object names/codes and source version. Do not link platform admins into a workspace they may not belong to; state that the company administrator must review and publish the drafts.

- [ ] **Step 4: Run focused and full Web validation**

```bash
pnpm --filter @crm/web test:unit -- src/features/templates/template-application.test.tsx src/features/tenants/create-tenant-form.test.tsx
pnpm --filter @crm/web test:unit
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the application UI**

```bash
git add apps/web/src/features/templates/template-application.tsx apps/web/src/features/templates/template-application.test.tsx apps/web/src/features/templates/template-api.ts apps/web/src/features/templates/template-types.ts apps/web/src/features/templates/templates.module.css apps/web/src/app/'(platform)'/platform/tenants/'[tenantId]'/page.tsx apps/web/src/features/tenants/create-tenant-form.tsx apps/web/src/features/tenants/create-tenant-form.test.tsx
git commit -m "feat(web): apply templates from company details"
```

---

### Task 9: Prove the Full HTTP and Runtime Handoff, Then Close the Slice

**Files:**
- Create: `apps/api/test/business-templates.e2e-spec.ts`
- Modify: `packages/database/test/integration/business-templates.test.mjs`
- Modify: `HANDOFF.md`
- Modify: `docs/design/README.md`

**Interfaces:**
- Exercises real HTTP, PostgreSQL, RLS, template versioning, application hydration, and existing workspace object publication.
- Updates handoff facts and test counts after actual commands establish them.

- [ ] **Step 1: Write the failing end-to-end happy-path and guard test**

The test must register a platform admin, a regular user, and a tenant admin; grant only the first user platform status; then exercise:

```ts
await regular.get('/api/v1/platform/business-templates').expect(403);

const template = await platform
  .post('/api/v1/platform/business-templates')
  .set('Origin', origin)
  .send({ name: '测试 CRM', code: 'test-crm', description: '端到端模板' })
  .expect(201);

const saved = await platform
  .put(`/api/v1/platform/business-templates/${template.body.id}/draft`)
  .set('Origin', origin)
  .send({
    expectedVersion: 1,
    name: '测试 CRM',
    description: '端到端模板',
    configuration: twoObjectTemplateFixture,
  })
  .expect(200);

const version = await platform
  .post(`/api/v1/platform/business-templates/${template.body.id}/versions`)
  .set('Origin', origin)
  .send({ expectedVersion: saved.body.draftVersion })
  .expect(201);

await platform
  .post(`/api/v1/platform/business-templates/${template.body.id}/applications`)
  .set('Origin', origin)
  .send({ tenantId, templateVersionId: version.body.id })
  .expect(201);
```

Assert through the admin Prisma client that two object drafts exist, each points to the version, fields/views/permissions are complete, and `objectPublication.count()` is zero. Repeat the application request and assert the same application ID and unchanged object count.

- [ ] **Step 2: Run the E2E test and verify RED**

```bash
pnpm --filter @crm/api test:e2e -- business-templates.e2e-spec.ts --runInBand
```

Expected: FAIL on the first missing or incorrect integration behavior; do not weaken assertions.

- [ ] **Step 3: Fix only integration gaps exposed by the E2E test**

For every gap, first keep or add the narrow failing assertion, then change the owning module. Typical ownership is:

- contract/DTO mismatch → business-template DTO and regenerated contracts;
- incomplete normalized rows → template application repository;
- wrong RLS context → template repository transaction;
- Web parsing mismatch → `template-types.ts` boundary parser.

Do not add unrelated template features while closing the path.

- [ ] **Step 4: Prove database immutability and source relation**

Extend the database integration test to assert:

```js
await assert.rejects(() =>
  withSettings(runtime, { userId: platform.id }, (tx) =>
    tx.businessTemplateVersion.update({
      where: { id: version.id },
      data: { configuration: { schemaVersion: 1, objects: [] } },
    }),
  ),
);

const sourced = await admin.objectDefinition.findMany({
  where: { sourceTemplateVersionId: version.id },
});
assert.equal(sourced.length, 2);
```

Run:

```bash
pnpm --filter @crm/database test:integration
pnpm --filter @crm/api test:e2e -- business-templates.e2e-spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Perform local browser acceptance**

Start the existing local services, sign in with a local platform-admin account, and verify the eight scenarios in the spec. Check the editor at desktop width and the desktop-only explanation below 1024px. Confirm no fake data appears and company application produces drafts visible to the tenant administrator only after normal workspace authorization.

- [ ] **Step 6: Update handoff facts from actual results**

In `HANDOFF.md`, add the completed template slice, its routes, lifecycle, application restriction, deep module files, migrations, and actual test counts. In `docs/design/README.md`, update the current delivery stage without claiming template upgrades, relationships, or production deployment.

- [ ] **Step 7: Run the complete repository gate**

```bash
set -a && source .env && set +a
docker compose up -d
docker compose -f compose.test.yaml up -d
pnpm --filter @crm/database prisma:migrate:deploy
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
git status --short
```

Expected: every command exits 0. `git status --short` still shows the user's pre-existing register page and untracked files, plus only the intended Task 9 files before commit.

- [ ] **Step 8: Commit the verified slice closure**

```bash
git add apps/api/test/business-templates.e2e-spec.ts packages/database/test/integration/business-templates.test.mjs HANDOFF.md docs/design/README.md
git commit -m "test: verify platform business template workflow"
```

- [ ] **Step 9: Re-check protected workspace state**

```bash
git status --short --branch
git log -10 --oneline
```

Expected: local `main` remains ahead of `origin/main`; protected user files remain unstaged; no push or deployment occurred.
