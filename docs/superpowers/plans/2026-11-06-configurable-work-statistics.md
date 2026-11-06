# Configurable Work Statistics Implementation Plan

> Execute inline with test-driven-development and verification-before-completion. User authorized choosing the implementation; local changes only.

**Goal:** Reuse published workbench metric definitions in personal daily reports and company team statistics.
**Architecture:** Optional `workReport: { memberSource: 'CREATOR' | 'RECORD_OWNER' }` on metric drafts, compiled by existing dashboard publisher. `DashboardEngine.evaluate` receives a server-only `workReport` evaluation option with optional target member. SQL groups by that source while retaining current permission and period predicates. DailyReportsService and TeamActivityService request those results from DashboardsService after their existing transaction.
**Stack:** Existing Nest/Prisma/PostgreSQL/Next/React/Ant Design; no dependency or migration.
**Spec:** `docs/superpowers/specs/2026-11-06-configurable-work-statistics-design.md`

## Tasks

- [x] Add failing configuration regression cases in `dashboard-definition.spec.ts`: parse new option, forbid timeless/AVG/admin-only/current-user configurations, accept date + status.
- [x] Extend `dashboard.types.ts`, `dashboard-definition.ts`, `dashboard-engine.ts` and `dashboards.repository.ts`. Metric result includes optional `members: {memberId,value}[]`. Reuse the current commonPredicates and aggregateExpression; apply personal member restriction in SQL and never rank-limit groups.
- [x] Add `DashboardsService.getWorkMetrics(context, period, memberId?)` selecting the employee default publication and evaluation mode. Thread results into daily-report and team-activity services, module and response DTOs. Run OpenAPI generation.
- [x] Extend `dashboard-widget-inspector.tsx` with an opt-in checkbox, attribution selection and explicit source/date explanation. Update frontend draft types. Add `work-business-metrics.tsx` for personal cards/team columns and clear unavailable state; mount in report and team views.
- [x] Add isolated HTTP test `work-business-metrics.e2e-spec.ts`: publish a non-pool table and dashboard; exercise record/date/state/attribution changes, role isolation and existing-data compatibility. Add UI tests for configuration and rendering/errors; run related regression suites, typechecks, lint and builds.
- [x] Update `docs/guides/workbench-sales-metrics.md` with exact admin setup and interpretation. Inspect diff, preserve all other worktrees/data, report local completion and limits without deployment.

## Verification notes

- Workbench configuration UI: changed attribution, saved draft, reloaded, confirmed retained filters; restored owner attribution and published.
- Isolated real PostgreSQL browser fixture: employee daily report and administrator team totals both returned 3 passed records; no activity registration was added. Mobile width 390px had no horizontal overflow.
- Production inspected read-only: the actual through-table date is TEXT, the success flag is BOOLEAN, and the current default workbench has no widgets. Added explicit text-date period interpretation without changing any business fields or dates.
- Legacy workbenches, employee-default selection, role/tenant isolation and archived/hidden sources covered by regression tests.
- Final command results and environment boundary are recorded in the acceptance note. No production deployment or data mutation.
