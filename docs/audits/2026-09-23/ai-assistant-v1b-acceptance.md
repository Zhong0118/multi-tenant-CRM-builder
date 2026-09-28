# AI Assistant V1B Task 7 API acceptance

Date: 2026-09-24 (local run)
Status: **V1B locally verified on isolated database and browser on 2026-09-28; not merged, deployed, or production-validated.** See [Task 7 follow-up report](../../../.superpowers/sdd/2026-09-23-ai-assistant-v1b-implementation/task-7-report.md) for API command/result chronology.

## Isolation guard

The new E2E suite rejects any database URL whose host is not `127.0.0.1`, port is not `55433`, database path is not `/crm_v1b_test`, or role is not `crm` (admin) / `crm_app` (runtime). The executed commands supplied:

- `TEST_DATABASE_ADMIN_URL=postgresql://crm:crm@127.0.0.1:55433/crm_v1b_test`
- `TEST_DATABASE_URL=postgresql://crm_app:crm_app@127.0.0.1:55433/crm_v1b_test`

No 5432/5433 URL was used for these runs. The follow-up test uses the actual `crm_app` client to query live PostgreSQL `pg_roles` (`rolbypassrls=false`) and `pg_class` (`relrowsecurity=true` and `relforcerowsecurity=true` on all three AI persistence tables).

## RED → GREEN evidence

1. RED attempt (before building the workspace database package):
   `corepack pnpm --filter @crm/api exec jest --config ./test/jest-e2e.json --runTestsByPath test/ai-confirmation.e2e-spec.ts --runInBand`
   failed before tests ran because `@crm/database/dist/index.js` was ESM and the package build had not been refreshed.
2. Preparation:
   `DATABASE_ADMIN_URL=postgresql://crm:crm@127.0.0.1:55433/crm_v1b_test DATABASE_URL=postgresql://crm_app:crm_app@127.0.0.1:55433/crm_v1b_test corepack pnpm --filter @crm/database build`
   exited 0.
3. First behavioral RED run (exact E2E script form) reached the application and failed 6/6: missing `operationType` in the HTTP view assertion, expected status mismatch for cross-tenant lookup, missing Origin on confirm requests, and permission fixture overlap. These were test expectation/setup defects, not production changes.
4. Final exact isolated run:
   `TEST_DATABASE_ADMIN_URL=... TEST_DATABASE_URL=... corepack pnpm --filter @crm/api test:e2e -- --runTestsByPath test/ai-confirmation.e2e-spec.ts --runInBand`
   exited 0: **1 suite, 6 tests passed**.

## Covered behavior

`apps/api/test/ai-confirmation.e2e-spec.ts` uses Supertest HTTP against the Nest app and Prisma reads against the isolated database. It covers:

- `UPDATE_RECORD`, `CREATE_FOLLOW_UP`, and `ADD_ACTIVITY_NOTE` proposal status GET → confirm;
- no record/follow-up/activity/audit count or record mutation before confirm;
- executed operation and correlated audit after confirm;
- different member and cross-tenant proposal isolation;
- permission revoked after proposal preview;
- stale record version at confirm;
- expired proposal;
- concurrent confirms execute at most once;
- invalid persisted candidate returns `FAILED` with no audit.

## Targeted broader check

`TEST_DATABASE_ADMIN_URL=... TEST_DATABASE_URL=... corepack pnpm --filter @crm/api test:e2e:critical` exited 0: **1 suite, 7 tests passed**.

API typecheck initially exposed a V1B fixture typing defect at `apps/api/src/modules/ai/ai-orchestrator.spec.ts:215` (`operation: string` was not assignable to `AiOperationKind`). The fixture is now explicitly typed as `AiProposalView`; `corepack pnpm --filter @crm/api typecheck` exits 0.

The focused isolated E2E was rerun after the fixture fix: **1 suite, 6 tests passed**. The broader critical E2E was also rerun: **1 suite, 7 tests passed**.

## 2026-09-28 isolated API follow-up (verified)

