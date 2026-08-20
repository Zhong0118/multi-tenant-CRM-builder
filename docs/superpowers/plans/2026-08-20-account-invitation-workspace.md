# Account, Invitation, and Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-shaped vertical slice in which a user registers with a verified phone number, signs in, accepts a tenant invitation, enters an authorized workspace, and can be managed by tenant and platform administrators.

**Architecture:** Keep the existing modular monolith: Next.js calls only the NestJS REST API, NestJS owns use cases and authorization, and PostgreSQL owns durable identity, membership, audit, and row isolation. Workspace API paths carry `tenantCode` only as a locator; guards resolve it into a verified `TenantContext` before repositories run inside transactions that set `app.user_id` and `app.tenant_id`.

**Tech Stack:** TypeScript, pnpm workspaces, Next.js 16, React 19, Ant Design 6, TanStack Query, React Hook Form, Zod, NestJS 11, Prisma 7, PostgreSQL 18, Redis 7.4, Jest, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-account-invitation-workspace-design.md`

## Global Constraints

- Web never imports `@crm/database`, `@prisma/client`, or a server database connection string.
- Phone numbers are accepted only as Chinese mainland mobile numbers and stored as `+86` E.164 strings.
- Registration and password reset use a verification code; normal login uses phone and password; email is not an authentication identifier.
- Password hashes use Argon2id; session and verification tokens are stored only as SHA-256 hashes.
- Browser authentication uses an HttpOnly, SameSite=Lax cookie; unsafe requests must pass the exact configured Origin check.
- `tenantCode` never grants access. `TenantContext` is created only after checking User, TenantMember, and Tenant state.
- Tenant tables use PostgreSQL RLS, and the runtime application role has neither table ownership nor `BYPASSRLS`.
- Controllers perform protocol translation only; policies and application services own decisions; repositories own persistence.
- OpenAPI is the contract source; generated contract files are committed and checked for drift.
- No unimplemented CRM page may display fabricated business data.
- Every task follows red-green-refactor and ends with a focused commit.
- Preserve the untracked root `chat会话.md`; never stage or commit it.

---

## Planned File Structure

```text
apps/api/src/
├── bootstrap.ts                         Nest application factory shared by main, E2E, and OpenAPI generation
├── common/
│   ├── auth/                            current-user decorator and session guard
│   ├── errors/                          stable error codes, exception, and response filter
│   ├── security/                        exact-origin guard and request-id middleware
│   └── tenancy/                         TenantContext decorator and workspace guard
├── infrastructure/
│   ├── database/                        Prisma lifecycle and user/tenant transaction runners
│   ├── rate-limit/                      Redis counter behind a small interface
│   └── verification/                    VerificationSender interface and configured adapters
├── modules/
│   ├── auth/                            verification, registration, login, sessions, password reset
│   ├── tenants/                         platform tenant creation and activation
│   ├── invitations/                     personal invitation queries and accept/decline
│   ├── memberships/                     workspaces, members, invite/resend/revoke/disable
│   └── audit/                           append-only audit writer
└── scripts/                             OpenAPI generation and platform-admin grant command

apps/web/src/
├── app/(auth)/                          register, login, forgot-password
├── app/(account)/                       waiting, invitations, workspaces, account security
├── app/(platform)/                      minimal tenant create/detail flow
├── app/(workspace)/                     authenticated home and member management
├── features/
│   ├── auth/                            forms, schemas, post-login route decision
│   ├── invitations/                     cards, detail, accept/decline mutations
│   ├── workspaces/                       workspace chooser
│   ├── tenants/                          platform provisioning forms
│   └── members/                          list and invitation form
└── lib/api/                              generated-contract browser/server clients and error mapping

packages/database/
├── prisma/migrations/                   reviewed schema, RLS, indexes, grants
├── src/context.ts                       transaction-local identity and tenant context
└── test/integration/                    real PostgreSQL isolation and concurrency tests

