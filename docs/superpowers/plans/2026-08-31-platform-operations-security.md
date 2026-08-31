# Platform Operations and Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix dashboard configuration semantics, add bounded login history, and replace the remaining super-admin placeholders with real operational data.

**Architecture:** Keep the existing dashboard aggregate and permission model. Extend auth repository/service contracts for paged session classes and opportunistic retention cleanup. Add a focused platform-operations module that reads audit logs, template applications, and sanitized runtime readiness.

**Tech Stack:** NestJS, Prisma/PostgreSQL RLS, Next.js App Router, Ant Design, openapi-typescript, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-platform-operations-security-design.md`

## Global Constraints

- Do not change employee permission semantics.
- Do not display fake operational data or expose secret values.
- Retain session history for 90 days and verification challenges for 30 days.
- Use focused tests and typechecks only.

---

### Task 1: Dashboard configuration semantics

**Files:**

- Modify: `apps/web/src/features/dashboard/dashboard-configuration-form.tsx`
- Modify: `apps/web/src/features/dashboard/dashboard-configuration-form.test.tsx`

**Interfaces:**

- Consumes: existing `DashboardConfigurationView` and save endpoint.
- Produces: save is enabled only when ACTIVE, WON, and LOST mappings are present; selection copy identifies lifecycle stages.

- [ ] Add a failing component test asserting incomplete stage grouping cannot be saved.
- [ ] Update form validation, guidance, and live readiness copy.
- [ ] Run the focused Vitest file and confirm it passes.

### Task 2: Paged session history and retention

**Files:**

- Modify: `apps/api/src/modules/auth/auth.repository.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/dto/auth.dto.ts`
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`
- Modify: `apps/web/src/app/(account)/account/security/page.tsx`
- Modify: `apps/web/src/features/auth/session-list.tsx`
- Modify: `apps/web/src/features/auth/session-list.test.tsx`

**Interfaces:**

- Produces: `GET /api/v1/me/sessions?kind=ACTIVE|HISTORY&page&limit` returning `{items,page,limit,total}`.
- Produces: repository paging, `pruneAuthArtifacts`, and successful-login timestamp updates.

- [ ] Add failing service tests for active/history paging and retention cleanup.
- [ ] Implement repository, service, DTO, and controller behavior.
- [ ] Regenerate API contracts.
- [ ] Add a failing UI test for active/history separation and history pagination.
- [ ] Implement the account security UI and pass focused tests.

### Task 3: Platform operations APIs

**Files:**

- Create: `packages/database/prisma/migrations/0008_platform_audit_access/migration.sql`
- Create: `apps/api/src/modules/platform-operations/*`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Produces: `/api/v1/platform/audit`, `/api/v1/platform/operations`, and `/api/v1/platform/runtime-status`.

- [ ] Add failing service tests for paged audit/operation projection and sanitized readiness.
- [ ] Add the super-admin RLS policy and platform operations module.
- [ ] Run the focused API test and regenerate contracts.

### Task 4: Platform operations pages

**Files:**

- Modify: `apps/web/src/app/(platform)/platform/audit/page.tsx`
- Modify: `apps/web/src/app/(platform)/platform/jobs/page.tsx`
- Modify: `apps/web/src/app/(platform)/platform/settings/page.tsx`
- Create: `apps/web/src/features/platform/platform-operations.tsx`
- Create: `apps/web/src/features/platform/platform-operations.module.css`
- Create: `apps/web/src/features/platform/platform-operations.test.tsx`

**Interfaces:**

- Consumes: platform operations APIs.
- Produces: filterable audit table with detail drawer, real template-application history, and a sanitized runtime-readiness page.

- [ ] Add one failing component test covering the real data and empty states.
- [ ] Implement server loaders and responsive operational components.
- [ ] Run the focused Web test.

### Task 5: Verification and SMS handoff

**Files:**

- Modify: `.env.example`
- Create: `docs/deployment/sms-verification.md`

**Interfaces:**

- Produces: documented production environment-variable contract without credentials.

- [ ] Document the provider inputs and environment boundary.
- [ ] Run API/Web typechecks, focused tests, contract drift check, and `git diff --check`.
- [ ] Inspect the modified dashboard, security, audit, operations, and settings pages once.
