# CRM correctness, role flows and daily follow-up implementation plan

**Goal:** Deliver the fixes authorized after the September 9 audit, polish the existing UI, and add the smallest usable record follow-up loop. SMS and AI are explicitly deferred.

**Spec:** User's September 9 follow-up and `docs/audits/2026-09-09/review.md`.

**Architecture:** Keep Next.js, NestJS, Prisma/PostgreSQL and current tenant guards. Preserve immutable activities; represent mutable scheduled follow-ups independently. Determine overdue at read time; no external notification or background polling required for this slice.

**Constraints:** Do not edit register/page.tsx, chat会话.md or old SDD progress. No push/deploy, destructive seeds, new credentials, SMS or AI. Existing untracked user files remain untouched. Changes live on codex/crm-polish-followups in the current preview checkout so the user can inspect them directly.

## Tasks and review ledger

- [x] 1. Records correctness: preserve owner on employee edits; block hidden title publication and fail closed for already-published hidden titles across record/dashboard/search projections; CSV formula safety; retry only failed import rows with server idempotency for network retries. Add focused behavioral regression tests before fixes.
- [x] 2. Dashboard and UI: correct demo active/won filters without destructive reseeding; describe trend-only period; format values using schema; modernize records table, card and toolbar spacing/radii; collapse secondary filters on mobile. Check desktop and 390px screenshot.
- [x] 3. Role journeys/platform: validate platform→invitation→activation→tenant configuration→employee boundaries, protect last active administrator, clarify actions/empty states and honest operations statuses; improve platform pages within current architecture; repair stale template UI test assertions.
- [x] 4. Minimal follow-ups: record-bound due time, OPEN/DONE/CANCELLED, reschedule and optimistic version; own assigned tasks, record permission recheck and tenant isolation; record panel plus workspace pending/overdue entry. No external messaging. Backfill existing nextActionAt non-destructively if safe.
- [x] 5. Integration: generate contracts after API work, deploy additive local migrations, focused tests/typechecks/build, browser verify admin/employee/platform and narrow layouts, update HANDOFF/README facts and record limitations.

## Shared-file coordination

| Tasks | Boundary | Ruling |
|---|---|---|
| 1 / 4 | records services/schema | Task1 owns records service/repository/import ledger; task4 uses a separate follow-ups module and migration after Task1's migration number. Coordinate schema edits. |
| 2 / 4 | record drawer/dashboard | Task4 exports follow-up components; root integrates them after Task2. |
| 2 / 3 | global tokens/platform styles | Task2 owns shared tokens; Task3 owns platform-specific pages/styles. |
| all | contracts | Generate only after API changes converge. No worker commits or broad formatting. |

Ruling: This user message authorizes the previous audit fixes and simple follow-ups; proceed without another design confirmation. Preserve current checkout preview and untracked documents using a new feature branch. Reuse last turn's confirmed root causes and baseline (template UI assertions known failing). Implementation reviews focus on regressions and boundaries; avoid repeating full suites without new evidence.

## Final verification notes

Delivered locally; see `docs/audits/2026-09-09/implementation.md` for exact evidence and limits. No historical nextActionAt backfill: semantics do not establish whether those activities still require work. Platform browser walkthrough and Web production build are explicitly not claimed; platform component/service tests, full Web unit suite, API build, typechecks, local browser admin/employee checks and isolated PostgreSQL E2E provide this round’s verification. No SMS/AI, commit, push or deployment.
