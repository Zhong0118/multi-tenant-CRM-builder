# Engineering Gate Lite — Design

> 日期：2026-09-16  
> 类型：Architecture / Engineering Design  
> 状态：APPROVED FOR IMPLEMENTATION  
> Stage Brief：`docs/superpowers/briefs/2026-09-16-engineering-gate-lite-stage-brief.md`  
> 当前基线事实：Record Required Field Visibility Hardening 已通过 PR #3 合并；当前下一阶段为 Engineering Gate Lite。

## 1. 目标

为后续 Sales Workbench、AI Assistant 和 Production Essentials 建立一个**真实、最小、可升级**的 GitHub 工程门禁。

Engineering Gate Lite 第一版不是“做一个看起来绿的 CI”，而是确保：

> 任何准备合入 `main` 的代码，至少必须通过类型、契约、普通测试、真实 PostgreSQL 数据库集成测试和生产构建五类检查。

第一版完成后，`main` 应启用 branch protection，并把这五项设为 required checks。

## 2. 为什么采用 B+

本阶段采用 **B+**：

```text
Required Gate V1
├─ Typecheck
├─ Contracts
├─ Unit Tests
├─ Database Integration
└─ Build
```

它比纯 B 多了一条真实 PostgreSQL Database Integration。

原因：

- 本项目是多租户 CRM；
- Tenant Isolation / RLS / migration / workflow database schema 都属于数据库安全边界；
- 单纯 TypeScript、unit test 和 build 无法证明 RLS 与真实 PostgreSQL 行为；
- 仓库已经存在独立的 `@crm/database test:integration`，无需重新发明数据库测试体系。

本阶段**不直接采用完整 C**，因为当前 API E2E 尚存在已知历史失败；把已知不稳定套件直接设成 required 会让 CI 长期红灯，削弱门禁可信度。

## 3. 当前仓库事实

当前根脚本已经提供：

```text
pnpm typecheck
pnpm contracts:check
pnpm test
pnpm build
```

数据库包提供：

```text
pnpm --filter @crm/database test:integration
```

数据库 integration helpers 要求：

```text
TEST_DATABASE_ADMIN_URL
TEST_DATABASE_URL
```

测试 helper 会使用 admin URL 执行 `prisma migrate deploy`，然后：

- admin client 使用 migration/admin role；
- runtime client 使用普通 app role；
- integration suite 覆盖真实数据库行为，包括 RLS、Workflow RLS、动态对象、业务模板、时间戳、UUID、Workflow Actions 等。

本地 `compose.yaml` 已有 PostgreSQL 18，并通过 `infrastructure/postgres/init/001-create-app-role.sql` 创建：

```text
crm_app
NOSUPERUSER
NOCREATEDB
NOCREATEROLE
NOBYPASSRLS
```

因此 CI 的 DB Integration 应直接复用这一真实边界。

## 4. CI 触发模型

新增：

```text
.github/workflows/ci.yml
```

触发：

```text
pull_request → main
push → main
```

不在本阶段自动部署。

使用 concurrency：

```text
同一个 PR 新 push 到达时，取消旧 CI run。
```

目的：

- Agent 连续 push 时不浪费 runner；
- 用户看到的检查尽量对应最新 commit；
- 减少旧 run 与新 run 同时运行的无意义成本。

## 5. 运行时版本

CI 与仓库当前声明保持一致：

```text
Node.js 24
pnpm 11.19.0
```

CI 使用：

```text
pnpm install --frozen-lockfile
```

禁止在 CI 中自动改 lockfile。

## 6. 五个 Required Checks

Job display name 必须稳定，因为 branch protection 会按 check name 绑定。

固定名称：

```text
Typecheck
Contracts
Unit Tests
Database Integration
Build
```

不要在后续无迁移计划地随意改名。

### 6.1 Typecheck

运行：

```bash
pnpm --filter @crm/contracts --filter @crm/database build
pnpm typecheck
```

先 build contracts/database，是为了确保 workspace 中通过 `dist` export 被消费的内部 package 在干净 runner 中可用。

### 6.2 Contracts

运行：

```bash
pnpm --filter @crm/contracts --filter @crm/database build
pnpm contracts:check
```

`contracts:check` 必须继续使用仓库已有生成逻辑：

```text
API OpenAPI generate
→ Contracts generate
→ prettier
→ git diff --exit-code
```

CI 不创建一套与本地不同的契约检查。

### 6.3 Unit Tests

运行：

```bash
pnpm --filter @crm/contracts --filter @crm/database build
pnpm test
```

这里的 `Unit Tests` 指根 workspace 普通 test scripts。

它**不等于** API E2E。

### 6.4 Database Integration

CI 启动真实 PostgreSQL：

```bash
docker compose up -d --wait postgres
```

然后：

```bash
pnpm --filter @crm/database build

TEST_DATABASE_ADMIN_URL="postgresql://crm:crm@localhost:5432/crm?schema=public"
TEST_DATABASE_URL="postgresql://crm_app:crm_app@localhost:5432/crm?schema=public"
pnpm --filter @crm/database test:integration
```