- Behavioral RED: `TEST_DATABASE_ADMIN_URL=... TEST_DATABASE_URL=... corepack pnpm --filter @crm/api test:e2e -- --runTestsByPath test/ai-confirmation.e2e-spec.ts --runInBand` exited 1: three new HTTP-turn cases failed (missing `proposal.ready`), seven passed. A separate raw provider failure marker case RED exited 1 (one failed, ten passed). The initial direct `exec jest` attempt failed before tests on ESM parsing; it was not counted as behavioral RED. Exact URLs are the two isolated URL values above.
- After minimal test-provider additions: final same focused E2E command exited 0, **11/11 tests**, including all three POST HTTP turn → SSE `proposal.ready` → GET preview/history → no write before confirm → POST confirm → operation and Domain Audit linkage, HIDDEN value omission, sanitized provider raw failure, and live role/RLS assertions. Existing six cases remain; they use admin-seeded conversation/message and direct preview.
- `TEST_DATABASE_ADMIN_URL=... TEST_DATABASE_URL=... corepack pnpm --filter @crm/api test:e2e:critical` exited 0: **7/7 tests**.
- `corepack pnpm contracts:check` exited 0. `DATABASE_ADMIN_URL=... DATABASE_URL=... corepack pnpm build` exited 0. `DATABASE_ADMIN_URL=... DATABASE_URL=... corepack pnpm typecheck` exited 0. These variables pointed only to `127.0.0.1:55433/crm_v1b_test`; unconfigured build/typecheck attempts initially failed on missing `DATABASE_ADMIN_URL` before isolated reruns.
- Initial `corepack pnpm test` exited 1: V1B mock missing `aiOperation.findFirst` and orchestrator persisted `CANCELLED` while emitting `turn.failed`. Minimal fixture and runtime event fixes were followed by `corepack pnpm test` exit 0: API **92/92 suites, 1197/1197 tests**, web suite done. `corepack pnpm --filter @crm/api typecheck` and `git diff --check` exited 0 after final code formatting.
- Test provider only: marker `critical:propose-change:<UPDATE_RECORD|CREATE_FOLLOW_UP|ADD_ACTIVITY_NOTE>:<record UUID>` under `NODE_ENV=test`/`AI_PROVIDER=fake`; fixed objectCode `leads`, fixed payloads, no tenant/member/role override. At the first follow-up run the due date was fixed to `2026-10-01T12:00:00Z`; the scoped review below replaced that fixed date.

## Scoped review follow-up — 2026-09-28

The fake provider now reads only the latest USER message, rather than scanning concatenated conversation history. Two provider-seam tests were run RED → GREEN: earlier proposal marker replay on a later ordinary turn (RED 1 failure/12 passed; GREEN 13/13), and stale hard-coded due date (RED 1 failure/13 passed; GREEN 14/14). The fake follow-up due date is now 24 hours from the provider call. After formatting, `corepack pnpm --filter @crm/api typecheck` exited 0 and `corepack pnpm --filter @crm/api exec jest --runInBand --silent` exited 0 (**92 suites / 1199 tests**). Optional test-only `:HIDDEN` and `:READ_ONLY` marker suffixes exercise denied candidates, not actor or authorization override. **Correction:** the original READ_ONLY marker sent forbidden `ownerMemberId`, so strict candidate-schema validation rejected it before the published field-access gate; it was not evidence of published READ_ONLY denial. See the corrected run below.

With the isolated DB released for E2E and browser setup paused, the same focused E2E command above exited 0: **14/14 tests**. New HTTP assertions covered same-conversation ordinary second turn without replay/second operation, reject with no business write, HIDDEN and OWN-other attempted proposals without `proposal.ready` or audit, exact audit action, self-assigned follow-up target/title, and NOTE target/content/actor. Test setup attempts to mutate immutable `object_publications` (`P0001`) and read a nonexistent draft `fieldDefinition` failed before behavior checks; both were removed. The original system-field candidate was rejected at the strict schema, not the published READ_ONLY field gate. The test accepts either safe ordinary completion or generic failure on a denied candidate, but never an executable proposal. Fixture cleanup completed before browser seeding.

