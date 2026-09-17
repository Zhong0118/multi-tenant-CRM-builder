# Sales Workbench Lite — Acceptance

> 日期：2026-09-17
> 类型：产品阶段验收（员工首页 Personal Follow-up Workbench）
> Stage Brief：`docs/superpowers/briefs/2026-09-16-sales-workbench-lite-stage-brief.md`
> 设计：`docs/superpowers/specs/2026-09-17-sales-workbench-lite-design.md`
> 计划：`docs/superpowers/plans/2026-09-17-sales-workbench-lite-implementation.md`

本文件只记录**实际观察到的**事实：GitHub check conclusion、job 日志计数、以及合入 `main` 的提交。没有从旧验收文档抄数字，也没有把没跑过的浏览器走查写成做过。

## 1. 基线与产物

| 项 | 值 |
| --- | --- |
| 基线 | `aa505d37766816fc751a91280f6cd82d1153eae5`（当时的 `origin/main`） |
| 工作分支 | `feat/sales-workbench-lite` |
| 功能 PR | https://github.com/Zhong0118/multi-tenant-CRM-builder/pull/9 |
| 合并提交 | `a6e08b2d853424ae4146abdc769ec6c007fb8e35`（Merge pull request #9） |
| 状态 | **已合并进 `main`**；**未部署** |

分支提交（相对基线）：

```text
b38af2c docs: activate sales workbench lite
d58293a feat: add follow-up workbench calendar boundaries
cb42947 feat: add personal follow-up workbench query
9f8e45e feat: expose personal follow-up workbench api
76ec1cc feat: add follow-up workbench web client
a08cbaf feat: add personal follow-up workbench ui
6fcd78c feat: surface follow-ups on employee home
fa925c6 fix: align workbench overdue with follow-up domain
```

未 reset / rebase / force-push / 部署。没有 Prisma 迁移，没有 Dashboard widget / publication schema 改动，没有 CI workflow 改动。

## Post-merge status

> 本节由合并后补记，**不回填、不重算**下方任何验收数据。

- **PR #9 已合并进 `main`**，合并提交 `a6e08b2d853424ae4146abdc769ec6c007fb8e35`。
- 下游同步：`HANDOFF.md` 顶部与已知缺口节、`docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md` 的 Sales Workbench Lite 行（`ACTIVE` → `COMPLETED`）、本验收文档、design 状态行。
- **未部署生产环境。**
- **下一阶段仍是 Engineering Gate Hardening（PLANNED，不是 ACTIVE）**：Critical API E2E 升为第六个 required check，位置在 AI Assistant V1A 之前。**不要把 AI V1A 标 ACTIVE。**
- **仍未做（独立任务，不是本阶段缺口）**：`apps/web` named-role 查询测试债；`actions/*@v4` 的 Node 20 弃用告警；`MEMBER` 默认值存在性无法在分析期校验；`action-engine.ts:631-655` 嵌套 fieldErrors；`effective-access.ts` 的 `?? 'EDIT'` / `?? 'HIDDEN'`。

## 2. Hosted CI

### 2.1 功能 PR head `fa925c6`（pre-merge）

Run `35183993948`（`pull_request`）：https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/35183993948

| Check | Conclusion | 耗时 | Job |
| --- | --- | --- | --- |
| Typecheck | success | 49s | `105082009851` |
| Contracts | success | 38s | `105082010022` |
| Unit Tests | success | 2m21s | `105082009943` |
| Database Integration | success | 1m11s | `105082009956` |
| Build | success | 1m6s | `105082009959` |

Unit Tests job 日志计数：`Test Suites: 70 passed, 70 total` / `Tests: 960 passed, 960 total`。
Database Integration job 日志：`Container multi-tenant-crm-postgres-1  Healthy` → `All migrations have been successfully applied.` → `ℹ tests 18` / `ℹ pass 18` / `ℹ fail 0`。

### 2.2 `main` 合并后 `a6e08b2`

