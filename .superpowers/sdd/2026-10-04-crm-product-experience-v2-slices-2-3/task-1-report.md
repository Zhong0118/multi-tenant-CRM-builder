# Task 1 report — detail reading and processing hierarchy

Status: implemented and verified; focused commit follows this report. Task 1 only. Worktree: `.worktrees/crm-product-experience-v2-slices-2-3`; branch `codex/crm-product-experience-v2-slices-2-3`. Actual source read from this worktree, not the stale root CodeGraph index. Task brief read first, followed by V2 design §§6/7/9 and joint plan/global constraints. Coordinator's docs-only commit 7a4db25 was left intact.

## Result

- Reading order is published summary → visible workflow → next-step follow-up → activity history → complete business fields → relations → attachments.
- Summary uses the runtime publication's title field and default column keys, filters HIDDEN fields, and displays owner and observed version. No tenant-specific status key is invented. Full permitted business fields remain discoverable in the explicit native `details` section.
- Owner names use the existing member data. A non-null owner absent from the permitted roster reads `已指定`; only null reads `未指定`. This addresses the coordinator's actual employee-browser finding without requesting a roster or exposing an ID.
- `安排跟进` and `追加活动` open their respective forms. Input autofocus supports the opened task. Forms can be collapsed and reopened while retaining drafts; mutation failures keep entered values and existing errors. Follow-up and Activity continue using separate original APIs.
- Next-step and historical wording clearly distinguish the two existing domains. Activity creation still defaults to NOTE and preserves its original request and request-ID error behavior.
- Relations and attachments remain mounted inside native disclosure sections, preserving their existing list requests, mutations, error handling, and local state. Summary hints observe those original query caches using `skipToken`; no count request or duplicate API is introduced. Existing data yields counts/empty hints; unavailable cache data yields `展开查看`.
- Workflow remains outside every disclosure section; all original actions/results/errors and refresh callback remain. RecordForm receives the original record including observed version; edit and delete permissions/confirmation remain.
- Follow-up target lookup retains current-actor list authorization, status/page scanning, completed-task focus, and unavailable/error distinction. State writes now follow the awaited lookup result instead of synchronous effect initialization. Primitive recordId and a local existing-root query key resolve the dependencies naturally, with no lint suppression. Existing follow-ups root invalidation is retained for Task 2.
- Styling uses the existing tokens and drawer model: native summary focus outline, long-content wrapping, single-column phone fields, existing full-width phone drawer, and CSS minimum heights of 44px for mobile task actions, follow-up composer opener/buttons, activity buttons, and disclosure summaries. These are targeted rules rather than a claim of full touch-target acceptance. No style assertions were added.

## Files

1. `apps/web/src/features/records/record-detail-drawer.tsx`: summary, reading order, native complete-fields/relations/attachments disclosure, cache-derived hints, truthful owner fallback.
2. `apps/web/src/features/records/record-detail-drawer.test.tsx`: new behavior tests for projected summary/full fields/hidden fields, workflow/task/history discoverability, collapsed secondary content/counts, read-only edit absence, and assigned owner without roster.
3. `apps/web/src/features/records/record-activity-timeline.tsx`: explicit activity composer, historical terminology, collapse preserving draft.
4. `apps/web/src/features/records/record-activity-timeline.test.tsx`: adapts creation to explicit opening, asserts initial absence, verifies failed draft retention and collapse/reopen.
5. `apps/web/src/features/follow-ups/follow-up-panel.tsx`: explicit follow-up composer, next-step wording, asynchronous lookup state update and correct dependencies.
6. `apps/web/src/features/follow-ups/follow-up-panel.test.tsx`: adapts creation/failure to opening, asserts default absence and read-only action absence, removes unused binding.
7. `apps/web/src/features/records/records.module.css`: disclosure/readability/mobile layout rules using existing tokens.
8. `apps/web/src/features/follow-ups/follow-ups.module.css`: mobile task action and composer opener/control target height.
9. This report only under `.superpowers`; no handoff/plan edits.

## RED → GREEN evidence

All RED failures were observed before the corresponding implementation. Tests exercise rendered component behavior and public business API requests, not CSS or private state.

