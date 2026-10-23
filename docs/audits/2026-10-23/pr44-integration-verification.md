# PR 44 integration verification — 2026-10-23

## Branch and preservation

PR #44 (`codex/crm-functional-audit`) remains stacked on #43 (`codex/crm-redesign`), which now includes merged main `ce45ab4`. No PR was merged into main and nothing was deployed to the server during this review. Recovery of the interrupted primary-checkout merge, missing files and existing local work is documented in `pr43-integration-verification.md`.

The primary checkout keeps the recovered `512e0df` branch and the user's launch configuration and user guide. The complete integrated product version is in `.worktrees/crm-audit`; `.worktrees/crm-redesign` contains the narrower #43 version. Existing untracked `docs/audits/2026-10-22/` and the deployment-plan document remain untouched and were included in the private backup.

## Six findings resolved

| Finding | Resolution | PR |
| --- | --- | --- |
| Row-menu release bypassed reasons / protected release | Reuse the ownership hook form and correct action; preserve contact/classification feedback | #43 |
| Admin draft preview refused employee-only rule | Explicit admin-only inspection scope; runtime permissions unchanged | #43 |
| Duplicate equivalent automatic rules could create duplicate records | Reject enabled same-field/value/target rules during configuration validation | #43 |
| Member offboarding omitted general work tasks | Count and transfer same-tenant/source OPEN work tasks with version increments; preserve DONE/CANCELLED history and aggregate audit counts | #44 |
| Personal/team task lists stopped at 100 | Server-backed page controls, totals, filter reset, mutation invalidation and valid-page correction | #44 |
| Empty company with existing home dashboard failed template initialization | Summary and application both block existing table/dashboard configurations with actionable UI; no overwrite | #44 |

Independent review caught an additional pagination edge case: 101 tasks → complete page 2 → 100 tasks → create another task → page 2 could be rejected using its old cached total. Both screens now wait for a successful completed refresh before correcting the selected page. Two additional regressions cover shrinking and growing the list.

## Test corrections

- Template HTTP regression now supplies the required nullable `description`, and the existing rejection test checks the stable error code plus essential user guidance rather than obsolete wording.
- The cross-record transition test no longer assumes concurrent requests must produce a PostgreSQL deadlock. Thread scheduling can serialize them. All per-record atomicity and result assertions remain; the separate deliberately forced deadlock test still verifies retry behavior.
- The inherited logout test correction prevents Ant Design's global toast renderer from outliving its test DOM.

## Validation

Product/test tree: `32a7a3e`.

- Full workspace tests passed: API 112 suites / 1,557 tests; Web 112 files / 955 tests; 3 Web architecture checks; Worker, contracts, database schema and tenant-template suites passed.
- Real PostgreSQL API e2e: all 21 suites / 189 tests passed (19 suites / 152 tests using the direct isolated port, then the two AI suites / 37 tests through their required loopback port).
- Database integration: 82 passed; zero failed/skipped.
- Monorepo production build and typecheck passed after the pagination cache fix. Contracts check passed; subsequent changes did not modify interfaces.
- Scoped ESLint for the review's changed API and Web files: zero errors/warnings; `git diff --check` passed.
- Full API lint is not green: the inherited baseline has existing errors outside this repair's changed files, as recorded for #43. No broad cleanup was performed.
- Independent targeted review found the pagination cache defect above; the fix and regressions were subsequently rechecked.

All database and Redis work used newly created review containers; existing local/production data were not used. A temporary loopback proxy supported older AI tests pinned to port 55433. Initial whole-e2e execution had test fixture/wording failures, the scheduling-sensitive deadlock assertion, and a connection failure through that proxy; the corrected tests passed using the direct isolated connection, with the pinned AI suites run separately. Failed initial runs are not counted as passing evidence.

PR #43's six GitHub CI jobs passed on `7a265cd`. The current CI configuration triggers only for PRs targeting main; #44 targets #43, so a fresh #44 remote CI run is not claimed. No extra CI-only PR was opened. New full browser, real SMS, paid AI provider and server checks were not performed this round.
