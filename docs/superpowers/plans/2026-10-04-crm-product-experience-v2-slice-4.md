# CRM Product Experience V2 Slice 4 Implementation Plan

> **For agentic workers:** Use subagent-driven-development, test-first focused tasks and independent reviews. User approved continuous execution; no component approval pauses.

**Status (2026-10-05): IMPLEMENTED / LOCAL VERIFIED / BROWSER RISK-BASED OBSERVED / PR AND CI PENDING / NOT MERGED.** Implementation: `206e310`, `8cf9c16`, `7fcaca6`; regression fixes: `ea660ca`, `c248fe5`. Final full603 Web tests＋architecture3, typecheck/build/contracts and diffcheck exit0; affected lint0 errors/1 existing warning;107 focused tests and independent review have no blockers. No Slice4 PR or current CI success is claimed. Browser observations and unobserved combinations remain explicit in the [final acceptance draft](../../audits/2026-10-05/crm-product-experience-v2-final-acceptance.md).

**Goal:** Make administrator configuration context, save effects, publication effects and editing priorities understandable without changing business semantics.

**Architecture:** Retain existing ObjectDesigner, field drawer, MemberObjectAccess, DashboardBuilder and WorkflowDesigner owners and server projections. Improve existing section hierarchy and local state feedback; no new configuration framework or global navigation system.

**Tech Stack:** Next.js, React, Ant Design, TanStack Query, Vitest, Playwright.

**Spec:** ../specs/2026-10-03-crm-product-experience-v2-design.md §§8–9 plus user-approved 2026-10-04 scope.

**Base:** origin/main merge 78f55df (PR25 merged, d2adaf8 six checks SUCCESS run37206739634). PR25 local browser gaps and documentation are explicitly still to close; merge is not evidence of browser acceptance.

## Global Constraints

- No API/schema/permission semantic/CI/dependency changes; no Action Engine or published Dashboard semantic changes.
- Object defaults/fields/workflow persist drafts and require publication; member overrides apply immediately from server projection. Dashboard metadata uses separate immediate mutations.
- Preserve expectedVersion/expectedDraftRevision, error field paths, local input on failure/conflict, field key/type locking, preview, publication analysis/confirmation.
- Preserve shared template field drawer parent-save behavior.
- Admin routes retain server authorization. 1440 efficient; 900 primary editor reachable; 390 Object/Workflow existing desktop boundary plus return path, Dashboard existing mobile operations retained.
- Explicit-file commits only; Slice4 PR stays unmerged, no deployment/real databases/AI/Automation/Sales Execution/Production Essentials.

## Task 1: Object/Field and permissions

Files: apps/web/src/features/objects/object-designer.tsx, field-editor-drawer.tsx, objects.module.css, object-designer.test.tsx; apps/web/src/features/members/member-object-access.tsx, members.module.css, member-object-access.test.tsx.

- [x] Add failing tests asserting current object context, draft/publication consequences, object-specific field footer versus template default, saved mode/effective server policy distinct from pending edit.
- [x] Run focused Vitest and verify behavior-specific failures before implementation.
- [x] Introduce compact context/status and section actions using existing public tokens; pass optional object save-effect/context prop to shared drawer, keep defaults for template consumer. Use row.effective and persisted row.mode for saved policy; explicit immediate save feedback; no frontend policy calculation.
- [x] Preserve per-section saves and two-step field/permission persistence; do not describe it as atomic global save.
- [x] Run object-designer/member-access/publication/template affected tests, typecheck and affected ESLint; commit exact files.

## Task 2: Dashboard editing work surface

Files: apps/web/src/features/dashboard/dashboard-builder.tsx, dashboard-configuration.module.css, dashboard-builder.test.tsx; canvas/library/inspector only if plumbing is needed.

- [x] Write failing tests for discoverable secondary settings, draft save/preview/publish effects, canvas-first DOM order and preserved metadata/selected-widget controls.
- [x] Run focused tests for RED.
- [x] Compact editor context/action strip; put name/audience/default/archive/catalog behind explicit secondary settings. Label these immediate separate mutations truthfully.
- [x] At 900/390 make canvas first, library and selected properties reachable using explicit collapsible entrances; preserve draft owner and all add/edit/copy/delete/width/order/preview/publish operations. Validation must reveal selected editor before focus.
- [x] Run complete dashboard-builder/type tests, typecheck/affected lint; exact-file commit.

## Task 3: Workflow hierarchy and responsive boundary

Files: apps/web/src/features/objects/workflow-designer.tsx, workflow-action-editor.tsx, workflow-designer.test.tsx, workflow-action-editor.test.tsx, dedicated workflow stylesheet if avoiding shared CSS ownership.

- [x] Write failing tests for state/transition/ordered-action hierarchy, meaningful initial/terminal/enabled labels and draft-publication copy.
- [x] Verify RED; retain exact mutation payload/expected revision and returned object version.
- [x] Create clear state and transition sections, full-width nested ordered step editor, visible labels for roles/required fields/action effects. No graph editor or new engine behavior.
- [x] Fix affected existing workflow lint with correct data-loading lifecycle, not disabled checks.
- [x] Verify state-only transitions, ordered action array, output references, limits/path errors and input preservation; run tests/typecheck/affected lint; commit exact files.

## Task 4: Close prior evidence gaps and local return focus

Files: source-navigation helpers/workspace/home/followup source consumers and tests only if proven necessary; records form tests; existing dashboard route tests; acceptance/HANDOFF/roadmaps.

- [x] Build regression tests before implementing one-shot local source heading focus; no URL whitelist broadening or global framework. Prior uncommitted scratch patch is incomplete and not reusable as verified production.
- [x] Verify committed writes are not misreported after refresh failures; only fix proven residuals.
- [x] Real browser default/named overview503 and recovery (inject via isolated proxy for SSR), auth401/403 propagation; representative record409/write503/refresh503 with input/success outcomes.
- [x] Risk-based browser closeout with retained prior task evidence: Employee Followups exact source URL/heading focus1440/900/390, Employee workflow/create and record error paths390. Full role-width create/complete/reschedule/cancel matrix NOT COMPLETE; limitations explicitly recorded, no all-features PASS claim.

## Task 5: Final verification/review/documentation/PR

- [x] Full pnpm test/typecheck/build/contracts:check, affected ESLint and git diff --check locally verified (603 Web tests＋3 architecture; lint0 errors/1 existing warning).
- [ ] Latest PR head remote six checks including DB Integration/Critical API E2E.
- [x] Isolated55434 risk-based browser evidence: real Employee draft/livev3→v4, override/INHERIT immediate, record409/write503 and WorkflowPUT409 input retention, unauthorized management404, editors/resize boundaries. Remaining full combinations and unobserved validation/keyboard paths disclosed, not marked PASS.
- [x] Independent review findings fixed (record pending freeze ea660ca; Workflow race c248fe5),107 focused tests PASS and no remaining blockers.
- [x] Update HANDOFF/date, design/roadmaps/plan, PR25 historical postmerge facts and one final acceptance document distinguishing local/remote/browser/NOT OBSERVED. Do not overwrite historical evidence with invented PASS.
- [ ] Push codex/crm-product-experience-v2-slice-4, create one complete unmerged PR and check latest SHA six required checks. Report PR25 merge, new PR/SHA, evidence, residuals and V2 closure judgment.
