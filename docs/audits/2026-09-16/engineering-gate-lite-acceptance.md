# Engineering Gate Lite — Acceptance

> 日期：2026-09-16
> 类型：Engineering Gate（CI + branch protection），非产品功能
> Stage Brief：`docs/superpowers/briefs/2026-09-16-engineering-gate-lite-stage-brief.md`
> 设计：`docs/superpowers/specs/2026-09-16-engineering-gate-lite-design.md`
> 计划：`docs/superpowers/plans/2026-09-16-engineering-gate-lite-implementation.md`

本文件只记录**实际观察到的**事实：GitHub 上真实跑出来的 check conclusion、job 日志原文、
以及 `gh api` 读回的 branch protection 状态。没有从旧验收文档抄任何数字。

## 1. 基线与产物

| 项 | 值 |
| --- | --- |
| 基线 | `89f38d459f60e85b9a06befd8f5c57ea26166957`（当时的 `origin/main`） |
| 工作分支 | `chore/engineering-gate-lite` |
| 分支提交 | `f9d8029` design spec + implementation plan 入库<br>`87a1725` 新增 `.github/workflows/ci.yml`<br>`1a89ee7` 恢复 integration fixture 的 invitation 清理（cherry-pick 自 `fix/db-integration-fixture-cleanup` 的 `a9b7bac`）<br>`5879c8d` 提高 vitest 预算到实测成本之上 |
| 合并提交 | `77af603763ed1a3b030ea705a3a2f5946c615cc7`（Merge pull request #4） |
| PR | https://github.com/Zhong0118/multi-tenant-CRM-builder/pull/4 |
| 状态 | **已合并进 `main`**；**未部署** |

实现文件只有 `.github/workflows/ci.yml`。CI 暴露的两个真实仓库缺陷另开独立提交（见 §7）。
未 reset / rebase / force-push / 部署。

## Post-merge status

> 本节由合并后补记，**不回填、不重算**下方任何验收数据。

- **PR #4 已合并进 `main`**，合并提交 `77af603763ed1a3b030ea705a3a2f5946c615cc7`。
- 分支提交：`f9d8029` / `87a1725` / `1a89ee7` / `5879c8d`。
- 下游同步：`HANDOFF.md`（第 7 节"尚未实现"与顶部）、`docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`
  的 Engineering Gate Lite 行（`PLANNED` → `COMPLETED`）与 Engineering Gate Hardening follow-up。
- **未部署生产环境。**
- **仍未做（独立任务）**：API Critical E2E 提升为 required（见 §10）；`apps/web` 的 named-role
  查询测试债（HANDOFF 第 7 节）；`actions/*@v4` 的 Node 20 弃用告警（见 §12）。
- **后续（2026-09-16，用户决定后补记）**：`enforce_admins` **已打开**。执行
  `POST /repos/{owner}/{repo}/branches/main/protection/enforce_admins` 后独立读回：
  `enforce_admins.enabled: true`，canonical `required_status_checks` 的 `enforcement_level`
  由 `non_admins` 变为 **`everyone`**；其余设置均未变（`strict: true`、五个 contexts 不变、
  approvals 0、force push / deletion 仍为 `false`）。因此 **§9 第 3 项与 §12 第 4 项里"保持默认
  `false`"是开启前的历史事实，不回填**。
- 运维注记：GitHub 的 `protection/enforce_admins` 子资源只接受 **`POST`（启用）/ `DELETE`（停用）**，
  **没有 `PATCH`** —— 用 `gh api -X PATCH .../protection/enforce_admins -F enabled=true` 会返回
  404（本次实测踩到）。紧急恢复流程：`DELETE` → 修 CI → 重新 `POST` → 读回确认。

## 2. 五个 Required Checks

Job 显示名即 GitHub 上的 check context，与设计规格 §6 完全一致：

| Check | 实际执行的命令 | 运行时 |
| --- | --- | --- |
| `Typecheck` | `pnpm --filter @crm/contracts --filter @crm/database build` → `pnpm typecheck` | ubuntu-24.04 / Node 24 / pnpm 11.19.0 |
| `Contracts` | 同上 build → `pnpm contracts:check` | 同上 |
| `Unit Tests` | 同上 build → `pnpm test` | 同上 |
| `Database Integration` | `docker compose up -d --wait postgres` → `pnpm --filter @crm/database build` → `pnpm --filter @crm/database test:integration` → `docker compose down -v` | 同上 + PostgreSQL 18 |
| `Build` | `pnpm build` | 同上 |

