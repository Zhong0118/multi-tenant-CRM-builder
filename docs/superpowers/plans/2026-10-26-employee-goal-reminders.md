# Employee Goal Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 管理员配置员工每日目标，员工看到真实进度并在未达标时收到一次站内提醒。
**Architecture:** 现有 work、notifications 模块；共享 SQL 指标函数；新增目标规则/受众表；复用站内消息和每分钟调度。
**Tech Stack:** NestJS, Prisma/PostgreSQL RLS, Next.js, Ant Design, TanStack Query, Jest/Vitest.
**Spec:** docs/superpowers/specs/2026-10-26-employee-goal-reminders.md

## Global Constraints

仅本地专用测试数据库；不部署、不改生产或其他工作树。无新依赖。指标、接口和限制以 spec 为准。用户已授权实施及独立 PR，正常推送无需再次询问。

### Task 1: Backend, storage and shared metrics

**Files:** create migration `0040_employee_work_goals/migration.sql`, `apps/api/src/modules/work/work-goals.service.ts`, `work-goals.controller.ts`, `dto/work-goals.dto.ts`, tests `apps/api/test/work-goals.e2e-spec.ts`, `packages/database/test/integration/work-goals.test.mjs`; modify Prisma schema, work-metrics.ts, work.module.ts, notifications service/DTO/scheduler and their relevant tests. Regenerate contracts after stable interfaces.

**Interfaces:** consume spec API types; produce those exact endpoints and response properties, shared SQL counter function, existing member-notification integration. New notification kind WORK_GOAL_BEHIND with target /workspace/:tenantCode/work.

- [x] Write real database tests showing missing goal storage/function, then run and record RED evidence. Example essential assertions:
```js
await sweepGoals(); await sweepGoals();
assert.equal((await noticesFor(employee)).length,1);
assert.equal((await noticesFor(otherTenantEmployee)).length,0);
assert.equal((await currentProgress(employee)).actual,1);
```
- [x] Implement additive schema, same-tenant FK/RLS, shared metric function and bounded notification scanning, with old notification constraints retained. Scan uses server/company calendar, not JS host date.
- [x] Write API tests for admin config, selected recipients, expectedVersion, personal/team progress, then implement DTO/controller/service using existing context/audit/member locking patterns.
- [x] Add notification-kind rendering metadata/target support in backend, register scheduler call without overlapping ticks. Verify old notifications still pass.
- [x] Run focused API/database tests, typecheck and contract generation. Commit only backend, database, contracts and related tests. Write report with commands and RED/GREEN evidence.

### Task 2: UI and acceptance

**Files:** create `apps/web/src/features/work/work-goals.tsx`, `work-goals-api.ts`, `work-goals.test.tsx`, `work-goals.module.css`; modify team-activity.tsx, my-work.tsx, notification-bell.tsx and related tests.

**Interfaces:** consume Task 1 endpoints exactly; administrator controls from team page; personal panel on /work. Existing components and transitions, reduced-motion support; no emoji or extra dependency.

- [x] Add failing tests for goal progress, administrator configuration payload/selected users, server conflict preserving inputs, and notification target.
- [x] Add compact progress cards and admin Drawer: metric, target, weekdays, company-local reminder time, all/selected employees, enabled. Existing configured rules are editable with expectedVersion, no implicit reset of untouched rules.
- [x] Integrate team and personal panels; add 目标提醒 group with 查看目标 action while keeping record-message wording unchanged.
- [x] Run frontend tests/lint/typecheck, then full monorepo tests/build/contracts and real local admin/employee flow in a dedicated database. Record existing-data baseline and compare.
- [ ] Independent whole-branch review; fix meaningful findings with tests. Push/create PR, await six checks, merge after passing. Do not deploy. Next feature starts from merged main.
