# Engineering Gate Hardening — Design

> 日期：2026-09-17  
> 类型：Architecture / Engineering Design  
> 状态：APPROVED FOR IMPLEMENTATION  
> Roadmap Stage：Engineering Gate Hardening  
> 当前基线：`main` @ `abb1c2baf337e8c408439489fef4fddebb1f9d72`  
> 前置条件：Engineering Gate Lite 与 Sales Workbench Lite 已完成；`main` 当前 5 个 required checks 为 `Typecheck` / `Contracts` / `Unit Tests` / `Database Integration` / `Build`。  
> 后续顺序：Engineering Gate Hardening → AI Assistant V1A → AI Assistant V1B → Production Essentials。

## 1. 目标

把现有 Gate Lite 从 5 门提升为 `Required Gate V2`：

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
Critical API E2E
```

新增的 `Critical API E2E` 不等于全量 API E2E，而是一套小而稳定、真实走 HTTP + PostgreSQL + `crm_app` RLS 的关键链路测试，用于在 AI Assistant 开发前自动守住：

```text
Auth identity
Tenant boundary
Record permission
Workflow transition
Transactional Action rollback
```

## 2. 为什么不把全量 API E2E 直接设为 required

仓库已有多套 API E2E，包括 Auth、Dynamic Records、Action Engine、Onboarding、Business Templates 等。现有完整 E2E 中存在重型场景，例如 CSV 并发、真实 deadlock、复杂 Action fixture、附件与完整 onboarding 流程。

把 `pnpm --filter @crm/api test:e2e` 整套直接设为 required 会把非关键、重型、变化频率高的场景绑定到每个 PR 上，增加运行时间与 flaky 风险。

因此采用专用 Critical suite：只覆盖后续 AI 最依赖的五条安全/事务链路；完整 E2E 继续保留为 manual / scheduled / release 级验证。

## 3. 实现拆分：两个 PR

Engineering Gate Hardening 固定拆成两个独立 PR。

### PR A — Critical API E2E Stabilization

职责：让 Critical suite 本身可信、稳定、可本地复现。

允许修改：

```text
apps/api/test/critical-api.e2e-spec.ts
apps/api/test/helpers/critical-fixture.ts
apps/api/test/auth.e2e-spec.ts
apps/api/package.json
相关 Design / Plan / HANDOFF / Lean Roadmap 文档
```

PR A 明确不允许：

```text
修改 .github/workflows/**
修改 branch protection
把 Critical API E2E Promote 为 required
顺手修改产品行为以让测试变绿
```

### PR B — Critical API E2E Gate Promotion

前提：PR A 已合并到 `main`。

职责：把已稳定的 Critical suite 接入 CI，并 Promote 为第六个 required check。

允许修改原则上仅包括：

```text
.github/workflows/ci.yml
Acceptance / HANDOFF / Lean Roadmap 等收口文档
```

PR B 明确不允许：

```text
修改 apps/** 产品逻辑
修测试行为
顺手修 Auth / Record / Workflow bug
```

如果 PR B 暴露测试或产品真实缺陷，立即停止 Gate Promotion，另开独立修复 PR；修复合并后再继续 PR B。

## 4. Critical API E2E 的五个核心场景

### 4.1 Auth / Session

验证最小身份链路：

1. 注册或登录成功，session cookie 生效；
2. `GET /api/v1/me` 能识别当前用户；
3. `GET /api/v1/me/sessions` 使用当前真实分页 contract `{items,page,limit,total}`；
4. revoke 一个 session 后，该 session 失效；
5. response 不泄露 `tokenHash` 等内部字段。

PR A 同时修正现有 `auth.e2e-spec.ts` 的历史 contract drift：旧测试仍按数组断言 `/me/sessions`，而当前接口已经是分页对象。

不把完整 forgot/reset-password 流程塞进 Critical Gate。

### 4.2 Tenant / Workspace Isolation

验证 HTTP 层租户边界：

```text
合法 Tenant A Actor
→ 请求 Tenant B workspace API
→ 必须拒绝
→ Tenant B 数据保持不变
```

重点证明：

```text
Session Actor
→ WorkspaceGuard
→ TenantContext
→ repository / RLS
→ API response
```

Database Integration 继续负责更底层的 RLS/schema 证明；Critical API E2E 不重复覆盖所有 policy。

### 4.3 Record CRUD / Permission

最小覆盖：

1. employee 在可访问对象中 create record；
2. list/get 能读到自己的 record；
3. `OWN` scope 下不能读其他成员 record；
4. hidden field 不出现在 response；
5. 正确 `version` update 成功；
6. stale `version` 返回 409。

不纳入 required Critical suite：CSV import/replay、附件、record number 并发、批量更新等。

### 4.4 Workflow Transition

准备一个最小 published object/workflow，验证：

1. Record 从 published initial state 开始；
2. Actor 能读取允许的 transition；
3. execute transition 成功；
4. state 与 version 更新；
5. transition history 落库；
6. 再用旧 version 执行失败。

Critical suite 不重复所有 required-field/HIDDEN 组合；这些继续由现有 unit / hardening regression 保护。

### 4.5 Representative Action Atomicity

只保留一个代表性真实事务回滚场景：

```text
Transition
→ Action 1 成功写入
→ Action 2 因权限失败
→ 整个事务回滚
```

必须断言：

```text
source state 不变
source version 不变
Action 1 副作用不存在
Transition history 不存在
成功型 audit 不存在
```

不把真实 deadlock 制造、全部 Action 类型、复杂并发带进 required Critical suite。

## 5. Critical Fixture

新增最小 fixture，而不是直接 import 现有 `dynamic-records.e2e-spec.ts` / `action-engine.e2e-spec.ts` 内部的大型私有 helper。

建议结构：

```text
apps/api/test/critical-api.e2e-spec.ts
apps/api/test/helpers/critical-fixture.ts
```

fixture 只负责：

```text
create/start Nest app
create admin DB client
create runtime context / session cookie
cleanup 自己的测试数据
创建 Tenant A / Tenant B
创建 admin / employee
创建最小 object / publication / workflow
创建最小 record
close app / disconnect DB clients
```

不建设通用 factory DSL，不抽象成“可配置一切”的测试框架。少量重复优先于 required gate 对巨大 fixture 的耦合。

## 6. 本地运行入口

保留现有：

```bash
pnpm --filter @crm/api test:e2e
```

新增专用命令：

```bash
pnpm --filter @crm/api test:e2e:critical
```

该命令只运行 Critical suite。

Critical suite 使用现有 E2E Jest 配置：

```text
maxWorkers = 1
```

不得通过 Jest retry、`--forceExit` 或 sleep 掩盖资源泄漏和不稳定性。

## 7. Critical Suite 稳定性标准

PR A Promote 条件：同一个 commit 在 fresh PostgreSQL 上连续 3 次独立 clean run 全绿。

每次都必须：

```text
fresh DB
migrate deploy
run Critical suite
normal app close / DB disconnect
cleanup / down -v
```

如果无代码变化却出现一次失败，则先判定为 unstable，不进入 PR B。

排查顺序：

1. fixture 是否依赖旧数据；
2. cleanup 是否不完整；
3. 时间是否依赖 wall clock；
4. session/cookie 是否共享污染；
5. record/version 是否依赖 test order；
6. async resource 是否未关闭；
7. 是否误带非必要 concurrency / lock 场景。

固定 tenantCode / objectCode / phone 可以接受；UUID 可随机。除非测试本身验证“现在”，时间输入优先固定 UTC 值，避免 wall-clock flaky。

## 8. PR A 发现真实产品缺陷时的纪律

PR A 可以修“测试漂移”，例如 `/me/sessions` 断言从数组更新为当前分页 contract。

但如果测试稳定化过程中发现当前产品行为与正式 contract / security boundary 不一致，则：

```text
STOP
→ 报告真实产品缺陷
→ 独立 bugfix PR
→ merge
→ Critical PR A rebase/refresh from new main（仅正常更新分支，不做历史重写）
→ 继续 Hardening
```

CI / gate infrastructure、产品修复、测试稳定化不得混在同一 PR。

## 9. Critical API E2E CI Job

PR B 在 `.github/workflows/ci.yml` 新增独立 job：

```text
Job id: critical-api-e2e
Display name: Critical API E2E
Runner: ubuntu-24.04
Timeout: 20 minutes
```

执行流：

```text
Checkout
→ Setup pnpm 11.19.0
→ Setup Node 24
→ pnpm install --frozen-lockfile
→ docker compose up -d --wait postgres
→ build @crm/contracts + @crm/database
→ prisma migrate deploy
→ pnpm --filter @crm/api test:e2e:critical
→ failure 时输出 postgres logs
→ always: docker compose down -v
```

Critical job 使用与 Database Integration 相同的 ephemeral PostgreSQL credentials，但拥有自己独立的 job / database lifecycle，不与 Database Integration 共用容器状态。

API runtime 必须使用：

```text
TEST_DATABASE_URL = crm_app / NOBYPASSRLS
```

migration/admin 操作使用 admin URL。不得让 API 为了测试方便以 admin/superuser 运行。

## 10. 为什么 Critical API E2E 必须是独立 Job

最终 CI：

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
Critical API E2E
```

`Database Integration` 负责数据库/schema/RLS 层；`Critical API E2E` 负责真实 HTTP + Session + TenantContext + Service/Repository + DB 的完整关键链路。

两个 job 独立运行，可并行，失败类型一眼可辨。

## 11. 失败语义

`Critical API E2E` 成为 required 后：

```text
任何失败 = 阻止 merge
```

禁止：

```text
continue-on-error: true
|| true
Jest retry 掩盖 flaky
failure → warning
空跑/skip 但保留绿色 check 名称
```

fixture / DB 启动失败同样是红灯；GitHub runner 瞬时故障可人工 rerun，但不得自动降级为 success。

## 12. Branch Protection Promote

不能先把一个尚未出现、尚未验证的 context 加入 required。

固定顺序：

```text
PR B 打开
→ Critical API E2E job 首次真实出现
→ hosted run 实际执行 Critical suite并成功
→ 将 main required contexts 从 5 增为 6
→ API/UI read-back branch protection
→ PR B 最终 head 在 6 required checks 下再次全部绿色
→ 才允许 merge PR B
```

最终 required contexts：

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
Critical API E2E
```

继续保持：

```text
main protected
enforcement = everyone
force push disabled
branch deletion disabled
required branches up-to-date
```

## 13. Acceptance Evidence

Hardening Acceptance 只记录真实观察到的证据，不提前填 run ID / test count。

必须覆盖：

### A. Critical suite 内容

五类场景全部存在：Auth/Session、Tenant isolation、Record CRUD/permission、Workflow Transition、Action atomicity。

### B. PR A 稳定性

```text
fresh DB 连续 3 次 green
无 retry
无 forceExit
app / DB client 正常 close/disconnect
Auth historical drift 已清除
```

### C. PR A hosted evidence

```text
PR A 原五门 required checks 继续 green
PR A 未修改 CI / branch protection
Critical suite 已合入 main
```

### D. PR B CI evidence

```text
Critical API E2E job 存在
启动真实 PostgreSQL
migrate deploy
实际执行 Critical suite
teardown 成功
```

### E. Branch protection

```text
required contexts = 6
Critical API E2E 在列表中
enforcement = everyone
force push / deletion 仍关闭
```

### F. Post-merge main

PR B merge 后，`main` 六门全部 success。

## 14. Definition of Done

Engineering Gate Hardening 只有在以下全部完成后才标记 `COMPLETED`：

```text
PR A merged
Critical suite stable
Auth test drift cleared

PR B merged
Critical API E2E hosted success
branch protection 5 → 6
main post-merge six gates green

Acceptance complete
HANDOFF updated
Lean Roadmap Engineering Gate Hardening → COMPLETED
AI Assistant V1A 仍保持 PLANNED
```

如果 PR B 已 merge 但 `main` 的 Critical API E2E 失败，Hardening 仍是未完成状态。

## 15. Roadmap 状态流转

当前设计阶段：

```text
Engineering Gate Hardening = PLANNED
```

真正开始 PR A 开发时：

```text
Engineering Gate Hardening = ACTIVE
```

PR A 合并后仍为 ACTIVE。

只有 PR B merge + main 六门 green + Acceptance 收口后：

```text
Engineering Gate Hardening = COMPLETED
```

此时：

```text
AI Assistant V1A = PLANNED
```

完成 Hardening 不自动 Promote AI V1A。

## 16. 非目标

Engineering Gate Hardening 不做：

- 全量 API E2E required；
- Browser E2E；
- Redis / worker integration gate；
- repo-wide lint cleanup / lint required；
- SAST / dependency scanning platform；
- coverage percentage gate；
- deployment / CD；
- production secrets；
- CSV / attachment / business-template / onboarding 全流程 required；
- deadlock / 高并发场景 required；
- AI Assistant 实现。

## 17. 对 AI V1A 的交棒价值

Hardening 完成后，AI Assistant V1A 开发前已有 required CI 自动保护：

```text
AI request
→ Session Actor              [Auth / Session]
→ TenantContext              [Tenant Isolation]
→ Record read tools          [Record Permission]
→ Workflow awareness         [Workflow Transition]
→ future V1B typed writes    [Action Atomicity]
```

Hardening 的目的不是单纯增加一个 CI job，而是在 AI 开发前把最关键的权限与事务链路变成不可绕过的自动门禁。
