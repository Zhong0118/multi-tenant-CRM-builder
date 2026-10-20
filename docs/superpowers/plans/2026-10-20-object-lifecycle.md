# Whole Business Table Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Company administrators can safely disable and restore a published business table, retaining data, permissions and unpublished work.

**Architecture:** Reuse DRAFT/ACTIVE/ARCHIVED and the existing object definition/publication model. Lifecycle changes are immediate administrative transactions separate from schema publication. Reuse current locking, runtime resolution, pool scanner and dashboard error handling; add only metadata needed to pause ownership deadlines and preserve publication dirty tracking.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js/React/Ant Design, Jest/Vitest, existing OpenAPI contracts.

**Spec:** docs/design/2026-10-20-field-and-object-lifecycle.md section III.

## Global Constraints

- First deploy and verify commit 9136cdc; all new table lifecycle code stays local. No server migrations or production data edits for this feature.
- Reuse existing feature checkout; do not create additional worktrees. Leave docs/user-guide/ and existing secrets untouched. No external AI/SMS calls.
- Company administrators only; tenant isolation and optimistic version checks remain enforced.
- Archive/restore never delete business records, attachments, owners, field configuration or publications. Restore activates the original publication, never publishes draft edits.
- Archived configuration is read-only; runtime reads/writes/import/export/AI/workflows cannot bypass status. Unauthorized callers must not learn inaccessible table metadata.
- Public pool expiry pauses: only deadlines strictly after archive time shift by the stopped duration. Previously overdue deadlines and protected records stay unchanged. Manual follow-up due dates stay unchanged.
- Block active published workflow and pool protection dependencies before archive with specific actionable reasons; synchronize checks with competing publication/configuration.
- Legacy archives without archive time require explicit acknowledgement of retaining existing deadlines; display overdue count before restore.
- No new dependency. UI follows current white/blue design, uses existing icons, subtle transitions and reduced-motion support. No emoji.
- Use isolated PostgreSQL for destructive/integration tests, existing demo admin for browser checks; no destructive changes to existing company records.

### Task 1: Transactional lifecycle and runtime enforcement

**Files:**
- Modify apps/api/src/modules/objects/{objects.service.ts,objects.repository.ts,object-draft.presenter.ts,objects.controller.ts,dto/object.dto.ts} and focused specs.
- Modify packages/database/prisma/schema.prisma and add an additive migration under packages/database/prisma/migrations/.
- Modify existing workflow/pool configuration paths and published object resolver only where state enforcement or lock ordering requires it.
- Regenerate packages/contracts through the existing contract generation command.
- Add apps/api/test/object-lifecycle.e2e-spec.ts using existing auth/publication E2E helpers.

**Interfaces:**
- Keep POST object-definitions/:objectId/archive accepting expectedVersion.
- Add POST object-definitions/:objectId/restore accepting expectedVersion and optional acknowledgeLegacyTimers boolean.
- Add GET object-definitions/:objectId/lifecycle returning status, version, recordCount, activePublicationVersion (nullable), archivedAt (nullable ISO), hasUnpublishedChanges, blockers [{kind, objectCode, objectName, description}], requiresLegacyTimerAcknowledgement, expiredRecordCount.
- Draft object response includes optional nullable archivedAt so fixtures and older payloads remain compatible.
- Blocked lifecycle changes return conflict with useful blocker details; archived runtime requests from authorized users produce OBJECT_ARCHIVED with human-readable business message.

- [x] Write failing service tests for preserve-publication restore, repeated/stale operations, wrong role/tenant, dependency blocks and archived configuration mutation. A key invariant is:
```ts
expect(restored.activePublication?.id).toBe(before.activePublication?.id);
expect(restored.object.status).toBe('ACTIVE');
expect(restored.fields).toEqual(before.fields);
```
- [x] Run `pnpm --filter @crm/api test --runInBand src/modules/objects` and confirm new tests fail for the missing behavior.
- [x] Add nullable archivedAt metadata and transactional archive/restore, locked dependency validation, timer adjustment and audit events. Restore must use status update, never call publish. Repair dirty tracking without modifying immutable publication snapshots. Guard archived workflow and pool configuration mutation. Check existing database protection triggers for lifecycle side effects and retain protected stages/deadlines.
- [x] Implement lifecycle preview DTO/controller and regenerate OpenAPI contracts. Keep lifecycle preview read-only; archive rechecks dependencies in the actual transaction.
- [x] Add isolated database/HTTP tests for lifecycle, row/value preservation, paused/unexpired vs already expired vs protected timers, active incoming dependencies, permission denial, archived direct access, dashboard degradation, notification scans/dedup and concurrency with configuration/publication as applicable to changed locks. Explicitly confirm related runtime paths already protected if no code change needed.
- [x] Run focused API tests, typecheck, contracts check and isolated database E2E. Report existing unrelated failures separately with baseline evidence. Commit only Task 1 files locally; do not push.

### Task 2: Administrative controls and runtime explanations

**Files:**
- Modify apps/web/src/features/objects/{object-api.ts,object-types.ts,object-designer.tsx,object-list.tsx,objects.module.css} and focused tests.
- Add a focused lifecycle dialog component if needed to avoid making the designer much larger.
- Modify current record/dashboard error rendering only where required to show archived messages.
- Update docs/design/2026-10-20-field-and-object-lifecycle.md and add local acceptance notes.

**Interfaces:**
- Consume Task 1 generated lifecycle/restore endpoints; ObjectApi exposes lifecycle(tenantCode, objectId), restore(tenantCode, objectId, expectedVersion, acknowledgeLegacyTimers?).
- Existing archive endpoint remains the mutation entry; refresh current draft and shell navigation after successful changes.

- [x] Write failing UI tests for archive confirmation containing impact/record count/publication/draft/dependencies, blocked confirmation, legacy acknowledgement, successful restore without publish, version conflict refresh, disabled configuration, status filtering and immediate navigation refresh.
- [x] Run `pnpm --filter @crm/web test:unit src/features/objects` and confirm missing behavior failures.
- [x] Build Basics lifecycle panel and confirmation dialog using existing Ant controls. Show 未发布 / 使用中 / 已停用; management list filters 全部 / 使用中 / 已停用 / 未发布. Preserve draft delete behavior. Read-only archived configuration includes fields, ordering, permissions, workflows and pool settings. Keep publications/history viewable. Pending mutations disable repeated actions; failed preview/mutation is retryable and never shown as success.
- [x] Add clear OBJECT_ARCHIVED display for authorized direct runtime links and per-widget dashboard failures if current handling insufficient. Restore uses previous publication; UI must explain drafts stay unpublished and timers resume.
- [x] Run UI unit tests, web typecheck, affected lint. Browser login existing local admin, inspect desktop and 390px UI, cancel without changing demo company records; exercise lifecycle mutations only against disposable test fixtures.
- [x] Complete acceptance notes with exact commands/results and remaining limits, including production SHA distinct from local feature. Commit only Task 2 changes locally; do not push or deploy.

## Completion

- Previous field feature9136cdc pushed/deployed; release evidence: docs/audits/2026-10-20/field-lifecycle-release.md.
- Whole-table backend ae318f9, race/dependency fix eccfafe, UI390b6de local only. Task and final reviews passed without unresolved Critical/Important findings.
- Durable evidence: docs/audits/2026-10-20/object-lifecycle-backend-local.md and object-lifecycle-ui-local.md.
- Existing-admin browser preview/cancel/filter checks preserve demo records; actual mutations use isolated PostgreSQL tests. Local forward migrations backed up and data snapshots compared; production unaffected.
