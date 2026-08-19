# Initial Architecture Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the example-heavy scaffold with the approved Web route, component, API domain, Worker, contract, and tenant-template architecture, verify it, and merge it into `main`.

**Architecture:** Use Next.js App Router route groups for user-facing areas and NestJS modules for backend domains. Keep pages and controllers as neutral compile-safe shells, retain only the real health endpoint, and preserve Web/API/database process boundaries. Shared contracts and tenant templates are separate workspace packages with no speculative business fields.

**Tech Stack:** pnpm 11, Node.js >=20.9, Next.js 16, React 19, Ant Design 6, NestJS 11, Prisma 7, PostgreSQL 18, BullMQ, Redis, Vitest, Jest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-19-initial-architecture-correction-design.md`

## Global Constraints

- Final source must be visible on `main`; the temporary branch and `.worktrees/codex` are removed only after merged-result verification succeeds.
- Do not implement authentication, authorization, tenant CRUD, dynamic record CRUD, integrations, Bot behavior, or first-company template data.
- Web must not import `@crm/database`, `@prisma/client`, or read `DATABASE_URL`.
- Next.js `app/` is the page/router definition; do not add a Pages Router `pages/` directory or duplicate NestJS business endpoints with Web Route Handlers.
- Only `GET /api/v1/health` returns real API data in this milestone. Other controllers declare prefixes but no methods.
- Preserve `chat会话.md` as an untracked user file.
- Delete only the explicitly identified cache, generated outputs, default assets, and temporary worktree listed in Task 6.

---

## File Map

### Web

- `apps/web/src/app/**`: approved route pages, global error/not-found boundaries, platform/workspace layouts.
- `apps/web/src/components/layout/**`: reusable shell and placeholder layout components.
- `apps/web/src/components/{navigation,data-table,forms,feedback,ui}/README.md`: responsibility boundaries, not fake components.
- `apps/web/src/features/{auth,tenants,members,objects,records}/README.md`: feature ownership boundaries.
- `apps/web/src/lib/{api,auth,env,query}/README.md`: infrastructure boundaries; existing providers move under query.
- `apps/web/src/types/index.ts`: shared Web type export boundary.
- `apps/web/architecture-contract.test.mjs`: route and cleanup contract.

### API

- `apps/api/src/modules/<domain>/<domain>.module.ts`: Nest module boundary.
- `apps/api/src/modules/<domain>/<domain>.controller.ts`: controller prefix with no fake endpoints.
- `apps/api/src/modules/<domain>/<domain>.service.ts`: injectable service boundary with no fake methods.
- `apps/api/src/modules/<domain>/dto/index.ts`: DTO export boundary.
- `apps/api/src/common/**/README.md`, `src/infrastructure/**/README.md`: responsibility boundaries.
- `apps/api/src/config/README.md`: environment/configuration boundary.
- `apps/api/src/architecture.spec.ts`: module registration contract.

### Worker and packages

- `apps/worker/src/config/worker.config.ts`: existing validated Redis config.
- `apps/worker/src/{jobs,queues,processors,infrastructure}/README.md`: explicit Worker boundaries.
- `packages/contracts/**`: cross-application contract package with domain export boundaries.
- `packages/tenant-templates/**`: generic and first-company template package boundaries.

---

### Task 1: Remove Example Scaffold and Add Architecture Contract

**Files:**
- Delete: `apps/web/public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`
- Delete: `apps/web/README.md`, `apps/api/README.md`
- Delete: `apps/web/src/app/page.module.css`, `apps/web/src/app/page.test.tsx`
- Create: `apps/web/architecture-contract.test.mjs`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: command `pnpm --filter @crm/web test:architecture` and a file-system contract consumed by later Web tasks.

- [ ] **Step 1: Write the failing architecture contract**

Create a Node test that resolves paths from `apps/web`, requires these route files, and asserts the default assets and `page.module.css` do not exist:

```js
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const removed = ["public/next.svg", "src/app/page.module.css"];

test("does not contain generated example assets", async () => {
  for (const path of removed) {
    await assert.rejects(access(new URL(path, root)));
  }
});
```

- [ ] **Step 2: Run the contract and prove it fails**

Run `node --test apps/web/architecture-contract.test.mjs` from the repository root. Expected: failure because `public/next.svg` and `page.module.css` still exist.

- [ ] **Step 3: Delete only tracked defaults and expose the contract command**

Use `apply_patch` to delete the listed assets/files. Add `"test:architecture": "node --test architecture-contract.test.mjs"` to `@crm/web`; do not change the existing Vitest command yet.

- [ ] **Step 4: Verify the cleanup contract passes**

Run the architecture contract and expect one passing test. Run `git status --short` and verify only the explicitly listed tracked defaults are deleted, then run `git diff --check` and expect exit 0.

- [ ] **Step 5: Commit**

Commit with `chore(web): remove generated example scaffold`.

### Task 2: Build the Web Route and Component Skeleton

**Files:**
- Create: every Web route and boundary listed in the approved spec Section 3
- Modify: `apps/web/src/app/page.tsx`, `layout.tsx`, `providers.tsx`, `apps/web/package.json`
- Test: `apps/web/architecture-contract.test.mjs`, `apps/web/src/components/layout/page-placeholder.test.tsx`

**Interfaces:**
- Produces: `PagePlaceholder({ title, description })`, `PlatformShell({ children })`, `WorkspaceShell({ tenantCode, children })`.
- Produces routes `/login`, `/register`, `/waiting`, `/workspaces`, `/platform/**`, `/workspace/[tenantCode]/**`.

- [ ] **Step 1: Expand the architecture contract and write the failing component test**

Add every required route/component/feature path from the Task 1 code block in the approved spec to `architecture-contract.test.mjs`, then require `access()` to succeed for each path. The Vitest test renders `PagePlaceholder` and requires an accessible heading plus the supplied description. Run the architecture contract and Vitest; expect missing-route and module-not-found failures.

- [ ] **Step 2: Create the shared page shell**

Implement `PagePlaceholder` with Ant Design `Typography`, `Alert`, and semantic `<main>`. It displays only the route title, purpose description, and neutral text `页面骨架已建立，业务功能尚未实现。`.

Implement `PlatformShell` and `WorkspaceShell` with minimal Ant Design `Layout`, a navigation list, and `{children}`. The workspace shell displays the URL tenant code only as routing context, not as authenticated tenant data.

- [ ] **Step 3: Create exact route shells**

Use the following route/title mapping; every page imports `PagePlaceholder` and contains no fetch, mutation, mock data, or form submission:

| Route | Title |
|---|---|
| `/login` | 登录 |
| `/register` | 创建账号 |
| `/waiting` | 等待加入公司 |
| `/workspaces` | 选择工作空间 |
| `/platform` | 平台总览 |
| `/platform/tenants` | 租户 |
| `/platform/templates` | 模板 |
| `/platform/jobs` | 后台任务 |
| `/platform/audit` | 平台审计 |
| `/platform/settings` | 平台设置 |
| `/workspace/[tenantCode]` | 工作台 |
| `/workspace/[tenantCode]/objects/[objectCode]` | 业务对象 |
| `/workspace/[tenantCode]/statistics` | 统计 |
| `/workspace/[tenantCode]/members` | 成员管理 |
| `/workspace/[tenantCode]/import-export` | 导入导出 |
| `/workspace/[tenantCode]/audit` | 审计 |
| `/workspace/[tenantCode]/settings` | 工作空间设置 |

Root `page.tsx` calls `redirect("/login")`. Add client `error.tsx` with a retry button and `not-found.tsx` with a link to `/login`.

- [ ] **Step 4: Establish non-code responsibility boundaries**

Create concise README files in each approved empty component, feature, and lib directory. Each README states ownership and a prohibition on business logic outside its boundary. Move Query Client provider ownership from `app/providers.tsx` into `lib/query/query-provider.tsx`, leaving `app/providers.tsx` as the composition root.

- [ ] **Step 5: Make both Web test suites green**

Change `@crm/web` test script to `pnpm test:unit && pnpm test:architecture`, define `test:unit` as `vitest run`, then run test, lint, typecheck, and build. Expected: all exit 0 and all approved routes appear in Next build output.

- [ ] **Step 6: Commit**

Commit with `feat(web): add application route architecture`.

### Task 3: Build the NestJS Domain Skeleton

**Files:**
- Move: `apps/api/src/health/**` to `apps/api/src/modules/health/**`
- Create: modules for `auth`, `users`, `tenants`, `invitations`, `memberships`, `objects`, `fields`, `views`, `permissions`, `records`, `dashboards`, `imports`, `integrations`, `audit`
- Create: common/config/infrastructure boundary READMEs
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/architecture.spec.ts`, moved health tests, existing e2e test

**Interfaces:**
- Produces: one `XModule`, `XController`, and `XService` per domain; controller prefix is plural domain name except `auth`.
- Consumes: existing global `/api/v1` prefix and real `HealthController.check()`.

- [ ] **Step 1: Write a failing AppModule architecture test**

Use `Test.createTestingModule({ imports: [AppModule] }).compile()` and assert the module resolves each service class with `moduleRef.get(ServiceClass, { strict: false })`. Run the targeted Jest test and expect missing module imports.

- [ ] **Step 2: Move health without changing behavior**

Move the controller/module/spec under `src/modules/health`, update imports, and run unit plus e2e health tests. Expected response remains `{ status: "ok", service: "api" }` at `/api/v1/health`.

- [ ] **Step 3: Create every domain module boundary**

For each domain, create:

```ts
@Controller("tenants")
export class TenantsController {}

@Injectable()
export class TenantsService {}

@Module({
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
```

Use the corresponding singular/plural class names and prefixes for all listed modules. Create `dto/index.ts` containing a domain-specific documentation comment and `export {};`. Do not add controller methods.

- [ ] **Step 4: Register modules and create architectural boundaries**

Import every domain module in `AppModule`. Create responsibility README files for decorators, filters, guards, interceptors, pipes, config, database infrastructure, and queue infrastructure. Do not create fake implementation classes in these directories.

- [ ] **Step 5: Verify the complete API**

Run targeted architecture/health tests, full Jest, e2e, lint, typecheck, and build. Inspect generated Swagger in a Nest application test or controller metadata and prove domain controllers expose no handler methods.

- [ ] **Step 6: Commit**

Commit with `feat(api): add domain module architecture`.

### Task 4: Reorganize Worker Boundaries

**Files:**
- Move: `apps/worker/src/config.ts` to `src/config/worker.config.ts`
- Move: `apps/worker/src/config.test.ts` to `src/config/worker.config.test.ts`
- Create: `src/config/index.ts`, responsibility READMEs under infrastructure/jobs/processors/queues
- Modify: `src/main.ts`

**Interfaces:**
- Preserves: `loadWorkerConfig(env): { redisUrl: string }` and graceful SIGINT/SIGTERM behavior.
- Produces: stable imports from `./config/index.js`.

- [ ] **Step 1: Move config files and update the test import**

Use `apply_patch` deletes/adds, retain the existing two config assertions verbatim, and export `loadWorkerConfig` plus `WorkerConfig` from `config/index.ts`.

- [ ] **Step 2: Update main and add Worker boundary documentation**

Change `main.ts` to import from `./config/index.js`. Add README files defining jobs as job payload contracts, queues as BullMQ registration, processors as handlers, and infrastructure as external adapters. State that all remain empty until a business workflow is approved.

- [ ] **Step 3: Verify and commit**

Run Worker test, typecheck, and build; expect exit 0. Commit with `refactor(worker): establish queue architecture`.

### Task 5: Add Contracts and Tenant Template Packages

**Files:**
- Create: `packages/contracts/package.json`, `tsconfig.json`, `src/index.ts`, domain `index.ts` files
- Create: `packages/tenant-templates/package.json`, `tsconfig.json`, `src/index.ts`, generic/first-company `index.ts` files
- Create: `packages/architecture-contract.test.mjs`

**Interfaces:**
- Produces workspace packages `@crm/contracts` and `@crm/tenant-templates`.
- Produces only namespace boundaries; no speculative DTO fields or template configuration.

- [ ] **Step 1: Write a failing package architecture test**

The Node test reads both package manifests, asserts their names, and checks the exact generic/first-company and auth/tenants/objects/records entry files. Run it and expect ENOENT.

- [ ] **Step 2: Create compile-safe workspace packages**

Each package extends `../../tsconfig.base.json`, uses NodeNext, and exposes `build`, `typecheck`, and architecture `test` scripts. Domain entry files contain ownership comments and `export {};`; root index files re-export each domain namespace with explicit `export * as AuthContracts from "./auth/index.js"` style exports.

Tenant template exports are `GenericTemplate` and `FirstCompanyTemplate` namespaces only. Do not define template records, fields, permissions, or integration settings.

- [ ] **Step 3: Verify and commit**

Run package contract test, both typechecks/builds, `pnpm list -r --depth -1`, and commit with `chore: add shared package architecture`.

### Task 6: Final Verification, Merge, and Explicit Cleanup

**Files:**
- Modify: root `README.md` architecture tree if needed
- Delete after verification: root `.pnpm-store/`, merged-result `.next/`, API/Worker/database `dist/`
- Remove after verified merge: `.worktrees/codex` and branch `codex/initial-architecture`

**Interfaces:**
- Produces a clean `main` with the approved architecture and no temporary worktree.

- [ ] **Step 1: Update documentation and run branch verification**

Document the final route/module tree. Run frozen install, format check, lint, typecheck, all tests, Web build, API build, Worker build, database validate/generate/build, API e2e, and `docker compose config --quiet`. Search Web for forbidden database imports/environment access and require no matches.

- [ ] **Step 2: Inspect exact merge scope**

Run `git status --short`, `git diff --check`, and `git log main..HEAD --oneline`. Confirm `chat会话.md` is absent from commits and the branch has no uncommitted source changes.

- [ ] **Step 3: Merge into main locally**

From the main repository root, merge `codex/initial-architecture` into `main` without force operations. Do not pull because the user requested a local merge and the existing remote state is unrelated to architecture construction.

- [ ] **Step 4: Verify the merged main result**

Run the same root tests, lint, typecheck, build, Prisma validation, Compose validation, Web boundary search, and API e2e on `main`. Stop without cleanup if any command fails.

- [ ] **Step 5: Remove only approved generated/cache paths**

Resolve and verify these exact paths before deletion:

```text
<repo>/.pnpm-store
<repo>/apps/web/.next
<repo>/apps/api/dist
<repo>/apps/worker/dist
<repo>/packages/database/dist
<repo>/packages/database/src/generated/prisma
```

Delete only paths that exist. Keep root `node_modules` because it is the installed development dependency tree and is already Git-ignored.

- [ ] **Step 6: Remove worktree and temporary branch**

Confirm the worktree status is clean, run `git worktree remove <repo>/.worktrees/codex`, `git worktree prune`, then `git branch -d codex/initial-architecture`. Verify `git worktree list`, `git status --short`, and the final main log.
