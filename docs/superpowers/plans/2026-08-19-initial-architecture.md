# Initial Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable pnpm monorepo containing the Next.js CRM web shell, NestJS API, Prisma/PostgreSQL database package, worker process, and local infrastructure configuration.

**Architecture:** Keep Web, API, and Worker as separate deployable applications in one repository. Only API and Worker may consume the database package; Web calls the REST interface. Keep generated scaffolding minimal and put the first tested behaviors at the API health interface, Web shell, schema contract, and Worker configuration.

**Tech Stack:** pnpm 11, Node.js >= 20.9, strict TypeScript, Next.js 16/React 19, Ant Design 6, TanStack Query, React Hook Form, Zod, NestJS, Prisma 7 with PostgreSQL adapter, BullMQ, Redis, Vitest, Jest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-19-multi-tenant-crm-platform-design.md`

## Global Constraints

- Use a pnpm workspace with `apps/*` and `packages/*`; do not add Turborepo yet.
- Next.js must not import Prisma or receive `DATABASE_URL`.
- API routes use `/api/v1`; OpenAPI is available at `/api/docs` outside production.
- PostgreSQL is the primary database; do not substitute SQLite.
- Use Ant Design as the only full UI component library.
- Do not implement registration, permissions, tenant CRUD, dynamic record CRUD, Feishu, or phone Bot behavior in this milestone.
- Preserve the untracked `chat会话.md` and all existing design documents.

## File Map

```text
package.json                         root commands and package-manager contract
pnpm-workspace.yaml                  workspace package discovery
tsconfig.base.json                   shared strict TypeScript defaults
apps/web/                            Next.js/React application
apps/api/                            NestJS REST application
apps/worker/                         BullMQ worker process
packages/database/                   Prisma schema and client factory
compose.yaml                         local PostgreSQL and Redis
.env.example                         documented local environment variables
README.md                            setup and verification commands
```

### Task 1: Workspace Foundation

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`; modify `README.md`.

**Interfaces:** Produces root commands `dev`, `lint`, `typecheck`, `test`, `build`, `format:check` and workspace globs `apps/*`, `packages/*`.

- [ ] Write an assertion expecting a private root package with `packageManager` beginning `pnpm@11.`.
- [ ] Run `node -e "const p=require('./package.json'); if(!p.private || !p.packageManager.startsWith('pnpm@11.')) process.exit(1)"` and verify it fails because `package.json` is absent.
- [ ] Create the minimal root package, workspace, strict compiler, editor, ignore, and README configuration. Add `.worktrees/` to `.gitignore`.
- [ ] Run the assertion and `pnpm list -r --depth -1`; expect exit 0.
- [ ] Commit with `git commit -m "chore: initialize pnpm workspace"`.

### Task 2: Next.js Web Shell

**Files:** Generate `apps/web/**`; modify `apps/web/package.json`, `src/app/layout.tsx`, `src/app/page.tsx`; create `src/app/providers.tsx`, `src/app/page.test.tsx`, `vitest.config.ts`, `src/test/setup.ts`.

**Interfaces:** Produces package `@crm/web`, root heading `多租户 CRM`, Ant Design registry/provider, and package scripts `dev`, `lint`, `typecheck`, `test`, `build`.

- [ ] Run `pnpm create next-app` with TypeScript, ESLint, App Router, `src/`, pnpm, no Tailwind, and alias `@/*`; remove nested Git metadata if generated and rename the package `@crm/web`.
- [ ] Install `antd`, `@ant-design/icons`, `@ant-design/nextjs-registry`, `@tanstack/react-query`, `react-hook-form`, `zod`, `dayjs`; add Vitest, jsdom, Testing Library and jest-dom as dev dependencies.
- [ ] Write a test that renders `Home` and expects heading `多租户 CRM` and text `平台基础架构已就绪`.
- [ ] Run `pnpm --filter @crm/web test --run`; expect failure because generated copy does not match.
- [ ] Add `AntdRegistry`, `ConfigProvider`, `QueryClientProvider`, and a minimal responsive shell using Ant Design Layout/Typography/Card/Tag. Do not add login or Dashboard behavior.
- [ ] Run Web test, lint, typecheck, and build; expect all exit 0.
- [ ] Commit with `git commit -m "feat(web): scaffold Next.js CRM shell"`.

### Task 3: NestJS API and Health Interface

**Files:** Generate `apps/api/**`; modify `package.json`, `src/main.ts`, `src/app.module.ts`; create `src/health/health.controller.ts`, `health.module.ts`, `health.controller.spec.ts`.

**Interfaces:** Produces package `@crm/api`, `GET /api/v1/health` returning `{ status: 'ok', service: 'api' }`, and OpenAPI at `/api/docs` outside production.

- [ ] Generate NestJS with pnpm, strict TypeScript, no Git initialization, and rename the package `@crm/api`.
- [ ] Install `@nestjs/config`, `@nestjs/swagger`, `class-transformer`, `class-validator`, `helmet`, and `pino-http`.
- [ ] Write `health.controller.spec.ts` that compiles `HealthController` and expects `check()` to return `{ status: 'ok', service: 'api' }`.
- [ ] Run `pnpm --filter @crm/api test -- health.controller.spec.ts`; expect module-not-found failure.
- [ ] Implement Health module plus global prefix, whitelist/transform ValidationPipe, Helmet, environment-driven CORS, and Swagger.
- [ ] Run API targeted/full tests, lint, typecheck, and build; expect all exit 0.
- [ ] Commit with `git commit -m "feat(api): scaffold NestJS health interface"`.

### Task 4: Prisma Database Package

**Files:** Create `packages/database/package.json`, `tsconfig.json`, `prisma.config.ts`, `prisma/schema.prisma`, `src/client.ts`, `src/index.ts`, `schema-contract.test.mjs`.

**Interfaces:** Produces package `@crm/database` and `createDatabaseClient(connectionString: string): PrismaClient`.

- [ ] Create the package manifest/test script and write a Node test that reads `schema.prisma` and expects models User, Tenant, TenantMember, TenantInvitation, VerificationChallenge, Session, ObjectDefinition, FieldDefinition, and Record.
- [ ] Run `node --test packages/database/schema-contract.test.mjs`; expect failure because the package is absent.
- [ ] Create an ESM Prisma 7 package using `prisma.config.ts`, PostgreSQL provider, generated client under `src/generated/prisma`, UUID IDs, tenant keys, JSONB dynamic configuration/data, and constraints from `docs/design/03-数据模型定义.md`.
- [ ] Implement `createDatabaseClient` with `PrismaPg` and an explicit connection string; never read the URL implicitly inside the factory.
- [ ] Run the contract test, Prisma format/validate/generate, typecheck, and build; expect all exit 0.
- [ ] Commit with `git commit -m "feat(database): add Prisma multi-tenant schema"`.

### Task 5: Worker and Local Infrastructure

**Files:** Create `apps/worker/package.json`, `tsconfig.json`, `src/config.ts`, `src/main.ts`, `src/config.test.ts`, `compose.yaml`, `.env.example`.

**Interfaces:** Produces package `@crm/worker`, `loadWorkerConfig(env)` and local PostgreSQL 18/Redis services.

- [ ] Create the package manifest, test configuration, and a Vitest test expecting missing `REDIS_URL` to throw and a valid URL to produce `{ redisUrl }`.
- [ ] Run `pnpm --filter @crm/worker test --run`; expect failure because config code is absent.
- [ ] Implement the minimal BullMQ-ready Worker package without registering a business queue; handle SIGTERM/SIGINT cleanly.
- [ ] Add PostgreSQL 18 and Redis services with named volumes, explicit ports and health checks. Document `DATABASE_URL`, `REDIS_URL`, `PORT`, `WEB_ORIGIN`, and `NODE_ENV`; never commit `.env`.
- [ ] Run Worker tests/typecheck/build and `docker compose config`; expect exit 0. If Docker is unavailable, report that limitation without claiming runtime verification.
- [ ] Commit with `git commit -m "chore: add worker and local infrastructure"`.

### Task 6: Repository Quality Gate

**Files:** Modify `README.md`, root/package scripts only where required by verified commands.

**Interfaces:** Produces documented setup and a single root quality gate.

- [ ] Document bundled runtime fallback, install, Compose startup, Prisma generation, dev URLs, and verification commands.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, database validation, and `git diff --check`.
- [ ] Search `apps/web` and prove it contains no import of `@crm/database`, `@prisma/client`, or `DATABASE_URL`.
- [ ] Commit with `git commit -m "docs: add local development workflow"`.
- [ ] Run the complete quality gate and inspect `git status --short` and recent commits before handoff.
