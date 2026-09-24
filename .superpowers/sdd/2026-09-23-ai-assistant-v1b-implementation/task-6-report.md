# Task 6 report

## Status
Implemented the V1B proposal transport/model/parser/reducer and initial recoverable proposal card in the existing AI chat. Historical messages now retain the server proposal projection, stream events are schema checked, and the header communicates that execution requires confirmation.

## Tests
- RED verified: new `proposal.ready` parser tests failed before implementation.
- GREEN: `corepack pnpm --filter @crm/web test:unit -- ai-stream-parser.test.ts ai-api.test.ts ai-turn-reducer.test.ts ai-assistant-page.test.tsx` — 74 files / 452 tests passed.
- `corepack pnpm --filter @crm/contracts build` — passed.
- `corepack pnpm --filter @crm/web typecheck` — passed.
- `git diff --check` — passed.
- GUI Playwright not run because no existing dev/web watcher was verified.

## Continuation status
- Replaced the generic card with an operation-aware, accessible proposal card: UPDATE before/after; FOLLOW_UP title, due time, linked record and current actor; NOTE content/type; explicit pending and terminal labels.
- Expiry is timer-driven from `expiresAt`, re-renders to an expired state and removes actions; action buttons are disabled while page mutation is pending.
- Executed results link only from validated `tenantCode`, `objectCode`, `recordId`, and `followUpId`; arbitrary server `href` is ignored.
- Added status-specific permission, conflict, validation, and failure copy plus audit/result presentation.
- Existing page mutations retain GET reconciliation on uncertain confirm/reject responses and shared pending state prevents duplicate clicks; persisted proposal projections restore through message history.
- Focused proposal-card tests and web typecheck pass. The page-level timeout/history tests and production build were not run in this continuation; no remote mutation was performed.