Workflow 顶层：`permissions: contents: read`；`concurrency: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}` + `cancel-in-progress: true`。
`grep -n "continue-on-error" .github/workflows/ci.yml` 无匹配；`grep -nE "pull_request_target|contents: write|packages: write|deployments: write"` 无匹配。
五个 job 均 `runs-on: ubuntu-24.04`，`timeout-minutes` 为 20/20/45/20/20（Contracts 与 Unit Tests 的边界见 §9）。

## 3. GitHub 上的真实运行

### 3.1 第一次运行（HEAD `1a89ee7`）— CI 抓到一个真实缺陷

Run `35111315982`（`pull_request`）：

| Check | Conclusion | 耗时 | Job |
| --- | --- | --- | --- |
| Typecheck | success | 47s | `104845449372` |
| Contracts | success | 42s | `104845448873` |
| Unit Tests | **failure** | 2m17s | `104845449425` |
| Database Integration | success | 1m3s | `104845449382` |
| Build | success | 1m16s | `104845449246` |

Unit Tests 的失败原文（job 日志）：

```text
FAIL src/features/templates/template-editor.test.tsx > TemplateEditor save and publication flow >
     lets the template wrapper inactivate and restore a field
Error: Test timed out in 20000ms.
 Test Files  1 failed | 65 passed (66)
      Tests  1 failed | 410 passed (411)
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @crm/web@0.1.0 test: `pnpm test:unit && pnpm test:architecture`
```

这条红灯正是门禁的价值证明：本地绿、干净 runner 上红。处置见 §7.3。

### 3.2 第二次运行（HEAD `5879c8d`）— 五项全绿

Run `35111849405`（`pull_request`）：

| Check | Conclusion | 耗时 | Job |
| --- | --- | --- | --- |
| Typecheck | success | 42s | `104847284276` |
| Contracts | success | 41s | `104847284315` |
| Unit Tests | success | 2m27s | `104847283926` |
| Database Integration | success | 1m10s | `104847284273` |
| Build | success | 52s | `104847284452` |

Unit Tests 里的真实计数（同一份 job 日志）：`packages/tenant-templates` 2、`packages/database` 8、
`packages/contracts` 8、`apps/worker` 2、`apps/api` **69 suites / 942 tests**、
`apps/web` **66 files / 411 tests** + architecture 3。

### 3.3 第三次运行（`main` push @ `77af603`）— push 同样触发

Run `35112198984`（`push` 到 `main`，即设计规格 §4 的 `push → main` 分支）：

| Check | Conclusion | 耗时 | Job |
| --- | --- | --- | --- |
| Typecheck | success | 44s | `104848519568` |
| Contracts | success | 41s | `104848519608` |
| Unit Tests | success | 2m29s | `104848519690` |
| Database Integration | success | 1m4s | `104848519534` |
| Build | success | 1m11s | `104848519209` |

`gh api repos/{owner}/{repo}/commits/77af603/check-runs` 在合并提交上读回五个 context，
conclusion 全部为 `success`：

```text
Unit Tests            success
Contracts             success
Typecheck             success
Database Integration  success
Build                 success
```

## 4. 本地等价复跑（合并后的 `main` = `77af603`）

在 `.worktrees/engineering-gate-lite` 内，**不 source 根 `.env`**，只导出数据库变量：

| 门 | 退出码 | 实测 |
| --- | --- | --- |
| Typecheck | 0 | 6 个 workspace，4s |
| Contracts | 0 | `git diff --exit-code` 无 drift（0 个 diff），5s |
| Unit Tests | 0 | API 69 suites / 942 tests；Web 66 files / 411 tests + architecture 3；contracts 8；database 8；tenant-templates 2；worker 2，27s |
| Build | 0 | 6 个包，9s |
| Database Integration | 0 | **18 tests / 18 pass / 0 fail**，7s |

本地用的是仓库真实命令，与 CI job 一一对应，没有"为了绿而绿"的独立脚本。

## 5. Database Integration 的真实数据库边界

以下均为 job `104845449382` 日志原文（已去掉时间戳前缀）：

