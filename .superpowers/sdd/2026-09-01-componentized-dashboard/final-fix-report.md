# Componentized dashboard final fix report

Date: 2026-09-01

Base reviewed: `bae5a6f`

## Scope and decisions

### A. Hidden title-field protection (R15)

- The engine now derives `canReadTitle` with the same effective field-access check used for widget projections.
- The record-list repository selects `r.title` only for a readable bound title field. The hidden branch selects `r.record_no::text AS title`, so the SQL/result boundary cannot expose the business title.
- RED evidence: the engine plan had no title-access decision and the repository SQL still selected `r.title` for an employee with a hidden title field. The focused engine/repository regressions failed before the implementation and pass now.

### B. Field-aware filter semantics

- Structural parsing remains permissive enough to save an invalid draft, while preview/publication validates values against the published field type.
- Validation now covers finite numeric scalars/ranges, exact booleans, standard platform ISO `DATE`/`DATETIME` range endpoints, relative-day integers from 1 through 3660, nonempty membership arrays, and nonblank text equality/contains values.
- Operator compatibility and select-option key validation remain separate checks. Invalid values produce `FILTER_VALUE_INVALID` at the filter value path before engine evaluation.
- RED evidence: invalid typed values reached compilation/evaluation or produced no value issue. The new definition table and service boundary expectation failed before the semantic validator and pass now.

### C. Atomic current object bindings (R16)

- Publication compilation remains outside the repository transaction.
- Inside the transaction, the repository locks the dashboard definition first, then locks every referenced tenant object-definition row `FOR SHARE`, and verifies `ACTIVE` plus the exact compiled `active_publication_id` before publication number allocation, insert, pointer switch, or audit.
- Repository outcomes are discriminated as `PUBLISHED`, `VERSION_CONFLICT`, or `CATALOG_CHANGED`. The service maps catalog drift to `DASHBOARD_CATALOG_CHANGED` (409), not a draft-version conflict.
- RED evidence: the repository had no catalog-lock query or catalog outcome, and the service could only report a dashboard draft conflict. The repository ordering/no-write assertions and service error assertion failed before implementation and pass now.

### D. Tenant timezone (R17)

- Preview input uses `DashboardPeriodInputDto` (`from`/`to` only); response periods retain `DashboardPeriodDto` with the authoritative timezone.
- Preview and overview resolve the persisted tenant timezone server-side. Invalid or missing IANA zones fail visibly with a configured tenant-timezone message.
- The Web client no longer sends the browser timezone. OpenAPI and the generated client contracts were regenerated with the split DTO.
- RED evidence: browser timezone remained in the request semantics and no tenant timezone repository boundary existed. The service, DTO-whitelisting, repository, and Web API tests failed before implementation and pass now.

### E. Builder correctness

- Add/copy IDs use a type prefix plus `crypto.randomUUID()`; count-based display titles remain unchanged.
- Publish eligibility now depends on an existing saved version and a clean draft, so a saved draft can publish after reload.
- Configuration issues are live state initialized from server issues. API field errors become path-addressed inline issues; the first blocking widget/control is selected and focused. Relevant edits and successful preview/publish clear stale issues, while generic feedback remains.
- RED evidence: the focused builder run reported 6 failures (11 passing) for reload publish eligibility, ID reuse, issue rendering/focus, issue clearing, and incomplete record-list save. The focused builder/API/parser run passes now.

### F. Incomplete record-list draft

- `fieldKeys: []` is structurally valid for draft persistence; the structural maximum remains 8 and duplicates remain invalid.
- Preview/publication reports `RECORD_LIST_FIELDS_REQUIRED` at `widgets[n].fieldKeys`.
- RED evidence: the parser rejected the draft before semantic validation and the service could not save it. Parser/semantic, service, and builder save regressions pass now.

## Verification

- API dashboard definition/engine/repository/service/DTO: 5 suites, 71 tests passed.
- Web dashboard parser/builder/API: 3 files, 20 tests passed.
- Contracts: 7 tests passed.
- API TypeScript: passed (`tsc --noEmit`).
- Web TypeScript: passed (`tsc --noEmit`) after rebuilding `@crm/contracts` declarations.
- Contracts TypeScript build and no-emit typecheck: passed.
- Scoped API ESLint: passed.
- Scoped Web ESLint: passed.
- Scoped Prettier check: passed for changed hand-written API/Web/test/report files.
- OpenAPI/client regeneration was repeated; both generated artifact hashes were unchanged on the second run.
- PostgreSQL 15 live check: with the application role and tenant RLS context, the exact multi-object `FOR SHARE` shape returned both ACTIVE bindings inside a transaction that ended with `ROLLBACK`.
- `git diff --check`: passed.

## Concerns

- No broad monorepo or browser suite was run, by calibration.
- The configured test database endpoint was unavailable/authentication-mismatched for the optional lock probe; the rollback-only probe succeeded against the configured local development database instead.
- Generated contracts retain their existing generator-native formatting to keep the DTO change reviewable; regeneration is byte-stable.
- No push or deployment was performed.
