# Telephony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add tenant-admin telephony settings, contextual record dialing, and call history, locally testable without real credentials.
**Architecture:** Tenant-scoped dedicated call storage with current record/field authorization. A small Kuaima adapter and development mock share result merging; API contracts generated from Nest DTOs feed existing Next/Ant Design components.
**Tech Stack:** Existing NestJS, Prisma/PostgreSQL RLS, Node crypto/fetch, Next.js/React/Ant Design/React Query.
**Spec:** docs/superpowers/specs/2026-10-30-telephony-design.md

## Global Constraints
No deployment, merge, real calls or existing-data modification. Work only in this worktree. No new dependencies. Real calling off by default. MOCK prohibited in production and excluded from real work metrics. Use current per-record/group column permissions. API credentials never returned or logged. No automatic inquiry/pool/protection transitions. Changes additive and reversible.

## Task 1: Tenant telephony API and persistence
**Files:** packages/database/prisma/schema.prisma and one new migration; apps/api/src/modules/integrations/telephony/*; integrations.module.ts; guarded webhook bootstrap/origin seam only as necessary; .env.example; generated contracts; apps/api/test/telephony.e2e-spec.ts.
**Consumes:** DatabaseContextRunner, PublishedObjectService, RecordsService/RECORDS_REPOSITORY, existing audit and record field projection.
**Produces:** REST routes under /workspaces/:tenantCode/telephony plus authenticated /telephony/hooks/:tenantId. GET/PATCH settings; GET/PATCH member bindings; GET runtime (including allowed fields for the requested object); POST calls with {requestId,objectCode,recordId,fieldKey}; GET calls with page,limit,objectCode?,recordId?,status?,memberId?,dateFrom?,dateTo?; GET calls/:callId. Generate named response DTOs. The implementer must write API handoff with exact contracts for Task 2.
- [ ] Add behavior tests first: unauthenticated/employee settings rejected; cross-tenant record blocked; caller comes from actor; hidden/group-hidden field blocked; duplicate request creates one call; webhook replay creates one final outcome; network timeout UNKNOWN with no retry; MOCK leaves record activity/pool unchanged; secrets encrypted and omitted on GET.
- [ ] Run focused Jest tests and capture expected red failures.
- [ ] Implement minimal Prisma models/migration with RLS/composite foreign keys and encrypted config; controller/DTO/service/provider. Follow spec; do not invent missing vendor credentials or callback guarantees.
- [ ] Run focused tests and typecheck, generate contracts; integration tests run against root-provided isolated local database only.
- [ ] Commit owned changes and write API handoff including routes/types/errors/config/env/runtime behavior and test evidence.

## Task 2: Settings, record call drawer and history UI
**Files:** apps/web/src/features/telephony/*; app/(workspace)/workspace/[tenantCode]/calls/page.tsx; settings/telephony/page.tsx; components/navigation/workspace-navigation.ts and existing icon mapping; features/records record-list/cell/detail integration minimum; corresponding tests.
**Consumes:** Task 1 generated contracts and API handoff; existing requireWorkspace, browserApiClient, PageHeader, surfaces, Empty/Error/Drawer, record-level fieldAccess.
**Produces:** admin-only settings (company, binding, enabled fields), employee/admin history, contextual call confirmation and honest call state, refresh and existing follow-up link. No real-dial enable switch overriding environment guard.
- [ ] Write behavioral tests for configuration save/failure/secret omission, call selection/confirmation/disabled in-flight/retry reusing requestId, history filters and scoped record links, hidden phone fields.
- [ ] Confirm expected failures before implementation.
- [ ] Implement existing visual language with restrained transitions, reduced-motion handling, accessible labels, blue/white hierarchy and mobile layout. Use shared Ant Design icons, no emoji.
- [ ] Verify selected phone field and member binding cannot be overridden by UI values; no optimistic fake ringing/connected state. MOCK clear and excluded from real counts.
- [ ] Run affected Vitest, lint/typecheck/build, commit owned changes and write UI test report.

## Task 3: Whole flow verification and PR
**Files:** docs/audits/2026-10-30/telephony-local-acceptance.md; targeted fixes from review; scripts only if reusable and needed.
**Consumes:** Tasks 1 and 2; clean isolated PostgreSQL fixture and dedicated local ports.
**Produces:** evidence, developer/vendor handoff and standalone PR, unmerged/undeployed.
- [ ] Run migrations in isolated test DB; verify existing rows are unaffected.
- [ ] Run admin settings -> employee record -> mock call -> history -> record -> follow-up in browser; verify unauthorized and secret states, responsiveness.
- [ ] Review complete diff for spec/security and fix verified findings, regression tests for fixes.
- [ ] Run monorepo test/lint/typecheck/build/contracts checks, report exact failures if any, repair relevant failures.
- [ ] Commit and push codex/telephony-integration, create PR to main with test and pending real-provider notes; inspect CI without merging or deploying.