```text
Container multi-tenant-crm-postgres-1  Creating
Container multi-tenant-crm-postgres-1  Created
Container multi-tenant-crm-postgres-1  Starting
Container multi-tenant-crm-postgres-1  Started
Container multi-tenant-crm-postgres-1  Healthy
Prisma schema loaded from prisma/schema.prisma.
18 migrations found in prisma/migrations
Applying migration `0001_account_workspace`
... （0002 … 0018，逐条）
Applying migration `0018_workflow_actions`
All migrations have been successfully applied.
ℹ tests 18
ℹ pass 18
ℹ fail 0
##[group]Run docker compose down -v
 Container multi-tenant-crm-postgres-1  Stopping / Stopped / Removing / Removed
 Network multi-tenant-crm_default  Removing
 Volume multi-tenant-crm_postgres_data  Removing
```

数据库来自仓库自己的 `compose.yaml`（`postgres:18-alpine`），migration 由 integration helper 跑 `prisma migrate deploy`，
跑完 `down -v` 连 volume 一起销毁，runner 上不留状态。

两个 URL 都出现在 job 环境中（GitHub 把凭据部分打码为 `***`，这是平台的 secret masking，不是明文缺失）：

```text
TEST_DATABASE_ADMIN_URL: ***localhost:5432/crm?schema=public
TEST_DATABASE_URL: ***localhost:5432/crm?schema=public
```

runtime 角色仍是 `crm_app` 而不是 superuser：workflow 把 `TEST_DATABASE_URL` 指到 `crm_app`，
而 `rls.test.mjs` 断言"跨租户邀请不可读、成员不可改、audit 只可追加"，这些断言只有在
**非 BYPASSRLS** 角色下才可能通过。角色属性在本地隔离实例上独立核实：

```text
crm     | rolsuper=t | rolcreatedb=t | rolcreaterole=t | rolbypassrls=t
crm_app | rolsuper=f | rolcreatedb=f | rolcreaterole=f | rolbypassrls=f
```

## 6. 并发取消（superseded run）

配置（workflow 原文）：

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

同一个 PR 的 group 是 `ci-CI-<PR number>`，同一分支的 push 会进入同一个 group，因此新 run 到达时
旧 run 被取消。

### 6.1 实测观察（本文件所在的收口 PR）

在本文件所在的 PR 上实测：先推 `b9ef5ff`（run `35112924792`），随后推 `e65ba99`（run `35112963673`）。
`gh run list` 读回：

```text
35112963673 e65ba99 status=in_progress  conclusion=
35112924792 b9ef5ff status=completed    conclusion=cancelled
```

即**旧 run 被取消（`cancelled`），新 commit 的 run 继续**，与设计规格 §13 第 3 条一致。
被取消的 run 只有取消结论、没有被误报成失败或成功。

## 7. 过程中发现并修复的三个真实缺陷

### 7.1 `prisma generate` 在干净 runner 上必然失败（工作流内修复）

`packages/database/prisma.config.ts` 用 `prisma/config` 的 `env("DATABASE_ADMIN_URL")`，
**变量缺失时连 config 模块都加载不了**：

```text
Failed to load config file ".../packages/database" as a TypeScript/JavaScript module.
Error: PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_ADMIN_URL.
```

而 `Typecheck` / `Contracts` / `Unit Tests` / `Database Integration` / `Build` 五个 job 都会间接执行
`prisma generate`，所以在没有 `.env` 的 runner 上会**五个 job 全红**。把 URL 指向**无人监听的死端口**
仍能生成成功，证明 `prisma generate` 不建立连接、只需要变量存在。修复方式是在 workflow 顶层提供
这个**非密**占位值（与 `compose.yaml` 一致），Database Integration 再用 `TEST_DATABASE_ADMIN_URL`
覆盖它做 `prisma migrate deploy`。

设计规格 §6 没有预见到这一依赖；这是在真实干净环境（worktree 故意不复制 `.env`）下暴露的。

### 7.2 integration fixture 清理缺一行（独立提交修复）

`packages/database/test/integration/helpers.mjs` 的 `cleanupTestFixtures()` 在 commit
`b18cbda`（2026-09-03，"feat(dashboards): support multiple named tenant workbenches"）被**误删**了：

```diff
-    await admin.tenantInvitation.deleteMany({
-      where: { tenantId: { in: tenantIds } },
-    });
```

