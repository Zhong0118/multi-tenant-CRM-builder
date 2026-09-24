# Task 5 Report — Proposal-only AI orchestration

## Status

**PARTIAL** — implementation, unit tests, Nest AppModule boot, and isolated PostgreSQL E2E are green. The exact `contracts:check` wrapper remains blocked by the repository's pnpm version guard, so this is not labeled DONE.

## Scope implemented

- Added provider-facing `propose_change` collector. It validates strict candidate shape, captures only one untrusted candidate, returns bounded acknowledgements, and invalidates the entire turn on a second tool call.
- Added transaction-aware `AiOperationRepository.createValidatedInTransaction`; the existing public method delegates to it and never nests a runner. Creation and expiry use one database clock instant plus exactly 15 minutes.
- Added atomic `AiProposalService.completeWithProposal`: current actor/record snapshot, validated operation creation, and assistant completion share one tenant transaction.
- Added transaction-aware assistant finalization and operation restoration into assistant message projections with owner/deleted-conversation checks.
- Added retry guard for any existing operation status.
- Added safe `proposal.ready` stream contract and proposal status event contract.
- Added RED/GREEN tests covering valid candidate, adversarial override, duplicate candidate invalidation, provider failure discard, persistence failure, retry statuses, restoration, and transaction-aware operation creation.

## RED evidence

- `corepack pnpm --filter @crm/api test --runInBand conversation.repository.spec.ts` initially failed 6 new tests: retry reset incorrectly proceeded for all operation statuses and message projection had no proposal.
- `corepack pnpm --filter @crm/api test --runInBand ai-operation.repository.spec.ts` initially failed because `createValidatedInTransaction` was absent.
- `corepack pnpm --filter @crm/api test --runInBand ai-orchestrator.spec.ts` initially failed because the orchestrator did not invoke atomic proposal completion.
- A later adversarial second-call test failed before the collector tracked provider `TOOL_CALL_REQUESTED`; that was then corrected.

## GREEN evidence

Focused unit/typecheck:

```text
corepack pnpm --filter @crm/api typecheck
$ tsc --noEmit

corepack pnpm --filter @crm/api test --runInBand ai-orchestrator.spec.ts tool-registry.spec.ts conversation.repository.spec.ts ai-proposal.service.spec.ts ai-operation.repository.spec.ts
Test Suites: 5 passed, 5 total
Tests:       101 passed, 101 total
```

Real isolated E2E, with explicit URLs only for the owned container `crm-v1b-isolated-test` on localhost:55433:

```text
TEST_DATABASE_ADMIN_URL='postgresql://crm:crm@127.0.0.1:55433/crm_v1b_test?schema=public' \
TEST_DATABASE_URL='postgresql://crm_app:crm_app@127.0.0.1:55433/crm_v1b_test?schema=public' \
corepack pnpm --filter @crm/api test:e2e --runInBand ai-proposal.e2e-spec.ts
Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
```

The E2E includes:

- Nest `AppModule` boot through `createApp()` and actual `AiProposalService` / `ConversationService` resolution;
- atomic assistant `COMPLETED` + `AiOperation` creation;
- rollback when finalization throws, leaving no operation and assistant `GENERATING`;
- restoration of the owned proposal card;
- owner and soft-deleted conversation denial;
- retry rejection for `PROPOSED`, `REJECTED`, `EXPIRED`, `FAILED`, and `EXECUTED` operations;
- no business activity write during proposal creation.

Direct contract constituents:

```text
corepack pnpm --filter @crm/api openapi:generate
corepack pnpm --filter @crm/contracts generate
corepack pnpm exec prettier --write packages/contracts/openapi.json packages/contracts/src/generated/openapi.ts
corepack pnpm --filter @crm/contracts typecheck
# all completed successfully; generated OpenAPI diff contains proposal projection
```

Requested wrapper discrepancy:

```text
corepack pnpm contracts:check
# blocked before constituent commands:
# project requires pnpm@11.19.0, runtime is pnpm v11.8.0
```

No global config was changed. No database command used port 5432 or historical 5433.

## Self-review / known gaps

- Existing seven read tools remain unchanged and their registry tests remain green.
- Persistence failure is converted by the outer orchestrator failure path to a separate assistant FAILED finalize; provider/provider-tool raw errors are not emitted.
- Some pre-existing compact formatting in touched files was normalized by the formatter; no unrelated files were formatted. The exact staged file list is limited to Task 5 source, tests, generated contract outputs, and this report.
- Status remains PARTIAL solely because the exact `contracts:check` wrapper could not run under pnpm 11.8; direct deterministic equivalent passed.
