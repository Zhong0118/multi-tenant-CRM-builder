# Task 5 report — template dashboard presets

## RED / GREEN

- RED: Added focused publication and application tests, then ran `pnpm --filter @crm/api test -- business-template-publication.policy.spec.ts template-application.service.spec.ts --runInBand`.
- RED result: 3 expected failures — compiled templates omitted `dashboard`, dashboard field references produced no blocking issue, and application left the tenant dashboard record null.
- GREEN: Added the optional nested dashboard definition, template-object catalog validation, normalized compilation/checksum participation, and transactional tenant draft creation. The same two suites pass.

## Checksum and backward compatibility

- `BusinessTemplateConfiguration.schemaVersion` remains `1`; the optional nested dashboard keeps `schemaVersion: 2`.
- Existing templates that omit `dashboard` compile unchanged and no tenant dashboard definition is created when they are applied.
- When present, the dashboard draft is structurally parsed and normalized before compilation and checksum generation, so equivalent widget ordering has a stable checksum.
- Publication validates dashboard references against active template objects and fields only. It intentionally does not create tenant publication bindings or object-publication metadata.

## Transaction copy

- Template application builds a tenant dashboard draft with `draftVersion: 1`, the copied preset JSON, `sourceTemplateVersionId` equal to the applied template-version ID, and `activePublicationId: null`.
- The dashboard definition is inserted by `PrismaTemplateApplicationStore.insertTenantConfiguration` in the existing application transaction after the tenant object graph. A failure rolls back both the object graph and dashboard draft.

## Exact checks

- `pnpm --filter @crm/api test -- business-template-publication.policy.spec.ts template-application.service.spec.ts --runInBand` — PASS (29 tests).
- `pnpm --filter @crm/api test -- business-template-publication.policy.spec.ts template-application.service.spec.ts dashboard-definition.spec.ts --runInBand` — PASS (37 tests).
- `pnpm --filter @crm/api typecheck` — PASS.
- `git diff --check` — PASS.

## Self-review

- Confirmed the compiled template holds a normalized `DashboardDefinitionV2`, not a tenant `PublishedDashboardDefinitionV2`.
- Confirmed dashboard semantic errors are reported with a `dashboard.widgets[...]` path, while existing object publication issues remain unchanged.
- Confirmed the implementation modifies only the Task 5 business-template files and this Task 5 report; unrelated working-tree changes remain unstaged.

## Concerns

- No migration is needed: the dashboard tables and fields were introduced by the earlier dashboard tasks, and the template field is optional.

## Fix round 1 — HTTP DTO and publication-path review

### RED / GREEN

- RED command: `pnpm --filter @crm/api test -- business-template.dto.spec.ts business-templates.service.spec.ts business-template.presenter.spec.ts business-template-publication.policy.spec.ts template-application.service.spec.ts --runInBand`.
- RED result: 3 expected failures — global whitelist rejected `configuration.dashboard`, detail responses omitted the dashboard preset, and blocked dashboard publication used `configuration.objects` instead of `configuration.dashboard.widgets[0].fieldKeys[0]`.
- GREEN: the template configuration DTO now permits an optional object-valued dashboard, inherited response/version DTOs expose it in OpenAPI, the detail presenter retains it, and issue paths are preferred when producing blocked-publication field errors.

### Added focused coverage

- Dashboard JSON survives class-transformer/class-validator with `whitelist` and `forbidNonWhitelisted` enabled; strict V2 validation remains in the domain parser.
- Template detail preserves the optional dashboard response configuration; published version configuration already uses the same DTO surface.
- Dashboard widget paths propagate into `TEMPLATE_PUBLICATION_BLOCKED` field errors, while issues with no path retain the object-key fallback.
- Semantically identical dashboard widget arrays with different wire order have matching checksums.
- Applying a template without a dashboard preset leaves the tenant dashboard row absent.

### Exact checks

- `pnpm --filter @crm/api test -- business-template.dto.spec.ts business-templates.service.spec.ts business-template.presenter.spec.ts business-template-publication.policy.spec.ts template-application.service.spec.ts --runInBand` — PASS (63 tests).
- `pnpm --filter @crm/api typecheck` — PASS.
- `pnpm --filter @crm/api exec eslint src/modules/business-templates/business-template.presenter.ts src/modules/business-templates/business-template.presenter.spec.ts src/modules/business-templates/business-templates.service.ts src/modules/business-templates/business-templates.service.spec.ts src/modules/business-templates/business-template-publication.policy.spec.ts src/modules/business-templates/template-application.service.spec.ts src/modules/business-templates/dto/business-template.dto.ts src/modules/business-templates/dto/business-template.dto.spec.ts` — PASS.
- `git diff --check` — PASS.

### Concerns

- The dashboard DTO stays deliberately object-shaped until the platform template editor adopts the full discriminated V2 builder language, as required by R11.
