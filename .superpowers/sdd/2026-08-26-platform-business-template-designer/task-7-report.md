# Task 7 Report — Transactional Template Application

## Delivered

- Added a dedicated template-application repository and service with one database transaction per summary/application use case.
- Added `GET /api/v1/platform/tenants/:tenantId/business-configuration` and `POST /api/v1/platform/business-templates/:templateId/applications`, both guarded by `SessionAuthGuard` then `PlatformAdminGuard`.
- Added typed application request, result, object mapping, and tenant business-configuration summary DTOs; regenerated OpenAPI JSON and TypeScript contracts.

## Transaction design

Application order is fixed as: exact tenant/template/version retry lookup; template row lock; tenant row lock; exact triple retry lookup after both locks; current active version, archive state, target existence/status, checksum, and duplicate-identity validation; tenant-context switch; all-row object emptiness check; fresh-ID hydration; normalized configuration insert; application insert; tenant audit append; transaction commit. A create-time `P2002` race rolls back first, then performs a safe exact-triple lookup in a new transaction and returns only that concurrent winner.

Every object, field, default view, employee object permission, and employee field permission receives a separate generated UUID. Every object remains `DRAFT`, has `activePublicationId`/`publishedAt` null, and stores the real `sourceTemplateVersionId`. The application stores the complete template-object-to-tenant-object map and checksum; the audit stores the same mapping, source template/version facts, and object count. No object publication or record counter is created. Any insert/application/audit failure rejects the transaction and rolls back the entire graph.

Application rejection preserves `TEMPLATE_NOT_FOUND` and `TENANT_NOT_FOUND`; non-draft/non-empty targets, archived templates, stale/non-current versions, incomplete source configuration, and checksum mismatches use `TEMPLATE_APPLICATION_NOT_ALLOWED` with a readable application detail.

## Verification

- RED: focused Jest failed because `template-application.controller` did not exist.
- GREEN: focused Jest passed, 1 suite / 11 tests. It proves committed normalized outcomes, unique fresh identities, source facts, no publications/counters, exact retry, lock order, full rollback, stable rejection codes, summary eligibility, audit contents, and platform guards.
- `contracts:generate`: passed and generated both new paths and DTO schemas.
- `contracts:check`: its regeneration passed; its final `git diff --exit-code` returned 1 because the newly generated Task 7 contract changes were intentionally still unstaged against HEAD.
- Initial API typecheck found one test-fixture-only inference error. The fixture was corrected with an explicit `TemplateObjectConfiguration` return type; Fix Round 1's API typecheck passed and closes that verification gap.
- `git diff --check`: passed after the final edits.

## Residual risk

- No database integration, API E2E, full API suite, or smoke test was run; those are deliberately deferred by the Task 7 cost boundary and Task 9 plan. The focused in-memory store verifies atomic state semantics, while real PostgreSQL/RLS behavior remains for Task 9.

## Fix Round 1

- Exact retries now require the complete `tenantId + templateId + templateVersionId` triple. A route-template mismatch cannot return another template's application and proceeds to the stable `TEMPLATE_APPLICATION_NOT_ALLOWED` path.
- The service keeps template-before-tenant lock order and rechecks the exact triple after both locks. A `P2002` application race is recovered outside the aborted transaction by reading only the exact winner; unrelated uniqueness failures are rethrown.
- Template publication now blocks duplicate object IDs, duplicate field IDs within one object, and duplicate field keys within one object. Application performs the same defensive identity validation before hydration, so object-map construction cannot silently overwrite duplicated source identities. Historical published-identity locking remains covered.
- Both platform path parameters use `ParseUUIDPipe`, producing the framework's stable 400 response for malformed UUIDs.
- Focused RED exposed 10 expected behavior failures. Focused GREEN passed 2 suites / 25 tests. API typecheck passed. Contracts were not regenerated or checked because this round did not change the HTTP schema.