## Published READ_ONLY correction — 2026-09-28

With explicit clearance after browser checks, the focused test RED failed on absent published `reviewCode` (**14 passed, 1 failed**). The critical fixture now publishes optional, non-system TEXT `reviewCode` with employee `READ_ONLY` and seeds `initial-review-code` on the employee-owned lead. The test-only `:READ_ONLY` provider marker submits `{ reviewCode: 'changed' }`. The test separately asserts this exact candidate passes strict `validateProposalCandidate` and reads the published field/access; the HTTP SSE then omits `proposal.ready` and seeded/hidden values, with zero operation/audit/record mutation. A second `/reject` returns the same REJECTED response, confirm remains REJECTED, and record/activity/audit state stays unchanged. Focused isolated E2E on `127.0.0.1:55433/crm_v1b_test`: **15/15 passed**; critical suite: **7/7 passed**; API typecheck exited 0. Both suites cleaned the owned `critical-a`/`critical-b` fixtures. No 5432/5433 or live browser fixture was touched; browser validation is separately reported by browser work, not asserted here.

## Gaps / not claimed

- A real-provider API execution was not performed; the Vercel adapter/tool-call seam is covered by focused unit regression tests. No post-merge/deploy evidence exists. Local isolated validation does not claim production readiness or merge.
- After the provider-call deduplication and post-commit abort-race fixes, focused API Jest (orchestrator plus proposal collector) passed **32/32** and API typecheck passed. These tests cover both Vercel-style same-call event/execute orderings, distinct-call invalidation, and durable proposal completion when cancellation arrives after the atomic commit.

## CRM browser acceptance — 2026-09-28

Launched the existing CRM Next application at `http://127.0.0.1:3100` and Nest API at `http://127.0.0.1:3101` with `NODE_ENV=test`, `AI_PROVIDER=fake`, matching `WEB_ORIGIN`, and both DB roles bound only to the owned `127.0.0.1:55433/crm_v1b_test`. Verified the exact API health URL and web login URL before browser use. The browser used the test-only `critical-employee-token` session and fixture-generated owned lead; no real credentials or production database were used. These services were stopped after testing, and subsequent isolated E2E fixture cleanup removed `critical-a`/`critical-b` data.

- At 1440 px, a real browser user turn generated a follow-up Proposal Card by SSE. It displayed the associated Record, title, due date, current assignee, and confirmation boundary. Hard refresh restored `PROPOSED`; confirming produced `EXECUTED`, an audit ID, and a safe internal follow-up link. An additional NOTE proposal showed its Record/NOTE content; rejecting it returned HTTP 200 `REJECTED`, and refresh restored the terminal card without a confirm button.
- A record-update proposal showed before → after. Only the isolated owned record version was incremented between preview and confirmation; HTTP confirm returned `CONFLICTED`, and refresh showed the conflict warning without an overwrite or confirm action. A separate NOTE was confirmed by keyboard Enter while its confirm button was focused; HTTP returned `EXECUTED` and refresh displayed its audit/result link.
- At 390 × 844 px, the conversation drawer opened, a new conversation was created, a NOTE card displayed associated Record/content, and the card/document reported `scrollWidth ≤ clientWidth` (no horizontal overflow). Browser text did not contain the seeded HIDDEN values, raw provider sentinel, or a database URL; browser console reported zero errors/warnings during this check. The test-only marker text itself is visible because it was typed as the user prompt; it is not a production model response.
- **Browser-discovered bug and recheck:** Before `2c4cabb`, successful HTTP reject/confirm responses left a newly streamed *live* card visually `PROPOSED` until hard refresh. The history path was already correct. A behavioral RED → GREEN page test and a shared live/history status projection fixed it. After the Next dev server incorporated the change, a fresh live NOTE proposal switched immediately to `已拒绝` with no buttons after click; a fresh live UPDATE_RECORD switched immediately to `已执行` with audit ID and safe record link after click, without page reload. Both were rechecked in the real browser.
- Local gate sequence on the integrated branch before the final API fixture-only correction: isolated-URL `corepack pnpm typecheck` **exit 0**, `corepack pnpm build` **exit 0**, `corepack pnpm test` **exit 0** (including the live-card tests), `corepack pnpm contracts:check` **exit 0**. After the final API fixture correction, focused isolated E2E **15/15**, critical E2E **7/7** and API typecheck exited 0. No claim is made that the entire workspace gate was repeated *after* that last test-fixture commit.

