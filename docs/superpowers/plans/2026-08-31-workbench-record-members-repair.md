# Workbench, Record, and Member Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dashboard configuration predictable, expose complete record CRUD in the list, and remove member-management width and overflow defects.

**Architecture:** Keep the existing dashboard configuration and record APIs. Derive dashboard visibility from the saved opportunity mapping, reuse the existing record drawer/API for list actions, and constrain responsive member layouts at the CSS/component boundary.

**Tech Stack:** Next.js 16, React 19, Ant Design 6, TanStack Query, Vitest, NestJS APIs already present.

**Spec:** `docs/superpowers/specs/2026-08-31-workbench-record-members-repair-design.md`

## Global Constraints

- Do not touch `apps/web/src/app/(auth)/register/page.tsx` or unrelated user changes.
- Do not add a dashboard widget designer or change the API contract unless the current response cannot express the required behavior.
- Keep verification focused: one dashboard test, one record-action test, browser layout checks, and Web typecheck.

---

### Task 1: Predictable dashboard configuration and adaptive modules

**Files:**

- Modify: `apps/web/src/features/dashboard/dashboard-configuration-form.tsx`
- Modify: `apps/web/src/features/dashboard/dashboard-configuration.module.css`
- Modify: `apps/web/src/features/dashboard/admin-workbench.tsx`
- Modify: `apps/web/src/features/dashboard/employee-workbench.tsx`
- Modify: `apps/web/src/features/dashboard/workbench-elements.tsx`
- Test: `apps/web/src/features/dashboard/dashboard-configuration-form.test.tsx`

**Interfaces:**

- Consumes: `DashboardConfigurationView`, `DashboardOverview`, `saveDashboardConfiguration`.
- Produces: explicit missing-stage feedback, dirty/saved state, and module visibility derived from `amountFieldKey` and `dateFieldKey`.

- [ ] Write a failing component test proving that incomplete stage groups explain why saving is unavailable and a valid save exposes the effective result.
- [ ] Run only that test and confirm it fails for the missing behavior.
- [ ] Implement validation feedback, dirty state, refresh-on-save, real object naming, and optional-module visibility.
- [ ] Run only the dashboard component test and confirm it passes.

### Task 2: Explicit record update and delete actions

**Files:**

- Modify: `apps/web/src/features/records/record-workspace.tsx`
- Modify: `apps/web/src/features/records/record-list.tsx`
- Modify: `apps/web/src/features/records/record-detail-drawer.tsx`
- Modify: `apps/web/src/features/records/records.module.css`
- Test: `apps/web/src/features/records/record-list.test.tsx`

**Interfaces:**

- Consumes: existing `RecordApi.update`, `RecordApi.remove`, `schema.actions`, and `RecordSummary.version`.
- Produces: list-level `查看`, `编辑`, and administrator-only `删除` actions; an initial editing mode for the existing drawer.

- [ ] Write a failing component test proving the operation column exposes update/delete according to effective actions.
- [ ] Run only that test and confirm it fails because no operation column exists.
- [ ] Implement list actions, direct edit mode, confirmed soft deletion, and list refresh.
- [ ] Run only the record list test and confirm it passes.

### Task 3: Responsive invitation form and stable member tables

**Files:**

- Modify: `apps/web/src/features/members/invite-member-form.tsx`
- Modify: `apps/web/src/features/members/member-table.tsx`
- Modify: `apps/web/src/features/members/members.module.css`

**Interfaces:**

- Consumes: existing invitation and membership APIs.
- Produces: full-width role selection, container-aware wrapping, fixed table column contracts, and horizontal scrolling.

- [ ] Convert invitation fields to vertical labels with a wider role control and container-width breakpoints.
- [ ] Add member/invitation column widths, ellipsis where safe, wrapped actions, and explicit table scroll widths.
- [ ] Inspect 1440px and 900px browser layouts and confirm no page-level horizontal overflow.

### Task 4: Focused verification

**Files:**

- Verify only; no new production files.

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces: evidence that the approved repair works without broad test expenditure.

- [ ] Run the two focused Vitest files.
- [ ] Run `pnpm --filter @crm/web typecheck`.
- [ ] Run `git diff --check`.
- [ ] Recheck dashboard save state, record actions, and member layout in the browser.