packages/contracts/
├── openapi.json                         generated API document
└── src/generated/openapi.ts             generated TypeScript paths
```

## Spec Coverage Map

| Spec requirement | Implemented and verified by |
|---|---|
| Runtime role, migrations, RLS, pending-invite uniqueness | Tasks 1–2 |
| Stable errors, request IDs, exact-Origin CSRF protection | Task 3 |
| Verification codes, registration, login, password reset, sessions | Task 4 |
| Audit, platform-admin bootstrap, tenant creation and activation | Task 5 |
| Personal invitations, workspaces, TenantContext, member management | Task 6 |
| OpenAPI as source and generated shared types | Task 7 |
| Typed Web access and safe post-login routing | Task 8 |
| Account and account-security pages | Task 9 |
| Waiting, invitations, workspace selection and verified shell | Task 10 |
| Platform tenant and tenant member administration pages | Task 11 |
| Cross-role browser flow, cross-tenant regression, final status | Task 12 |

## API Contract Checklist

The implementation and generated OpenAPI document must contain every path below exactly:

```text
/api/v1/auth/verification-challenges
/api/v1/auth/register
/api/v1/auth/login
/api/v1/auth/logout
/api/v1/auth/forgot-password
/api/v1/auth/reset-password
/api/v1/me
/api/v1/me/sessions
/api/v1/me/sessions/:sessionId
/api/v1/me/password
/api/v1/me/invitations
/api/v1/me/invitations/:invitationId
/api/v1/me/invitations/:invitationId/accept
/api/v1/me/invitations/:invitationId/decline
/api/v1/me/workspaces
/api/v1/workspaces/:tenantCode
/api/v1/workspaces/:tenantCode/members
/api/v1/workspaces/:tenantCode/invitations
/api/v1/workspaces/:tenantCode/invitations/:id/resend
/api/v1/workspaces/:tenantCode/invitations/:id/revoke
/api/v1/workspaces/:tenantCode/members/:memberId
/api/v1/platform/tenants
/api/v1/platform/tenants/:tenantId
/api/v1/platform/tenants/:tenantId/status
```

---

### Task 1: Make Local PostgreSQL Safe for Migrations and Runtime RLS

**Files:**
- Create: `infrastructure/postgres/init/001-create-app-role.sql`
- Create: `compose.test.yaml`
- Modify: `compose.yaml`
- Modify: `.env.example`
- Modify: `packages/database/prisma.config.ts`
- Modify: `packages/database/package.json`
- Test: `packages/database/schema-contract.test.mjs`

**Interfaces:**
- Consumes: Docker Compose and the existing Prisma package.
- Produces: `DATABASE_ADMIN_URL` for migrations, `DATABASE_URL` for runtime, and `TEST_DATABASE_ADMIN_URL` / `TEST_DATABASE_URL` for isolated PostgreSQL tests.

- [ ] **Step 1: Extend the schema contract test with role separation assertions**

```js
test("separates migration and runtime database credentials", async () => {
  const env = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
  const prismaConfig = await readFile(
    new URL("./prisma.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(env, /^DATABASE_ADMIN_URL=/m);
  assert.match(env, /^DATABASE_URL=/m);
  assert.match(prismaConfig, /DATABASE_ADMIN_URL/);
});
```

- [ ] **Step 2: Run the contract test and verify the missing admin URL fails**

Run: `pnpm --filter @crm/database test`

Expected: FAIL because `.env.example` and `prisma.config.ts` expose only `DATABASE_URL`.

- [ ] **Step 3: Add owner/runtime roles and a separate test database service**

`001-create-app-role.sql` must create `crm_app` without `SUPERUSER`, `CREATEDB`, `CREATEROLE`, or `BYPASSRLS`, and grant only database connection plus schema usage. `compose.yaml` mounts the script into `/docker-entrypoint-initdb.d/`; `compose.test.yaml` defines `postgres-test` on host port `5433` with database `crm_test` and its own named volume.

Use an idempotent role block so the script works on fresh and existing development volumes:

```sql
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN PASSWORD 'crm_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$body$;
SELECT format('GRANT CONNECT ON DATABASE %I TO crm_app', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO crm_app;
```

Use these local URLs:

```dotenv
DATABASE_ADMIN_URL=postgresql://crm:crm@localhost:5432/crm
DATABASE_URL=postgresql://crm_app:crm_app@localhost:5432/crm
TEST_DATABASE_ADMIN_URL=postgresql://crm:crm@localhost:5433/crm_test
TEST_DATABASE_URL=postgresql://crm_app:crm_app@localhost:5433/crm_test
```

Keep the existing `crm` Compose user as the migration owner so existing local volumes remain compatible. Change Prisma migration configuration to `url: env("DATABASE_ADMIN_URL")`. Keep application startup on `DATABASE_URL`.

- [ ] **Step 4: Add explicit database lifecycle scripts**

```json
{
  "prisma:migrate:dev": "prisma migrate dev",
  "prisma:migrate:deploy": "prisma migrate deploy",
  "test:integration": "node --test test/integration/*.test.mjs"
}
```

- [ ] **Step 5: Verify configuration**

Run:

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U crm -d crm -f /docker-entrypoint-initdb.d/001-create-app-role.sql
pnpm --filter @crm/database test
docker compose config --quiet
docker compose -f compose.test.yaml config --quiet
```

Expected: all three commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add .env.example compose.yaml compose.test.yaml infrastructure/postgres/init/001-create-app-role.sql packages/database/package.json packages/database/prisma.config.ts packages/database/schema-contract.test.mjs
git commit -m "chore(database): separate migration and runtime roles"
```

---

### Task 2: Add the Audited Identity Schema, Migration, and RLS Policies

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0001_account_workspace/migration.sql`
- Create: `packages/database/test/integration/rls.test.mjs`
- Create: `packages/database/test/integration/helpers.mjs`
- Modify: `packages/database/schema-contract.test.mjs`
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Consumes: Task 1 admin/runtime database URLs.
- Produces: generated `PrismaClient`, `Prisma.TransactionClient`, `AuditActorType`, seven first-slice models, reviewed indexes, grants, and RLS policies.

- [ ] **Step 1: Write failing schema assertions for audit and RLS SQL**

```js
test("defines append-only audit and tenant RLS", async () => {
  assert.match(schema, /model AuditLog \{/);
  assert.match(schema, /enum AuditActorType \{/);
  const migration = await readFile(
    new URL("./prisma/migrations/0001_account_workspace/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE UNIQUE INDEX.*tenant_invitations.*PENDING/is);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\('app\.tenant_id'/);
});
```

- [ ] **Step 2: Run the test and verify it fails on the missing model/migration**

Run: `pnpm --filter @crm/database test`

Expected: FAIL with missing `AuditLog` and migration file.

- [ ] **Step 3: Add the model and migration**

Add this Prisma surface:

```prisma
enum AuditActorType {
  USER
  INTEGRATION
  SYSTEM
}

model AuditLog {
  id           String         @id @default(uuid(7)) @db.Uuid
  tenantId     String?        @map("tenant_id") @db.Uuid
  actorType    AuditActorType @map("actor_type")
  actorId      String?        @map("actor_id") @db.Uuid
  action       String         @db.VarChar(100)
  resourceType String         @map("resource_type") @db.VarChar(100)
  resourceId   String?        @map("resource_id") @db.Uuid
  before       Json?          @db.JsonB
  after        Json?          @db.JsonB
  reason       String?
  requestId    String         @map("request_id") @db.VarChar(100)
  ip           String?        @db.Inet
  createdAt    DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([tenantId, createdAt(sort: Desc)])
  @@index([resourceType, resourceId])
  @@map("audit_logs")
}
```

Generate the Prisma table DDL instead of copying it by hand:

```bash
DATABASE_ADMIN_URL=postgresql://crm:crm@localhost:5432/crm pnpm --filter @crm/database exec prisma migrate dev --create-only --name account_workspace
```

Then append reviewed SQL with these policy shapes, expanding the tenant policy across every tenant table listed below:

```sql
CREATE UNIQUE INDEX tenant_invitations_one_pending_phone
ON tenant_invitations (tenant_id, target_phone)
WHERE status = 'PENDING';

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_members_self_select ON tenant_members
FOR SELECT TO crm_app
USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY tenant_members_tenant_access ON tenant_members
TO crm_app
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_tenant_insert ON audit_logs
FOR INSERT TO crm_app
WITH CHECK (
  tenant_id IS NULL OR
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);
```

The reviewed SQL migration must also:

- create all models currently present in the Prisma schema;
- create a partial unique index on normalized pending invitations;
- enable and force RLS on `tenants`, `tenant_members`, `tenant_invitations`, `object_definitions`, `field_definitions`, `records`, and `audit_logs`;
- grant the runtime role only required sequence/table privileges;
- provide own-membership and own-invitation policies based on `app.user_id`;
- require `app.tenant_id` for tenant business mutations;
- omit UPDATE and DELETE policies for `audit_logs`.

- [ ] **Step 4: Add real PostgreSQL isolation tests**

`helpers.mjs` must run migrations with `TEST_DATABASE_ADMIN_URL`, create an admin client and runtime client, and expose `withSettings(client, { userId, tenantId }, callback)` using one transaction with `set_config(..., true)`.

`rls.test.mjs` must create two tenants, two users, and two memberships as owner, then prove:

```js
await assert.rejects(() => runtime.tenantMember.findMany());
assert.deepEqual(
  await withSettings(runtime, { userId: userA.id }, (tx) =>
    tx.tenantMember.findMany({ select: { tenantId: true } }),
  ),
  [{ tenantId: tenantA.id }],
);
```

Also assert user A cannot read tenant B invitations, cannot mutate tenant B members, and cannot update or delete an audit row.

- [ ] **Step 5: Run schema and PostgreSQL tests**

Run:

```bash
docker compose -f compose.test.yaml up -d postgres-test
pnpm --filter @crm/database prisma:generate
pnpm --filter @crm/database test
pnpm --filter @crm/database test:integration
```

Expected: schema tests and all RLS cases pass.

- [ ] **Step 6: Commit**

```bash
git add packages/database
git commit -m "feat(database): add audited tenant isolation schema"
```

---

### Task 3: Add API Database Context, Stable Errors, and Request Security

**Files:**
- Create: `apps/api/src/bootstrap.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/src/infrastructure/database/database.module.ts`
- Create: `apps/api/src/infrastructure/database/database.service.ts`
- Create: `apps/api/src/infrastructure/database/context-runner.ts`
- Create: `apps/api/src/common/errors/api-error-code.ts`
- Create: `apps/api/src/common/errors/api.exception.ts`
- Create: `apps/api/src/common/errors/api-exception.filter.ts`
- Create: `apps/api/src/common/security/request-id.middleware.ts`
- Create: `apps/api/src/common/security/origin.guard.ts`
- Create: `apps/api/src/common/tenancy/tenant-context.ts`
- Modify: `apps/api/src/architecture.spec.ts`
- Test: `apps/api/src/common/errors/api-exception.filter.spec.ts`
- Test: `apps/api/src/infrastructure/database/context-runner.spec.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `@crm/database` and Task 2 generated Prisma types.
- Produces: `DatabaseService`, `DatabaseContextRunner.withUser`, `DatabaseContextRunner.withTenant`, `ApiException`, `ApiErrorCode`, `OriginGuard`, and `createApp()`.

- [ ] **Step 1: Add dependencies and write failing interface tests**

Add workspace dependencies and cookie parsing:

```bash
pnpm --filter @crm/api add @crm/database@workspace:* cookie-parser
pnpm --filter @crm/api add -D @types/cookie-parser
```

Test the exact error body:

```ts
expect(filter.toBody(new ApiException("AUTH_REQUIRED", 401))).toEqual({
  code: "AUTH_REQUIRED",
  message: "请先登录。",
  fieldErrors: {},
  requestId: "req_test",
  status: 401,
});
```

Test that `withTenant` executes these statements before the callback in the same mocked transaction:

```sql
select set_config('app.user_id', $1, true)
select set_config('app.tenant_id', $1, true)
```

- [ ] **Step 2: Run focused tests and verify missing modules fail**

Run: `pnpm --filter @crm/api test -- api-exception.filter.spec.ts context-runner.spec.ts`

Expected: FAIL because the shared infrastructure does not exist.

- [ ] **Step 3: Implement the small shared interfaces**

Use these public types:

```ts
export interface AuthenticatedUser {
  id: string;
  phone: string;
  isPlatformAdmin: boolean;
}

export interface TenantContext {
  userId: string;
  tenantId: string;
  tenantCode: string;
  memberId: string;
  role: "TENANT_ADMIN" | "EMPLOYEE";
}

export class DatabaseContextRunner {
  withUser<T>(userId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  withTenant<T>(context: TenantContext, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}
```

`OriginGuard` permits GET/HEAD/OPTIONS and otherwise requires `Origin` to equal one configured `WEB_ORIGIN`; missing or mismatched origins return `CSRF_REJECTED` with 403. `RequestIdMiddleware` accepts a valid short incoming request ID or creates a UUID and exposes it on request and `X-Request-Id` response header.

Replace the scaffold-era architecture assertion that every controller has only a constructor. Keep approved module registration coverage and assert the application can install the shared database, request-ID, Origin, and error-response infrastructure; route handlers are now expected.

- [ ] **Step 4: Refactor application creation**

Move current Nest setup into:

```ts
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  // prefix, cookies, helmet, request id, validation, CORS, filter, OpenAPI
  await app.init();
  return app;
}
```

`main.ts` calls `createApp()` and then `listen`. Configure `cookieParser`, exact credentialed CORS, global validation with `forbidNonWhitelisted: true`, the exception filter, and the origin guard.

- [ ] **Step 5: Verify API foundations**

Run:

```bash
pnpm --filter @crm/api test
pnpm --filter @crm/api lint
pnpm --filter @crm/api typecheck
pnpm --filter @crm/api build
```

Expected: all commands exit 0 and health E2E remains green.

- [ ] **Step 6: Commit**

```bash
git add apps/api apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add secure request and database context"
```

---

### Task 4: Implement Phone Verification, Registration, Login, and Sessions

**Files:**
- Modify: `apps/api/src/modules/auth/auth.module.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Replace: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.repository.ts`
- Create: `apps/api/src/modules/auth/phone-number.ts`
- Create: `apps/api/src/modules/auth/password-hasher.ts`
- Create: `apps/api/src/modules/auth/session.service.ts`
- Create: `apps/api/src/modules/auth/dto/auth.dto.ts`
- Create: `apps/api/src/common/auth/current-user.decorator.ts`
- Create: `apps/api/src/common/auth/session-auth.guard.ts`
- Create: `apps/api/src/infrastructure/verification/verification-sender.ts`
- Create: `apps/api/src/infrastructure/verification/fixed-code-verification.sender.ts`
- Create: `apps/api/src/infrastructure/rate-limit/rate-limiter.ts`
- Create: `apps/api/src/infrastructure/rate-limit/redis-rate-limiter.ts`
- Test: `apps/api/src/modules/auth/phone-number.spec.ts`
- Test: `apps/api/src/modules/auth/auth.service.spec.ts`
- Test: `apps/api/test/auth.e2e-spec.ts`
- Modify: `apps/api/package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `DatabaseService`, stable errors, request IDs, cookies.
- Produces: `/auth/verification-challenges`, `/register`, `/login`, `/logout`, `/forgot-password`, `/reset-password`, `/me`, `/me/password`, and session endpoints.

- [ ] **Step 1: Add cryptography/Redis dependencies and failing policy tests**

```bash
pnpm --filter @crm/api add argon2 ioredis
```

Phone test cases must be exact:

```ts
expect(normalizeChineseMobile("13800138000")).toBe("+8613800138000");
expect(normalizeChineseMobile("+86 138 0013 8000")).toBe("+8613800138000");
expect(() => normalizeChineseMobile("01012345678")).toThrow("INVALID_PHONE");
```

Auth service tests use in-memory repository/sender/rate-limiter adapters and assert: codes expire, five wrong attempts lock a challenge, a consumed code cannot be reused, duplicate registration returns a neutral result, login returns the same public error for missing user and bad password, and reset revokes all sessions.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @crm/api test -- phone-number.spec.ts auth.service.spec.ts`

Expected: FAIL on missing functions and Auth implementation.

- [ ] **Step 3: Implement deep authentication modules**

Use these interfaces:

```ts
export interface VerificationSender {
  send(input: { phone: string; code: string; purpose: "REGISTER" | "RESET_PASSWORD" }): Promise<void>;
}

export interface RateLimiter {
  consume(input: { key: string; limit: number; windowSeconds: number }): Promise<void>;
}

export interface SessionPrincipal {
  sessionId: string;
  user: AuthenticatedUser;
}
```

Generate six-digit codes with `randomInt`, session tokens with `randomBytes(32)`, and store SHA-256 hashes. Use Argon2id for passwords. Set cookie `crm_session` with `httpOnly: true`, `sameSite: "lax"`, `secure` only outside local HTTP, and an explicit expiry.

The fixed-code sender is enabled only when `NODE_ENV` is `development` or `test` and `DEV_VERIFICATION_CODE` is a six-digit value. Production configuration without a production sender must fail during startup.

- [ ] **Step 4: Implement controllers and guards**

DTOs use class-validator and Swagger decorators. `SessionAuthGuard` reads only `crm_session`, hashes it, rejects expired/revoked sessions or disabled users, updates `lastUsedAt` at a throttled interval, and assigns `request.auth`.

Use controller routes exactly as specified and never return password, token hash, code hash, or full session token in JSON. `PATCH /me/password` requires the current password, preserves the current session, and revokes every other session.

- [ ] **Step 5: Add API E2E cases**

`auth.e2e-spec.ts` must run against an isolated PostgreSQL database and cover:

```text
request code → register → GET /me → logout → old cookie rejected
login with password → list sessions → revoke one session
reset password → every old session rejected → new password works
```

- [ ] **Step 6: Verify authentication**

Run:

```bash
pnpm --filter @crm/api test -- phone-number.spec.ts auth.service.spec.ts
pnpm --filter @crm/api test:e2e -- auth.e2e-spec.ts
pnpm --filter @crm/api typecheck
```

Expected: all auth unit and E2E cases pass.

- [ ] **Step 7: Commit**

```bash
git add .env.example apps/api pnpm-lock.yaml
git commit -m "feat(auth): add verified phone accounts and sessions"
```

---

### Task 5: Implement Audit Writing and Platform Tenant Provisioning

**Files:**
- Replace: `apps/api/src/modules/audit/audit.service.ts`
- Create: `apps/api/src/modules/audit/audit.repository.ts`
- Create: `apps/api/src/modules/audit/audit-event.ts`
- Modify: `apps/api/src/modules/audit/audit.module.ts`
- Modify: `apps/api/src/modules/tenants/tenants.controller.ts`
- Replace: `apps/api/src/modules/tenants/tenants.service.ts`
- Create: `apps/api/src/modules/tenants/tenants.repository.ts`
- Create: `apps/api/src/modules/tenants/dto/platform-tenant.dto.ts`
- Create: `apps/api/src/common/auth/platform-admin.guard.ts`
- Create: `apps/api/src/scripts/grant-platform-admin.ts`
- Test: `apps/api/src/modules/tenants/tenants.service.spec.ts`
- Test: `apps/api/test/platform-tenants.e2e-spec.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: authenticated User, database transactions, normalized phones, AuditService.
- Produces: platform-admin grant command and platform tenant create/detail/status endpoints.

- [ ] **Step 1: Write failing tenant state tests**

```ts
it("creates a draft tenant and first-admin invitation atomically", async () => {
  const result = await service.createTenant(platformAdmin, {
    name: "示例公司",
    code: "sample-company",
    firstAdminPhone: "13800138000",
  });
  expect(result).toMatchObject({ status: "DRAFT", code: "sample-company" });
  expect(repo.pendingInvitationRole).toBe("TENANT_ADMIN");
});

it("refuses activation before an active tenant admin exists", async () => {
  await expect(service.changeStatus(admin, tenantId, "ACTIVE"))
    .rejects.toMatchObject({ code: "TENANT_ADMIN_REQUIRED" });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @crm/api test -- tenants.service.spec.ts`

Expected: FAIL because the placeholder service has no use cases.

- [ ] **Step 3: Implement append-only audit and platform guard**

```ts
export interface AuditEvent {
  tenantId?: string;
  actorType: "USER" | "SYSTEM";
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  requestId: string;
  ip?: string;
}
```

`AuditService.append(tx, event)` participates in the caller's transaction. `PlatformAdminGuard` requires a valid session and `isPlatformAdmin === true`.

- [ ] **Step 4: Implement tenant creation and status rules**

Create tenant and first invitation in one transaction. Code must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Activation requires one ACTIVE `TENANT_ADMIN`; suspension prevents workspace entry. Every state change writes an audit row.

The CLI command accepts `--phone +8613800138000 --reason "initial bootstrap"`, requires a verified active User, is idempotent, and writes `platform.admin.granted` only when the permission changes.

- [ ] **Step 5: Add platform E2E tests**

Cover non-admin 403, tenant list, tenant create, duplicate code 409, first-admin invitation creation, activation-before-acceptance 409, and activation-after-acceptance 200.

For the activation-success case in this task, insert the accepted active TenantMember through the E2E database fixture. The public invitation acceptance endpoint belongs to Task 6 and must not be pulled forward.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @crm/api test -- tenants.service.spec.ts
pnpm --filter @crm/api test:e2e -- platform-tenants.e2e-spec.ts
pnpm --filter @crm/api typecheck
```

Then:

```bash
git add apps/api
git commit -m "feat(platform): provision tenants and first administrators"
```

---

### Task 6: Implement Personal Invitations, Workspaces, and Tenant Member Management

**Files:**
- Modify: `apps/api/src/modules/invitations/invitations.controller.ts`
- Replace: `apps/api/src/modules/invitations/invitations.service.ts`
- Create: `apps/api/src/modules/invitations/invitations.repository.ts`
- Create: `apps/api/src/modules/invitations/invitation.policy.ts`
- Create: `apps/api/src/modules/invitations/dto/invitation.dto.ts`
- Modify: `apps/api/src/modules/memberships/memberships.controller.ts`
- Replace: `apps/api/src/modules/memberships/memberships.service.ts`
- Create: `apps/api/src/modules/memberships/memberships.repository.ts`
- Create: `apps/api/src/modules/memberships/dto/membership.dto.ts`
- Create: `apps/api/src/common/tenancy/workspace.guard.ts`
- Create: `apps/api/src/common/tenancy/tenant-context.decorator.ts`
- Test: `apps/api/src/modules/invitations/invitation.policy.spec.ts`
- Test: `apps/api/src/modules/invitations/invitations.service.spec.ts`
- Test: `apps/api/src/modules/memberships/memberships.service.spec.ts`
- Test: `apps/api/test/onboarding.e2e-spec.ts`

**Interfaces:**
- Consumes: session principal, user/tenant transaction runners, audit writer.
- Produces: personal invitation API, workspace list, verified `TenantContext`, tenant-admin invitation/member API.

- [ ] **Step 1: Write failing invitation and workspace tests**

Policy cases:

```ts
expect(canAccept({ status: "PENDING", targetPhone: user.phone, expiresAt: future }, user)).toBe(true);
expect(() => assertCanAccept(expiredInvite, user)).toThrow("INVITATION_EXPIRED");
expect(() => assertCanAccept(otherPhoneInvite, user)).toThrow("INVITATION_PHONE_MISMATCH");
```

Service tests assert repeated acceptance returns the existing membership, decline never creates a member, employees cannot invite, a tenant admin cannot disable the last active tenant admin, and disabled members do not appear as enterable workspaces.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @crm/api test -- invitation.policy.spec.ts invitations.service.spec.ts memberships.service.spec.ts`

Expected: FAIL because policies and use cases do not exist.

- [ ] **Step 3: Implement personal invitation transactions**

`GET /me/invitations` and detail run under `withUser`. Acceptance uses a serializable transaction or row lock, rechecks phone/status/expiry, upserts the unique membership, marks the invitation accepted, and appends audit. Map not-found and non-owned invitations to the same `INVITATION_NOT_FOUND` response.

- [ ] **Step 4: Implement workspace guard and admin operations**

`GET /workspaces/:tenantCode` returns the verified tenant/member summary used by the Web shell. `WorkspaceGuard` resolves `tenantCode`, rejects inactive User/Member/Tenant, and attaches:

```ts
{
  userId,
  tenantId,
  tenantCode,
  memberId,
  role,
} satisfies TenantContext
```

Member management requires `TENANT_ADMIN`. `GET /workspaces/:tenantCode/invitations` returns only that tenant's invitations with stable pagination. Resend rotates the invitation code hash and expiry. Revoke changes only PENDING invitations. Disabling a member never deletes historical identity and cannot remove the last active admin.

- [ ] **Step 5: Prove concurrency and cross-tenant behavior in E2E**

`onboarding.e2e-spec.ts` must issue two concurrent accept requests and assert one membership; create tenant A and B, then assert user A gets 404/403 for tenant B members after changing only `tenantCode`; disable user A's membership and assert the old cookie receives `MEMBERSHIP_INACTIVE`.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @crm/api test
pnpm --filter @crm/api test:e2e
pnpm --filter @crm/api lint
pnpm --filter @crm/api typecheck
```

Then:

```bash
git add apps/api
git commit -m "feat(onboarding): add invitations and workspace membership"
```

---

### Task 7: Generate and Enforce the OpenAPI Contract

**Files:**
- Create: `apps/api/src/scripts/generate-openapi.ts`
- Modify: `apps/api/package.json`
- Modify: `packages/contracts/package.json`
- Create: `packages/contracts/scripts/generate.mjs`
- Create: `packages/contracts/openapi.json`
- Create: `packages/contracts/src/generated/openapi.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/contract-drift.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `createApp()` and Swagger DTO metadata.
- Produces: generated `paths`, `components`, and root `pnpm contracts:check`.

- [ ] **Step 1: Write a failing generated-contract assertion**

```js
test("contains first-slice routes", async () => {
  const document = JSON.parse(await readFile(new URL("./openapi.json", import.meta.url)));
  assert.ok(document.paths["/api/v1/auth/register"]);
  assert.ok(document.paths["/api/v1/me/invitations/{invitationId}"]);
  assert.ok(document.paths["/api/v1/workspaces/{tenantCode}/members"]);
});
```

- [ ] **Step 2: Run and verify missing artifacts fail**

Run: `pnpm --filter @crm/contracts test`

Expected: FAIL because `openapi.json` and generated path types do not exist.

- [ ] **Step 3: Add deterministic generation**

Add `openapi-typescript` to `@crm/contracts`. The API script creates the Nest app without listening, writes a stable sorted OpenAPI JSON document, and closes the app. The contracts script runs `openapi-typescript openapi.json -o src/generated/openapi.ts`.

Export only generated type namespaces from `packages/contracts/src/index.ts`; do not duplicate DTO interfaces manually.

- [ ] **Step 4: Add drift checking**

The root scripts must include:

```json
{
  "contracts:generate": "pnpm --filter @crm/api openapi:generate && pnpm --filter @crm/contracts generate",
  "contracts:check": "pnpm contracts:generate && git diff --exit-code -- packages/contracts/openapi.json packages/contracts/src/generated/openapi.ts"
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm contracts:generate
pnpm --filter @crm/contracts test
pnpm --filter @crm/contracts typecheck
pnpm contracts:check
```

Then:

```bash
git add package.json apps/api packages/contracts pnpm-lock.yaml
git commit -m "feat(contracts): generate client types from OpenAPI"
```

---

### Task 8: Build the Typed Web API and Authentication Routing Modules

**Files:**
- Modify: `apps/web/package.json`
- Modify: `.env.example`
- Create: `apps/web/src/lib/api/browser-client.ts`
- Create: `apps/web/src/lib/api/server-client.ts`
- Create: `apps/web/src/lib/api/api-error.ts`
- Create: `apps/web/src/lib/auth/post-login-route.ts`
- Create: `apps/web/src/lib/auth/require-user.ts`
- Create: `apps/web/src/features/auth/schemas.ts`
- Test: `apps/web/src/lib/auth/post-login-route.test.ts`
- Test: `apps/web/src/lib/api/api-error.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `@crm/contracts` generated `paths`.
- Produces: credentialed browser/server clients, `toApiError`, `resolvePostLoginRoute`, and `requireUser`.

- [ ] **Step 1: Add typed client dependencies and failing routing tests**

```bash
pnpm --filter @crm/web add @crm/contracts@workspace:* openapi-fetch @hookform/resolvers
```

```ts
expect(resolvePostLoginRoute({ workspaces: [], returnTo: null })).toBe("/waiting");
expect(resolvePostLoginRoute({ workspaces: [{ tenantCode: "a" }], returnTo: null }))
  .toBe("/workspace/a");
expect(resolvePostLoginRoute({ workspaces: [{ tenantCode: "a" }, { tenantCode: "b" }], returnTo: null }))
  .toBe("/workspaces");
expect(resolvePostLoginRoute({ workspaces: [], returnTo: "https://evil.example" }))
  .toBe("/waiting");
```

- [ ] **Step 2: Run focused Web tests and verify they fail**

Run: `pnpm --filter @crm/web test:unit -- post-login-route.test.ts api-error.test.ts`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement clients and route policy**

Browser client uses `NEXT_PUBLIC_API_ORIGIN`, `credentials: "include"`, and generated `paths`. Server client uses server-only `API_ORIGIN`, forwards the incoming `cookie` and `x-request-id`, and never exposes server environment values to client bundles.

Add `NEXT_PUBLIC_API_ORIGIN=http://localhost:3001` and `API_ORIGIN=http://localhost:3001` to `.env.example`.

`toApiError` accepts generated error bodies and returns `{ code, message, fieldErrors, requestId, status }`. `resolvePostLoginRoute` accepts only relative paths beginning with one `/`, rejects `//`, and uses the workspace-count rules from the spec.

- [ ] **Step 4: Add auth schemas**

Export exact Zod schemas: `phoneSchema`, `verificationCodeSchema`, `passwordSchema`, `registerSchema`, `loginSchema`, and `resetPasswordSchema`. Password requires 10–72 characters and at least one letter plus one number; the server repeats the same rule.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @crm/web test
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
```

Then:

```bash
git add .env.example apps/web pnpm-lock.yaml
git commit -m "feat(web): add typed API and auth routing"
```

---

### Task 9: Implement Registration, Login, Password Reset, and Account Security Pages

**Files:**
- Modify: `apps/web/src/app/(auth)/register/page.tsx`
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/src/app/(account)/account/security/page.tsx`
- Create: `apps/web/src/features/auth/auth-shell.tsx`
- Create: `apps/web/src/features/auth/register-form.tsx`
- Create: `apps/web/src/features/auth/login-form.tsx`
- Create: `apps/web/src/features/auth/password-reset-form.tsx`
- Create: `apps/web/src/features/auth/session-list.tsx`
- Create: `apps/web/src/features/auth/auth.module.css`
- Test: `apps/web/src/features/auth/register-form.test.tsx`
- Test: `apps/web/src/features/auth/login-form.test.tsx`
- Test: `apps/web/src/features/auth/password-reset-form.test.tsx`

**Interfaces:**
- Consumes: Task 8 schemas/clients and generated auth routes.
- Produces: complete auth pages and account session management.

- [ ] **Step 1: Write failing user-behavior tests**

Registration test must type a phone, request a code, verify a 60-second disabled countdown, submit name/code/password, and assert navigation uses the API result. Login test must preserve a safe `returnTo`, show field errors next to fields and a request ID in the summary, and prevent duplicate submit. Reset test must cover request-code, verify/reset, success, and navigation back to login.

- [ ] **Step 2: Run focused tests and verify placeholders fail**

Run: `pnpm --filter @crm/web test:unit -- register-form.test.tsx login-form.test.tsx password-reset-form.test.tsx`

Expected: FAIL because pages still render `PagePlaceholder` and forms do not exist.

- [ ] **Step 3: Implement accessible Ant Design forms**

Use React Hook Form with `zodResolver`, TanStack Query mutations, one primary button, field-level errors, an Alert summary, visible loading text, and keyboard focus on the first invalid field. Do not render email login, marketing carousel, or a verification code from an API response.

`AuthShell` renders the product statement “把分散的 Excel 变成可协作的业务流程” beside the form on desktop and above it on mobile.

- [ ] **Step 4: Implement account security**

The page requires a user, lists sessions with device summary, IP summary, last used time, and current-session label, supports revoking another session, and changes password while preserving the current session. Confirmation is required only for revocation.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @crm/web test
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
pnpm --filter @crm/web build
```

Then:

```bash
git add apps/web
git commit -m "feat(web): implement phone account pages"
```

---

### Task 10: Implement Waiting, Invitation, and Workspace Selection Pages

**Files:**
- Modify: `apps/web/src/app/(account)/waiting/page.tsx`
- Modify: `apps/web/src/app/(account)/workspaces/page.tsx`
- Create: `apps/web/src/app/(account)/invitations/[invitationId]/page.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/layout.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/page.tsx`
- Create: `apps/web/src/lib/auth/require-workspace.ts`
- Create: `apps/web/src/features/invitations/invitation-card.tsx`
- Create: `apps/web/src/features/invitations/invitation-detail.tsx`
- Create: `apps/web/src/features/invitations/invitation-actions.tsx`
- Create: `apps/web/src/features/workspaces/workspace-list.tsx`
- Test: `apps/web/src/features/invitations/invitation-detail.test.tsx`
- Test: `apps/web/src/features/workspaces/workspace-list.test.tsx`

**Interfaces:**
- Consumes: personal invitation/workspace API and post-login routing policy.
- Produces: standalone-user waiting experience, invitation state results, workspace chooser, and a server-verified workspace shell.

- [ ] **Step 1: Write failing invitation state tests**

Render fixtures for `PENDING`, `ACCEPTED`, `DECLINED`, `REVOKED`, and `EXPIRED`. Assert only PENDING renders enabled accept/decline actions; phone mismatch renders no tenant-sensitive detail; accepting disables both actions and navigates according to returned workspaces.

Workspace tests assert active cards link to `/workspace/{tenantCode}`, suspended tenant and disabled membership cards are visible but disabled with a reason, and one active workspace redirects automatically.

- [ ] **Step 2: Run tests and verify placeholders fail**

Run: `pnpm --filter @crm/web test:unit -- invitation-detail.test.tsx workspace-list.test.tsx`

Expected: FAIL because account pages remain placeholders.

- [ ] **Step 3: Implement waiting and invitation pages**

`/waiting` shows current display name, pending invitation cards, refresh, account security, and logout. Empty copy is exactly “请联系公司管理员按此手机号邀请你。” It never shows tenant navigation or a public company directory.

Invitation detail displays tenant, role, inviter, expiry, and a result panel. Non-owned invitation uses the generic unavailable state and does not reveal tenant name.

- [ ] **Step 4: Implement workspace selection**

Cards show tenant name, member role, last access if available, and inactive reason. Workspaces are sorted by active state then last access; inactive entries cannot be entered.

`requireWorkspace(tenantCode)` calls the workspace-scoped API from the server client and returns the verified tenant/member summary or redirects to login, waiting, workspaces, or the unavailable result. The workspace layout uses that result for its name and role. The workspace home shows only identity/workspace information and navigation; it does not invent CRM metrics or records.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @crm/web test
pnpm --filter @crm/web build
```

Then:

```bash
git add apps/web
git commit -m "feat(web): implement invitation and workspace onboarding"
```

---

### Task 11: Implement Platform Tenant and Workspace Member Administration Pages

**Files:**
- Modify: `apps/web/src/app/(platform)/platform/tenants/page.tsx`
- Create: `apps/web/src/app/(platform)/platform/tenants/new/page.tsx`
- Create: `apps/web/src/app/(platform)/platform/tenants/[tenantId]/page.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/members/page.tsx`
- Create: `apps/web/src/features/tenants/create-tenant-form.tsx`
- Create: `apps/web/src/features/tenants/tenant-status-actions.tsx`
- Create: `apps/web/src/features/members/member-table.tsx`
- Create: `apps/web/src/features/members/invite-member-form.tsx`
- Test: `apps/web/src/features/tenants/create-tenant-form.test.tsx`
- Test: `apps/web/src/features/members/member-table.test.tsx`

**Interfaces:**
- Consumes: platform tenant and workspace member APIs.
- Produces: minimal platform provisioning UI and tenant-admin member management UI.

- [ ] **Step 1: Write failing authorization and form tests**

Tenant form test submits name, lowercase code, and first-admin phone, then shows DRAFT result and invitation state. It rejects uppercase/spaces before calling API. Tenant status test disables activation when the response says no active admin.

Member tests assert employees receive the no-access result, admins can invite by phone/role, pending rows offer resend/revoke, active rows offer disable, and the final active admin cannot be disabled.

- [ ] **Step 2: Run tests and verify placeholders fail**

Run: `pnpm --filter @crm/web test:unit -- create-tenant-form.test.tsx member-table.test.tsx`

Expected: FAIL because both pages remain placeholders.

- [ ] **Step 3: Implement platform tenant pages**

The create page has one form and a confirmation summary; it never asks for an administrator password. The detail page shows tenant state, first-admin invitation state, active-admin count, activation requirements, and audited status actions.

- [ ] **Step 4: Implement member management**

Use Ant Design Table with server pagination. Keep pending invitations and active members visually distinct. Require confirmation for revoke/disable, show stable API error messages, and invalidate only query keys scoped to the current `tenantCode`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @crm/web test
pnpm --filter @crm/web lint
pnpm --filter @crm/web typecheck
pnpm --filter @crm/web build
```

Then:

```bash
git add apps/web
git commit -m "feat(web): add tenant and member administration"
```

---

### Task 12: Add Browser E2E, Security Regression Coverage, and Final Documentation

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/account-workspace.spec.ts`
- Create: `apps/web/e2e/cross-tenant.spec.ts`
- Create: `apps/web/e2e/fixtures.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/design/03-数据模型定义.md`
- Modify: `docs/superpowers/specs/2026-08-20-account-invitation-workspace-design.md`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the complete first slice.
- Produces: reproducible browser acceptance tests, root verification commands, and truthful implementation status documentation.

- [ ] **Step 1: Add Playwright and write failing happy-path/security tests**

```bash
pnpm --filter @crm/web add -D @playwright/test
```

`account-workspace.spec.ts` performs:

```text
register platform user → grant platform admin by CLI
create draft tenant + first-admin invitation
register/login first admin → accept invitation
platform admin activates tenant
first admin enters workspace → invites employee
employee registers, accepts, and enters workspace
```

`cross-tenant.spec.ts` creates tenant A and B, changes the browser URL and direct API `tenantCode`, and asserts no tenant B member names or IDs appear. It then disables the employee and asserts their existing session is rejected on the next workspace request.

- [ ] **Step 2: Run browser tests and verify missing setup fails**

Run: `pnpm --filter @crm/web test:e2e`

Expected: FAIL because Playwright configuration and the completed flow are not yet wired into a test environment.

- [ ] **Step 3: Add deterministic E2E orchestration**

Playwright starts API and Web with test-only origins and the fixed verification code, uses the isolated PostgreSQL/Redis services, and resets the database through the admin migration connection before the suite. Test code never reads password hashes, code hashes, or session hashes.

Add root scripts:

```json
{
  "test:integration": "pnpm --filter @crm/database test:integration && pnpm --filter @crm/api test:e2e",
  "test:e2e": "pnpm --filter @crm/web test:e2e",
  "verify": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm contracts:check && pnpm build"
}
```

- [ ] **Step 4: Update truthful delivery status**

Mark the seven first-slice models as implemented only after migration/RLS tests pass. Update README with the platform-admin bootstrap command, migration commands, local fixed-code warning, and first-slice routes. Change the spec status from `待实施` to `已实现` only after every acceptance command exits 0.

- [ ] **Step 5: Run the complete verification gate**

Run:

```bash
docker compose up -d redis
docker compose -f compose.test.yaml up -d
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
pnpm --filter @crm/database prisma:validate
docker compose config --quiet
docker compose -f compose.test.yaml config --quiet
git diff --check
```

Expected: every command exits 0; all unit, PostgreSQL integration, API E2E, browser E2E, contract drift, build, schema, and Compose checks pass.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json pnpm-lock.yaml apps/web docs/design/03-数据模型定义.md docs/superpowers/specs/2026-08-20-account-invitation-workspace-design.md
git commit -m "test: verify account invitation workspace slice"
```