Run `35186277137`（`push`）：https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/35186277137

| Check | Conclusion | 耗时 | Job |
| --- | --- | --- | --- |
| Typecheck | success | 50s | `105088920436` |
| Contracts | success | 47s | `105088920300` |
| Unit Tests | success | 2m14s | `105088920448` |
| Database Integration | success | 1m16s | `105088920466` |
| Build | success | 48s | `105088920596` |

`gh api .../commits/a6e08b2/check-runs` 读回五个 context 均为 `success`。
Unit Tests：`70 suites / 960 tests`。Database Integration：`18/18`。

## 3. 本地聚焦计数（合入前最后一次，head `fa925c6`）

```text
focused API   3 suites / 36 tests
focused web   3 files  / 24 tests
typecheck     exit 0
contracts     exit 0（0 drift）
pnpm test     API 70/960；Web 66 files / 416 tests
pnpm build    exit 0
DB integration 18/18（隔离 compose 项目 sales-workbench-verify，端口 55433，跑完 down -v）
```

## 4. 产品行为（代码 + 测试观察到的）

- 员工首页固定 `PersonalFollowUpWorkbench`；Dashboard `UNCONFIGURED` 时仍渲染该块，管理员 `UNCONFIGURED` 仍走原配置引导（`workspace-home-view.test.tsx` 12/12）。
- 完成动作走既有 `PATCH /follow-ups/:id` + observed `version` + `status: "DONE"`；组件测试断言 `api.update('northwind', 'task-1', { version: 3, status: 'DONE' })`。
- 租户日历加天：`follow-up-workbench-time.spec.ts` 覆盖 Asia/Shanghai 午夜偏移，以及 America/Los_Angeles 春季 DST（`tomorrowStart - todayStart === 23h`）。
- **overdue 与 Follow-up Domain 对齐（pre-merge `fa925c6`）**：`dueAt < now`；today = `now <= dueAt < tomorrowStart`；upcoming = `tomorrowStart <= dueAt < day8Start`。回归：租户本地当天 09:00 到期、15:00 查询必须进 overdue，不得进 today。设计 §6.3 已改成同一套定义。

## 5. 安全证据

| 断言 | 观察 |
| --- | --- |
| 无 actor-selection 参数 | `FollowUpsController.workbench` 只有 `@CurrentTenant()`；`expect(service.workbench.length).toBe(1)` |
| assignee 钉死当前成员 | repository `workbench()` 的每条查询 `assigneeMemberId: context.memberId`，无 query/body 覆盖 |
| 不可见 Record 不进 Workbench | 查询强制 `record.deletedAt: null` + readable object/owner `OR`；`scopes.length === 0` 时直接返回空 shape、不查库 |
| 安全 DTO | item 字段仅为 `id, recordId, recordTitle, objectCode, objectName, title, dueAt, version, overdue, canManage`；测试断言没有 `assigneeMemberId` / `assigneeName` / `status` |
| 租户边界 | `tenantId: context.tenantId` 写在 Follow-up 与 Record 两侧；走既有 `withTenant` / RLS，无 BYPASSRLS |

## 6. 已知排除 / 故意没做

- **`follow-up-summary.tsx` 未删除**：`admin-workbench.tsx` 仍引用；Global Constraint 要求管理员首页行为不变。员工首页只有 Workbench，没有双入口。Code Review 认可。
- 没有 Dashboard widget、publication schema、Prisma 迁移、通知、团队/主管视图、Automation、AI、CI 改动、Critical API E2E Promote。
- 本验收**没有**独立真人浏览器走查首页；UI 证据来自 Vitest（workbench 5 + panel 7 + home 12）。
- `actions/*@v4` 的 Node 20 弃用 annotation 仍在 CI 日志里出现，属既有告警，本阶段未升版本。

## 7. 下一阶段

Engineering Gate Hardening 仍是 **PLANNED**，在 AI Assistant V1A 之前。完成本阶段**不自动** Promote Hardening 或 AI。