`tenant_invitations.tenant_id` 是 `ON DELETE RESTRICT`（migration `0001_account_workspace`），
因此紧随其后的 `tenant.deleteMany()` 必然报错：

```text
Database error. Code: `23001`. Message: `update or delete on table "tenants" violates
RESTRICT setting of foreign key constraint "tenant_invitations_tenant_id_fkey"`
    at async cleanupTestFixtures (.../helpers.mjs:158:5)
    at async TestContext.<anonymous> (rls.test.mjs:23:3)
```

`rls.test.mjs` 的 `beforeEach` 与 `afterEach` 都走 `cleanupTestFixtures`，于是该文件 4 个测试全挂。
修复前（干净 main，隔离实例）：**18 tests / 14 pass / 4 fail**；恢复这 3 行后：**18 tests / 18 pass**。
`resetTestData()` 未受影响，因为它保留了同一行。

反向验证：同一条命令、同一个干净库，修前 14/18、修后 18/18；GitHub 上 run `35111315982` 的
Database Integration 是在**带修复**的 `1a89ee7` 上通过的。

### 7.3 Web 测试预算低于 runner 实测成本（独立提交修复）

`apps/web/vitest.config.ts` 显式写着 `testTimeout: 20000`，其注释已经说明成本来自 antd + jsdom 的
named-role 查询。实测该测试在本机需 12.5s、在 ubuntu-24.04 上需 25.4s（runner 约慢 2 倍），
于是撞上预算把 Unit Tests 判红。修复为 60s（对最坏观测值约 2.4 倍余量，同时仍能界定真正挂死的测试），
并保留原有"新断言优先用 `getByText`/`getByLabelText`"的说明。修完 run `35111849405` 的 Unit Tests 通过。
根因（named-role 查询的测试债）仍是独立任务，见 §10。

## 8. 分支保护（写后独立读回）

开启前置条件（两条都已满足）：CI 已在 `main` 上；五个 check context 已真实出现并通过。

`PUT /repos/{owner}/{repo}/branches/main/protection` 之后，用 `GET` 独立读回：

| 设置 | 读回值 |
| --- | --- |
| `main.protected` | `true` |
| `required_status_checks.strict`（要求分支最新） | `true` |
| `required_status_checks.contexts` | `["Typecheck","Contracts","Unit Tests","Database Integration","Build"]` |
| `required_status_checks.checks[].context` | 同上五个 |
| `required_pull_request_reviews` | 存在，`required_approving_review_count: 0` |
| `allow_force_pushes.enabled` | `false` |
| `allow_deletions.enabled` | `false` |
| `restrictions` | `null` |

未声明"写请求成功即保护生效"——上表来自单独的读取请求。

## 9. 与实现计划的偏差（主动披露）

1. **没有按计划字面执行 `docker compose up -d --wait postgres` + `docker compose down -v`。**
   `compose.yaml` 顶部写死 `name: multi-tenant-crm`，而本机该 stack 正在运行、`multi-tenant-crm_postgres_data`
   卷背后是开发者本机 5432 的真实数据；`resetTestData()` 本身还会 `deleteMany` 掉全部业务行。
   因此本地验证改用隔离项目 + 端口覆盖（`-p egl-verify`，`ports: !override ["55432:5432"]`），
   用完 `down -v` 只清自己的卷；开发者的 3 个容器与 3 个卷在验证前后均完好。CI 上仍是计划里的原命令。
2. **给 `Contracts`(20min) 与 `Unit Tests`(45min) 补了 `timeout-minutes`。** 计划只给了另外三个 job；
   不给边界等于默认 6 小时挂死。实测本地 5s / 27s，余量充足。
3. **`enforce_admins` 保持 GitHub 默认 `false`。** 设计规格 §8 的设置清单未包含该项，因此没有自行加大；
   含义是仓库管理员仍可绕过 required checks。这是**有意披露**的选择，不是遗漏（见 §12）。
   **（2026-09-16 后续已由用户决定打开为 `true`，读回 `enforcement_level: everyone`；本节保留开启前的历史事实，见 Post-merge status。）**

## 10. 已知排除项（Known exclusions）

- **API Critical E2E 目前不是 required check。** 它被明确保留为 **Engineering Gate Hardening
  follow-up**，目标形态是 `Required Gate V2 = 现有五项 + Critical API E2E`。
