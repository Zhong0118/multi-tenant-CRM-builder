# Internal-trial deployment runbook

Status: **repository preparation; external deployment not tested**. The commands below are operator instructions, not actions automatically performed by this repository. Obtain authorization and approved DNS/TLS, secrets, backup retention, and rollback details before executing them on a deployment target. The Tencent SMS adapter is implemented; production delivery remains unverified. Supply approved credentials, app/sign/template identifiers, and verify delivery before accepting the account bootstrap. Never enable a fixed development code in production.

## Topology and configuration

For the proposed Ubuntu 24.04 / 4 CPU / 8 GB target, [Compose](../../deploy/compose.production.yaml) runs API, Web, PostgreSQL 18, authenticated Redis, and [Caddy](../../deploy/Caddyfile). Only Caddy publishes 80/443. API uses the actual `@crm/api start:prod` command (`node dist/main`); Web uses `@crm/web start` (`next start`). Each has a separate container `PORT` (3001 and 3000). The placeholder worker has no business queues and is omitted.

Copy the [environment template](../../.env.internal-trial.example) to ignored `.env.internal-trial`, restrict its permissions to 0600, and replace every placeholder. `WEB_HOST`/`API_HOST` are hostnames without schemes; `WEB_ORIGIN`/`NEXT_PUBLIC_API_ORIGIN` are HTTPS origins. Supply unique owner, `crm_app`, and Redis passwords; passwords in connection URLs must be URL-encoded. Runtime URLs use Compose hostnames `postgres` and `redis`, not localhost. Keep `CRM_APP_PASSWORD` consistent with `DATABASE_URL`, and `REDIS_PASSWORD` with `REDIS_URL`. Production requires the AI settings and `SMS_PROVIDER=tencent` plus all `TENCENT_SMS_*` credentials and approved provider identifiers in the template. Compose forwards them only to API; Web and build arguments receive no SMS or AI secrets.

Compose explicitly passes only the API settings needed at runtime; the API and Web do not receive database-owner credentials. The database owner is privileged and used only for provisioning, migrations, and deliberate administrative jobs. Docker administrators can inspect container environment values; restrict Docker/socket access. The [Docker ignore file](../../.dockerignore) excludes local env files, keys, dependency directories, build outputs, and dumps from build context. Never store secrets under ordinary source names.

`NEXT_PUBLIC_API_ORIGIN` is a Docker build argument embedded into the browser bundle. Changing it requires rebuilding the image; runtime environment changes cannot update the bundle. [Dockerfile](../../Dockerfile) builds all packages and retains tooling for the explicit migration/admin jobs. This minimal image runs as root; container hardening and image-size optimization remain follow-up work.

Attachments use private API-mediated disk storage at `/var/lib/crm/attachments`, persisted in `attachments_data`; metadata remains in PostgreSQL. Back up both database and this volume together. This is single-host private storage, not verified private object storage, and requires a single API instance or shared storage before scaling.

## Review-only checks

From the repository root:

```sh
# Validates the example model without starting containers or printing secrets.
docker compose --env-file .env.internal-trial.example -f deploy/compose.production.yaml --profile maintenance config --quiet
# Validate actual operator-supplied configuration without dumping resolved credentials.
docker compose --env-file .env.internal-trial -f deploy/compose.production.yaml --profile maintenance config --quiet
```

Compose `--env-file` supplies YAML interpolation; no environment file is copied into the image. A successful config check proves configuration syntax only. It does not prove image builds, PostgreSQL role provisioning, migrations, provider access, or DNS/TLS.

## Explicit initial provisioning and release sequence

These commands create/change deployment resources. Run only on the approved target, after backups and release review. Do not use `up --profile maintenance`: maintenance jobs are deliberately invoked individually.

```sh
# The shorthand is local to this shell, with no automatic production operation.
crm_compose() { docker compose --env-file .env.internal-trial -f deploy/compose.production.yaml "$@"; }
crm_compose build api
crm_compose up -d --wait postgres redis
# First install only; rerunning deliberately rotates crm_app to CRM_APP_PASSWORD.
crm_compose run --rm provision
# Exactly once per release; never run migrations from API startup or every replica.
crm_compose run --rm migrate
# Review successful migration output before starting application traffic.
crm_compose up -d api web caddy
HEALTH_URL=https://api.example.invalid/api/v1/health scripts/deployment/health.sh
```

The explicit [provision job](../../scripts/deployment/provision-runtime-role.sh) creates/resets `crm_app` as `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` with the supplied password in one transaction, then reuses the [existing SQL](../../infrastructure/postgres/init/001-create-app-role.sql) for connect/schema grants. It precreates the role so the development default password is never applied. It is not mounted as an automatic PostgreSQL initialization hook. Migrations depend on this exact role name and apply table-specific grants/RLS; no blanket table grants are added. Review existing role memberships/ownership on reused databases: altering role flags does not remove inherited privilege memberships. PostgreSQL image initialization variables only affect an empty data volume; existing owner credentials require a deliberate rotation procedure.

For upgrades: retain a known-good immutable `RELEASE_ID` image, create a database plus attachment backup, run the migration job once, then recreate API/Web. Do not rerun provision on every release. No automatic migration rollback is provided. Managed databases/Redis need a separately reviewed topology; this template provisions local services.

