# PR 43 integration verification — 2026-10-23

## Recovery and scope

The primary checkout had an unfinished merge of `77de9d2` into `f30b287`. The index contained resolved/staged content but nine paths still had unmerged index stages. There were also 188 missing working-tree files: 186 existing tracked files and two newly staged screenshots. These were unstaged absences, not intended removals recorded by the merge. Git cannot establish which process removed them.

Before changes, all refs, index/merge metadata, tracked and non-ignored untracked files, and every worktree's local changes were backed up under `/Users/zhongxu/.codex/backups/crm-recovery-20261023-105257`. Only missing paths were restored from the index. The recovered merge is commit `512e0df` on `codex/local-ui-automation`. User launch configuration, user-guide files, audit/deployment documents, and landing reference assets remain preserved.

PR #42 and #46 are already merged. Current main `ce45ab4` was merged into #43 locally, retaining its domain and landing changes. The prior local automation editor improvements were adapted into #43 rather than overwriting its newer layout. No production deployment or existing business database change was performed.

## Defects corrected in #43

1. Record row actions now reuse the ownership hook's release form and protected-release action, including required reasons and classification. Contact confirmation and unclassified-record feedback are retained.
2. Administrator draft preview explicitly uses an administrator-only inspection scope. Employee-only/disabled configuration can be inspected without granting runtime execution permission; published target and field checks remain in place.
3. Enabled automatic rules with the same source field, comparison value, and target table are rejected even if their rule keys differ. Disabled and distinct rules remain supported.

The editor retains the prior local four-step flow, readable trigger labels, unsaved-change confirmation, and a working close action in read-only mode. An unrelated full-suite test teardown failure was diagnosed: the logout test left Ant Design's asynchronous global message renderer alive after jsdom disposal. That test now isolates the message API and asserts the error feedback before checking retry availability.

## Verification

Tested product tree: `bb819aa` (test-only correction after integration `854ba3f`).

- Full workspace tests: passed. API 110 suites / 1,529 tests; Web 107 files / 921 tests plus 3 architecture checks. Worker, database schema, contracts and tenant-template suites passed.
- Real PostgreSQL API e2e: 19 suites / 175 tests passed, run as 17 suites / 138 tests plus the two isolated AI suites / 37 tests.
- Database integration: 80 passed, zero skipped.
- Monorepo production build, typecheck, contracts check: passed.
- Scoped ESLint for changed API/Web files: passed. Full Web lint: no errors, one pre-existing dashboard navigation warning.
- Full API lint remains blocked: 451 errors / 13 warnings across existing files. This is not an all-lint-green result.
- Independent review of `25cb37c..d8a0da5`: no blocking finding. Remaining nonblocking coverage suggestions: independently test disabled-rule runtime refusal and publishing an already-stored duplicate draft.

All database tests used a newly created isolated PostgreSQL container on port 55440; a loopback proxy on 55433 satisfied older test isolation guards. Redis tests used a separate container on port 56388. Existing local and server data were not used. No real SMS or paid AI request was made. Browser acceptance from earlier PR work is not claimed as newly repeated by these automated checks.

PR #44 remains stacked on #43 and receives these changes through a merge, not a duplicate implementation. Neither PR is merged into main by this review.
