# AI Assistant V1B Task 7 API acceptance

Date: 2026-09-24 (local run)
Status: **API acceptance locally green; not merged; browser and full repository gates not verified.**

## Isolation guard

The new E2E suite rejects any database URL whose host is not `127.0.0.1`, port is not `55433`, database path is not `/crm_v1b_test`, or role is not `crm` (admin) / `crm_app` (runtime). The executed commands supplied:

- `TEST_DATABASE_ADMIN_URL=postgresql://crm:crm@127.0.0.1:55433/crm_v1b_test`
- `TEST_DATABASE_URL=postgresql://crm_app:crm_app@127.0.0.1:55433/crm_v1b_test`

No 5432/5433 URL was used for these runs. No BYPASSRLS assertion was added in this test file; this remains a gap.

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

API typecheck was also attempted with the same isolated URLs and exited 2 due to a pre-existing unrelated fixture typing error in `apps/api/src/modules/ai/ai-orchestrator.spec.ts:215` (`operation: string` is not assignable to `AiOperationKind`). This acceptance work did not edit that file.

## Gaps / not claimed

- No browser validation was run; desktop/mobile, refresh recovery, keyboard, overflow, console, and network checks are **NOT VERIFIED**.
- `contracts:check`, full `pnpm test`, and full `pnpm build` were not run because the API typecheck gate is already red and the requested browser environment was not established.
- No explicit database-role `BYPASSRLS` query was added to this suite.
- This is local evidence only. It does not promote the roadmap, update `HANDOFF.md`, claim merge, or claim deployment.
