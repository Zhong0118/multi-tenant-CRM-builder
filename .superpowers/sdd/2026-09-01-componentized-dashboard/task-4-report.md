# Task 4 report — dashboard draft, preview, publish, and runtime use cases

## RED / GREEN

- RED (before production edits): `apps/api/node_modules/.bin/jest dashboards.service.spec.ts --runInBand` failed with the expected missing `saveDraft`, `preview`, and `publish` methods, and the legacy overview's missing `getConfiguration` repository method.
- GREEN: `apps/api/node_modules/.bin/jest dashboards.service.spec.ts dashboard-definition.spec.ts dashboard-engine.spec.ts dashboards.repository.spec.ts --runInBand` passed: 4 suites, 37 tests.
- API typecheck: `apps/api/node_modules/.bin/tsc --noEmit` passed.
- Diff whitespace check: `git diff --check` passed.

## Routes and DTOs

- Kept `GET` / `PUT /workspaces/:tenantCode/dashboard/configuration`; the GET envelope now carries the draft, active publication summary, candidates, and component-path issues.
- Added `POST /workspaces/:tenantCode/dashboard/preview`, accepting an expected draft version and explicit period, and `POST /workspaces/:tenantCode/dashboard/publications`, accepting only `expectedVersion`.
- Kept `GET /workspaces/:tenantCode/dashboard/overview` with the 1–366-day validation. Runtime OpenAPI DTOs now describe metric, distribution, trend, leaderboard, record-list, and unavailable widget variants.

## Atomicity and audit

- Save only writes a structurally valid normalized draft and increments its draft version; semantic validation is deferred to preview/publish.
- Publish loads the saved version, compiles it against current published objects, then relies on the existing tenant-locked repository transaction to create the immutable publication and switch the active pointer. Compilation or semantic errors occur before that transaction, preserving the active publication.
- `dashboard.draft_saved` and `dashboard.published` are appended through `AuditService` in the same tenant transaction. Events contain tenant and actor, draft version, component count, plus publication number for publishes; request ID/IP are forwarded from the controller.

## Self-review and concerns

- Reviewed authorization (configuration/save/preview/publish are administrator-only), version conflicts (`DASHBOARD_DRAFT_VERSION_CONFLICT`), legacy/compiled active-publication flow through `DashboardEngine`, preview diagnostics, and employee scope delegation to the engine.
- No generated OpenAPI contracts or Web files were touched; downstream Task 5 can regenerate and consume this backend surface.