这些账号是 ephemeral CI/local test credentials，不是生产 secret。

失败时输出 PostgreSQL logs；无论成功失败都：

```bash
docker compose down -v
```

保证 runner 上测试状态不继续残留。

Database Integration 是本阶段 required check。

### 6.5 Build

运行：

```bash
pnpm build
```

目标是证明一个干净 runner 能完成仓库生产构建。

不要为了让 build 绿而设置与真实构建不同的 `NODE_ENV=development`。

## 7. Workflow Security

Workflow 顶层：

```yaml
permissions:
  contents: read
```

本阶段不需要：

```text
write contents
pull-requests: write
deployments
packages: write
```

CI：

- 不读取生产数据库；
- 不读取生产 API keys；
- 不把仓库 `.env` 复制进 runner；
- 不 echo secrets；
- Database Integration 使用固定 ephemeral test credentials；
- PR 代码不能获得生产凭据。

## 8. Branch Protection

CI workflow 在 PR/main 上实际稳定跑通后，再开启 `main` protection。

要求：

```text
Require a pull request before merging: ON
Required approving reviews: 0
Require status checks before merging: ON
Require branches to be up to date before merging: ON
Required checks:
  - Typecheck
  - Contracts
  - Unit Tests
  - Database Integration
  - Build
Force pushes: OFF
Branch deletion: OFF
```

本阶段不强制 reviewer approval，因为当前项目主要由单一 owner 开发。

如果仓库权限允许，执行者可通过 GitHub API / `gh` 配置；如果权限不允许，执行者必须输出准确的 GitHub UI 设置清单，由 owner 完成后再做最终验收。

Branch protection 必须在 checks 已经真实出现在 GitHub 后启用，不要先保护再猜 check 名称。

## 9. API E2E：明确的下一层 Gate

API E2E **不是被删除**，而是明确作为：

> Engineering Gate Hardening Follow-up

最终目标：

```text
Required Gate V2
├─ Typecheck
├─ Contracts
├─ Unit Tests
├─ Database Integration
├─ Build
└─ Critical API E2E
```

但在提升为 required 之前必须先稳定现有 E2E。

当前已知 Auth E2E 仍按数组断言 `/api/v1/me/sessions`，而当前接口已经是分页响应；这属于历史测试漂移，不应在本 Gate Lite 任务中顺手修改。

未来 Critical API E2E 应优先覆盖：

```text
Auth / Session
Tenant / Workspace isolation
Record CRUD
Workflow Transition
代表性的 Action atomicity
```

重型并发、死锁、浏览器 walkthrough 等可以继续作为：

```text
manual gate / scheduled gate / release gate
```

是否 required 由后续独立 Design 决定。

## 10. Lint

Repo-wide lint 当前存在历史债务。

因此第一版 Gate **不把 repo-wide lint 设为 required**。

规则：

- Engineering Gate Lite 不顺手清 lint debt；
- 新增的 `.github/workflows/ci.yml` 与本 Task 文档必须格式清晰；
- 以后 lint debt 收口后，可以独立 Promote 为 required check。

## 11. 失败诊断

每个 Job 独立，使失败类型一眼可见。

Database Integration 特别要求：

```text
test 失败
→ 输出 postgres logs
→ docker compose down -v
```

Contracts 失败时，GitHub log 应显示 `git diff --exit-code` 产生的 drift。

禁止使用：

```text
continue-on-error: true
```

伪装 required check。

## 12. 不在本阶段内

明确不做：

- 修 Auth E2E；
- 把全部 API E2E 设 required；
- Redis integration；
- Worker business queue test；
- Browser E2E；
- deployment / CD；
- Production secrets；
- repo-wide lint debt cleanup；
- SAST / dependency scanning platform；
- coverage percentage gate；
- release automation。

## 13. 验收

### CI 行为

至少证明：

1. PR 到 main 时 5 个 jobs 都出现；
2. main push 时同样运行；
3. 同 PR 新 push 会 cancel 旧 run；
4. `Typecheck` 在人为 type error 时失败；
5. `Contracts` 在 generated contract drift 时失败；
6. `Unit Tests` 在人为 failing test 时失败；
7. `Database Integration` 真正启动 PostgreSQL 并跑 integration suite；
8. DB job 使用 `crm_app` runtime role，而不是 superuser 代替；
9. `Build` 在真实生产 build 失败时红；
10. required job 不使用 `continue-on-error`。

不要求把破坏性验证提交到最终分支；可以临时修改后观察失败，再还原。

### GitHub Protection

至少证明：

- main 显示 protected；
- 5 个 checks 被设为 required；
- stale branch 必须先更新；
- force push 被禁止；
- deletion 被禁止；
- reviewer approval 数为 0。

## 14. 完成定义

Engineering Gate Lite 完成时：

```text
5 Required Checks
+ main protection
+ CI acceptance record
+ HANDOFF / Lean Roadmap 状态同步
```

并在 Handoff 中明确留下：

```text
Engineering Gate Hardening Follow-up:
Critical API E2E 尚未 Promote。
```

完成 Gate Lite 不自动启动 Sales Workbench Lite。