The optional [host build script](../../scripts/deployment/build.sh) requires exported `NEXT_PUBLIC_API_ORIGIN`. [Host migrations](../../scripts/deployment/migrate.sh) require a host-reachable `DATABASE_ADMIN_URL`, not the internal Compose hostname. The public health route is `GET /api/v1/health`; it proves liveness only. Check `GET /api/v1/health/ready` separately for bounded database and Redis readiness (503 on dependency failure). Runtime dependency status is also exposed to authenticated platform administrators. A dependency probe does not establish SMS, AI, or disk-storage readiness.

## Bootstrap, tenant, and invited member workflow

1. Keep `PUBLIC_REGISTRATION_ENABLED=false`. Set `FIRST_ADMIN_PHONE` to the approved platform bootstrap phone in normalized `+86...` form, then recreate API. This is a registration allowlist, not a platform-admin grant.
2. With supported verification delivery, request `POST /api/v1/auth/verification-challenges` (`purpose: REGISTER`), then `POST /api/v1/auth/register`. This creates a verified active user/session, without a tenant or platform-admin privilege. Verify Tencent SMS delivery with approved test recipients and record evidence; repository checks do not prove delivery.
3. Explicitly grant the registered account through the audited owner-only CLI; the API runtime role must not perform this grant:

   ```sh
   crm_compose run --rm --no-deps migrate pnpm --filter @crm/api platform-admin:grant \
     --phone '+8613800138000' --reason 'Approved bootstrap change reference'
   ```

   Use the approved account rather than the example phone. The CLI requires an existing active, verified user and records `platform.admin.granted` in the audit log. Never insert an admin directly or enable public registration as a shortcut.
4. Log in via `POST /api/v1/auth/login`. The platform admin creates a tenant and first-admin invitation using `POST /api/v1/platform/tenants`. Correct a phone with `PATCH /api/v1/platform/tenants/:tenantId/first-admin-phone`; renew with `POST /api/v1/platform/tenants/:tenantId/first-admin-invitation/renew`.
5. Invited users must have an account/session. With public registration disabled, an active tenant's pending, unexpired invitation permits its target phone to request registration verification and register through supported delivery. Expired, revoked, or inactive-tenant invitations do not authorize registration. Keep `FIRST_ADMIN_PHONE` restricted to approved bootstrap administrators; current production validation requires it to remain nonempty. Do not run the platform-admin grant for tenant admins or members.
6. The authenticated invitee lists invitations with `GET /api/v1/me/invitations` and accepts with `POST /api/v1/me/invitations/:invitationId/accept`. There is no invitation-token accept route. Use the returned invitation ID, then select the workspace with `GET /api/v1/me/workspaces`. Tenant calls use `/api/v1/workspaces/:tenantCode/...` and require active membership and tenant.
7. Tenant admins invite members using `POST /api/v1/workspaces/:tenantCode/invitations`; repeat invitation-authorized account registration and personal invitation acceptance as needed. Verify roles, status, and cross-tenant isolation.

Invitation delivery and verification are not externally tested. Keep the bootstrap allowlist minimal, and record delivery and registration evidence separately.

## Backup and restore drill

The [backup script](../../scripts/deployment/backup.sh) requires `DATABASE_BACKUP_URL`, a host-reachable owner/backup connection covering all RLS-protected data. `crm_app` cannot take a complete tenant backup. Use PostgreSQL 18-compatible client tools for the local PostgreSQL 18 topology. Restrict and encrypt backups; preserve the attachment volume and cluster globals/roles separately.

```sh
DATABASE_BACKUP_URL='<approved host-reachable backup connection>' \
BACKUP_DIR=/secure/path scripts/deployment/backup.sh
BACKUP_FILE=/secure/path/crm-<timestamp>.dump \
DRILL_DATABASE_URL='<approved empty drill connection>' \
DATABASE_URL='<host-reachable runtime connection>' \
DATABASE_ADMIN_URL='<host-reachable owner connection>' \
scripts/deployment/restore-empty-drill-db.sh
```

The [restore drill](../../scripts/deployment/restore-empty-drill-db.sh) requires an isolated empty `drill_*`/`*_drill` database, resolves actual server/database identities, refuses runtime/admin targets, and checks local `pg_restore` and server major compatibility. It omits destructive `--clean` and preserves ownership, ACLs, grants, and RLS policies. Provision required cluster roles first using a reviewed compatible `pg_dumpall --globals-only` process, including `crm_app`, the migration owner, and `crm_registration_probe`. Migration 0022 uses `crm_registration_probe` as a `NOLOGIN NOBYPASSRLS` registration-probe function owner with narrowly scoped SELECT policy; preserve its ownership/grants/policy, and do not grant application users membership in that role. Restore attachment files into a separate drill volume and verify content through the API. Record backup timestamp, restore duration, and read-only smoke results.

## Rollback and acceptance

Use the retained known-good `RELEASE_ID` image and reviewed deployment procedure to recreate applications only if migrations remain compatible. The [release-pointer script](../../scripts/deployment/rollback-release-pointer.sh) only changes an explicit platform pointer; it does not control Compose, restart applications, or reverse migrations. Stop traffic and use an approved forward-fix/restore plan if schema rollback is unsafe. Never guess a release ID.

Record release/image identity, build output, migration output, liveness and dependency checks, backup/restore and attachment evidence, bootstrap/tenant/member identities (non-secret references), and AI smoke results. Mark hosting, DNS/TLS, secret management, databases/Redis, SMS, object storage, alerting, and AI delivery individually `PASS`, `FAIL`, or `NOT TESTED`. Repository-only checks do not establish production readiness.