This was **local test-mode acceptance**, not a real-model performance assessment, production deployment, or merge. Since that browser run, PR #22 has been opened; do not read the historical browser section as a claim about the current PR review. V1B remains ACTIVE, not COMPLETED.

## PR #22 final-review follow-up — 2026-09-28

At the fixed PR HEAD `e04295d` (base `cc419ff`), six Hosted CI checks were SUCCESS. Separate read-only standards/spec/security reviewers inspected the 33-commit diff. Standards found no substantiated hard violation; spec review identified truncated previews and a follow-up link that did not select its target. Security review identified an authorization-policy ambiguity: historical Proposal displays were replayed after field/object/OWN read access was revoked. The user chose **redact old Proposal values after revocation**. These are pre-merge findings, not post-merge or production incidents.

Corrections on the still-open PR branch (not a claim of merge): UPDATE preview now preserves the complete validated before/after (including 10,000-character strings and all MULTI_SELECT items); NOTE already preserved its complete validated content. Internal persisted UPDATE field keys allow one centralized current-read-permission projection to omit newly HIDDEN fields; unreadable object/record/OWN target clears the summary, changes and result link while preserving status/audit. Stored title-field provenance also suppresses old titles when their source field is hidden after republishing; legacy displays lacking provenance fail closed for the summary. For an executed Follow-up, a reassignment that removes the original employee's task visibility suppresses its result ID/link even if the Record remains readable. Internal field keys are not sent in public views; legacy keyless UPDATE displays fail closed. GET, conversation history, preview SSE, confirm, reject and replay route through that projection. The follow-up link now locates its exact actor-visible item across paginated statuses, or reports unavailable. Confirmation UI distinguishes permission changes from version conflicts, and visible field validation can provide a safe field error without exposing HIDDEN keys; the streamed no-Proposal turn still uses generic AI failure feedback (not a field-level Proposal Card error).

TDD evidence: UPDATE long-text, multi-select, redacted-history and permission-message tests failed for the intended behavior before their respective fixes; NOTE was a baseline-passing guard. After the changes, focused API Jest and Web Vitest pass, including 45 Proposal-service tests and 11 Proposal-card tests. With only `127.0.0.1:55433/crm_v1b_test` configured, full workspace typecheck passed; full tests passed (**API 93 suites/1222 tests; Web 76 files/472 tests**, plus workspace architecture suites). The first combined build attempt failed only because its shell passed DATABASE variables to `typecheck` but not to later `build`; the isolated-URL build rerun exited 0. Contracts check exited 0. Isolated HTTP E2E passed **16/16** (including a new real-PostgreSQL GET/history revocation test), and Critical API E2E passed **7/7**. These tests still use the **test-only fake Provider**. A second independent review of the local corrections identified two additional blockers (historical title-source redaction after republishing, and Follow-up result ID/link after assignee transfer); both have focused RED→GREEN regressions and are corrected locally. Final Hosted CI for the corrected commit and live-browser recheck are not yet claimed.

**Not verified:** a real external Provider call for any of the three Proposal types. No AI_API_KEY/AI_MODEL was present in the checked project environment and the user has not yet prepared a temporary credentials file. Do not send credentials in chat or claim real-model acceptance; do not mark V1B COMPLETED, merge PR #22, deploy, or start Production Essentials.