- **Auth E2E 存在历史响应形状漂移，没有被静默豁免。** `apps/api/test/auth.e2e-spec.ts` 仍按数组断言
  `GET /api/v1/me/sessions`，而接口已返回分页对象；本任务未修改它，也未把它塞进 required。
- **repo-wide lint 目前不是 required。** 仓库存在历史 lint 债务，按设计规格 §10 不在本阶段清零。
- **浏览器 E2E、Redis/Worker 队列测试、部署/CD、SAST/依赖扫描、覆盖率门槛、release 自动化**均不在本阶段。

### 10.1 设计规格 §13 中未在 GitHub 上执行的验收项

设计规格 §13「CI 行为」共 10 项。已实际执行并记录的有：第 1/2 项（PR 与 `main` push 都触发，
见 §3.1–§3.3）、第 3 项（同 PR 新 push 取消旧 run，见 §6.1）、第 7/8 项（真实 PostgreSQL 18 +
`crm_app` 跑通 18 个测试，见 §5）、第 10 项（required job 无 `continue-on-error`，见 §2 的 grep）。

**第 4/5/6/9 项没有在 GitHub 上执行**：即"人为制造 type error 让 `Typecheck` 红""人为制造 contract
drift 让 `Contracts` 红""人为制造 failing test 让 `Unit Tests` 红""真实 production build 失败让
`Build` 红"。原因是这四项要验证的是仓库自己的脚本（`pnpm typecheck` / `pnpm contracts:check` /
`pnpm test` / `pnpm build`），要观察到红灯就必须把**临时损坏的代码**推上分支；而实现计划 Task 3
只要求"五项全绿 + 并发取消 + 查看 Database Integration 日志"，且本任务的硬范围不允许改 `apps/**`
与 `packages/**` 去注入合成缺陷。

设计规格 §13 原文允许这类破坏性验证**临时执行后还原**（"不要求把破坏性验证提交到最终分支"），
因此这是一项**明确记录为未做**的可选项，而不是被悄悄跳过的必做项；建议与 Engineering Gate
Hardening 一并补做。相对地，§3.1 那次真实红灯（Unit Tests 超时）是一次**非人为**的捕获，
它证明了这个门禁确实会拦下本地绿、干净 runner 红的改动。

## 11. Definition of Done 对照

| 条件 | 状态 | 证据 |
| --- | --- | --- |
| CI workflow 在 `main` 上 | ✅ | `77af603`；`git show origin/main:.github/workflows/ci.yml` 退出 0 |
| Typecheck required | ✅ | §8 读回 |
| Contracts required | ✅ | §8 读回 |
| Unit Tests required | ✅ | §8 读回 |
| Database Integration required | ✅ | §8 读回 |
| Build required | ✅ | §8 读回 |
| main branch protection read-back = protected | ✅ | §8 |
| 陈旧分支必须先更新 | ✅ | `strict: true` |
| force push 被禁止 | ✅ | `allow_force_pushes.enabled: false` |
| 删除分支被禁止 | ✅ | `allow_deletions.enabled: false` |
| 验收文档只有真实观察证据 | ✅ | 本文件 |
| HANDOFF 与 Lean Roadmap 已同步 | ✅ | 同一 PR |
| API Critical E2E follow-up 仍明确 PLANNED | ✅ | §10 + Lean Roadmap |

## 12. 后续任务（本阶段未做，均需单独批准）

1. **Engineering Gate Hardening**：把 Critical API E2E（Auth/Session、Tenant 隔离、Record CRUD、
   Workflow Transition、代表性 Action 原子性）提升为 required —— 状态 **PLANNED**，不是 ACTIVE。
2. **`apps/web` named-role 查询测试债**：HANDOFF 第 7 节记录的 `getByRole(..., { name })` 成本，
   转成 `getByText`/`getByLabelText` 后可把 60s 预算收回去。
3. **`actions/*@v4` 的 Node 20 弃用告警**：三次运行都出现
   `Node.js 20 is deprecated ... actions/checkout@v4, actions/setup-node@v4, pnpm/action-setup@v4`。
   当前不影响结论（被强制跑在 Node 24 上），但后续应升级 action 版本。
4. **是否把 `enforce_admins` 打开**：**已于 2026-09-16 由 owner 决定并执行（= 打开）**，管理员也必须走 PR + 五项 check；见 Post-merge status 的读回证据。