| Cycle | RED command / evidence | GREEN evidence |
| --- | --- | --- |
| Follow-up disclosure | `pnpm --filter @crm/web test:unit src/features/follow-ups/follow-up-panel.test.tsx`; job bash-54 exited 1: initial `跟进事项` input unexpectedly existed, 1 failed/9 passed. | Same test file job bash-55 exited 0, 10/10 passed, including failure retention and completed deep-link page 2 focus. |
| Activity disclosure | `pnpm --filter @crm/web test:unit src/features/records/record-activity-timeline.test.tsx`; job bash-56 exited 1: initial `内容` textarea unexpectedly existed, 1 failed/2 passed. | Same file job bash-58 exited 0, 3/3 passed after explicit composer implementation. Final suite also verifies failure/collapse draft retention, 4/4. |
| Detail hierarchy | `pnpm --filter @crm/web test:unit src/features/records/record-detail-drawer.test.tsx`; job bash-61 exited 1: no `记录摘要` accessible region. | Same file job bash-62 exited 0, initial hierarchy test passed; native click opens full fields without directly manipulating component state. |
| Truthful assigned owner | Same detail command, job bash-69 exited 1: expected `负责人：已指定`, actual `负责人：未指定` when owner ID non-null and roster absent. | Final job bash-70 exited 0, detail 2/2 passed with existing-data fallback. |

## Final verification

- `pnpm --filter @crm/web test:unit src/features/records/record-detail-drawer.test.tsx src/features/records/record-activity-timeline.test.tsx src/features/follow-ups/follow-up-panel.test.tsx src/features/records/record-workflow-panel.test.tsx src/features/records/record-form.test.tsx` — job bash-70, exit 0, **5 files / 32 tests passed** (detail 2, activity 4, follow-up 10, workflow 8, form 8).
- `pnpm --filter @crm/web typecheck` — final job bash-71, exit 0.
- `pnpm --filter @crm/web exec eslint src/features/records/record-detail-drawer.tsx src/features/records/record-detail-drawer.test.tsx src/features/records/record-activity-timeline.tsx src/features/records/record-activity-timeline.test.tsx src/features/follow-ups/follow-up-panel.tsx src/features/follow-ups/follow-up-panel.test.tsx` — final job bash-71, exit 0, **no errors or warnings**. No disabled checks.
- `git diff --check` — final job bash-71 and subsequent diff review, exit 0.
- Relations/attachments dedicated component test files do not exist in this checkout; no claim that nonexistent tests ran. Their source was read; detail tests verify disclosure and existing-cache hints while existing panel internals are unchanged.
- Existing jsdom/Ant Design stderr `Window.getComputedStyle() with pseudo-elements` warnings remain; they do not fail the suites. The temporary missing-queryFn warning from passive cache observers was resolved with installed TanStack `skipToken` and absent in final output.

## Review follow-up — mobile composer targets

Task 1 review reported spec/quality PASS without blockers, then identified the new `安排跟进` opener measured 34px at 390px because the original 44px rule covered task `.actions` only. The focused correction extends the existing max-640px rule to direct panel buttons (including the opener) and composer buttons. It leaves desktop controls unchanged and adds no style tests. The result statement above is corrected to distinguish targeted CSS minimum heights from complete browser acceptance. `pnpm --filter @crm/web exec eslint src/features/follow-ups/follow-up-panel.tsx src/features/follow-ups/follow-up-panel.test.tsx && git diff --check` — job bash-76, exit 0, no warnings/errors. No business logic changed, so the previously recorded behavior/typecheck verification was not repeated. Coordinator owns fresh measured browser acceptance.

## Browser evidence and boundaries

This implementer started no runtime server and did not mutate fixture data. Coordinator reported an actual employee browser smoke on its existing runtime: summary/tasks/history/full fields/secondary sections discoverable; 390px drawer width remains 390 including resize while open. Coordinator also reported an existing workflow-not-published 409 baseline. These are explicitly coordinator-reported observations, not an independent complete role/viewport/browser acceptance by this agent. Comprehensive Admin/Employee × 1440/900/390 flows remain Task 4 work.

No schema/API/CI/AI/dependency changes, no push, no merge, no subagents. No new runtime servers. Task 2's URL/source/cache synchronization and Task 3 workbench hierarchy are untouched. Main remaining concern is the joint acceptance matrix (real error injection, all viewport/role flows, return-source refresh), owned by later tasks. Native collapsed panels still perform their pre-existing list requests to provide accurate existing-data hints; this is presentation disclosure, not a new lazy data-fetch policy.
