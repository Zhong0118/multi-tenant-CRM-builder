# AI Assistant V1B Task 7 API acceptance

Date: 2026-09-24 (local run)
Status: **API acceptance and full local gates green on 2026-09-28; not merged; browser NOT VERIFIED by this task.** See [Task 7 follow-up report](../../../.superpowers/sdd/2026-09-23-ai-assistant-v1b-implementation/task-7-report.md) for exact command/result chronology.

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
- Test provider only: marker `critical:propose-change:<UPDATE_RECORD|CREATE_FOLLOW_UP|ADD_ACTIVITY_NOTE>:<record UUID>` under `NODE_ENV=test`/`AI_PROVIDER=fake`; fixed objectCode `leads`, fixed payloads, no tenant/member/role override. The fixed follow-up due date `2026-10-01T12:00:00Z` was future at test time (2026-09-28) but becomes stale afterward.

## Gaps / not claimed

- Browser desktop/mobile, refresh UI, keyboard, overflow, console and network are **NOT VERIFIED by this API follow-up**; other ongoing browser work must be reported separately with its own evidence.
- No real provider run or post-merge/deploy evidence. This local evidence does not promote the roadmap, update `HANDOFF.md`, claim merge, or claim deployment.
