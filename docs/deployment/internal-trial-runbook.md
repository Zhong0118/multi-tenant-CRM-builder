# Internal-trial deployment runbook

For the authorized self-hosted target (Ubuntu 24.04, 4 CPU, 8 GB RAM), the minimal Compose topology is [`deploy/compose.production.yaml`](../../deploy/compose.production.yaml) behind [`deploy/Caddyfile`](../../deploy/Caddyfile). Only Caddy publishes ports; PostgreSQL and Redis stay on the internal network with persisted volumes. The image uses the repository's actual `@crm/api start:prod`, `@crm/web start`, and `@crm/worker start` commands. The worker currently only connects to Redis and logs `no business queues are registered`; it is a placeholder runtime, not background business processing. Replace example hostnames before use; this remains untested infrastructure.

Status: **minimal preparation only**. This document and its scripts do not deploy, provision, migrate, or contact external providers. Before any production action, an owner must supply approved infrastructure, secret-manager, backup-retention, and rollback details.

## Evidence and current boundaries

Checked in this worktree:

- Root scripts: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Database scripts: `pnpm --filter @crm/database prisma:migrate:deploy` (uses Prisma migrations); migration owner is `DATABASE_ADMIN_URL`.
- API scripts: `pnpm --filter @crm/api build`, `pnpm --filter @crm/api start:prod`, and `pnpm --filter @crm/api test:e2e:critical`.
- API health route is `GET /health`, returning `{ "status": "ok", "service": "api" }`. It is a liveness response, not a database/Redis readiness proof.
- Attachments are currently stored in PostgreSQL `record_attachments.content` (`bytea`). They are permission-checked and private at the API, but this does **not** satisfy the Production Essentials requirement for private object storage. Do not present attachments as production-ready until the object-storage task is completed.
- SMS production delivery is currently missing: the verification sender remains an application boundary and the existing environment file labels SMS values as placeholders. Treat SMS as **untested/unavailable** for this trial.
- AI is required for this internal trial. Configure `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY` through the secret manager; never put values in Git, browser code, logs, or this runbook.
- External resources (hosting, DNS/TLS, secret manager, managed PostgreSQL/Redis, AI provider, SMS provider, object storage, alerting) are **not tested by this repository-only preparation**.

## Preflight

1. Confirm the release identifier and a tested rollback target. No automatic migration rollback is provided.
2. Confirm HTTPS, DNS, cookie/origin policy, secret manager access, database backups/retention, Redis availability, and an owner for each external dependency.
3. Create an isolated empty **drill database** whose name starts with `drill_` or ends with `_drill`. It must not be the production database and must not use `DATABASE_URL` or `DATABASE_ADMIN_URL`. The restore script checks actual PostgreSQL server/database identity, not URL spelling.
4. Load a secret-manager-backed environment based on [`.env.internal-trial.example`](../../.env.internal-trial.example). Check that no value is copied into Git or chat.
5. Run `scripts/deployment/build.sh`. The script matches the root `build` script (`pnpm -r --if-present build`).
6. Run `scripts/deployment/health.sh` against the exact deployed URL only after a deployment exists. `/health` proves API liveness only.

## Release and migration sequence

```sh
scripts/deployment/build.sh
scripts/deployment/backup.sh
scripts/deployment/migrate.sh
# start/restart with the platform's documented mechanism, using apps/api's start:prod command
scripts/deployment/health.sh
```

Run migrations only once, from a controlled release job, with `DATABASE_ADMIN_URL`. The application runtime should use the least-privileged `DATABASE_URL`; never substitute it for the migration owner. Review the migration output and stop on any error.

## First admin, tenant, and member path

The first account path is API-driven:

1. Request a registration verification code with `POST /api/v1/auth/verification-challenges` (`purpose: REGISTER`), then register with `POST /api/v1/auth/register`. Registration creates an active user and session, but does not itself create a tenant.
2. A platform administrator uses `POST /api/v1/platform/tenants` to create a tenant and its first-admin invitation. Platform admin access is guarded by `SessionAuthGuard` and `PlatformAdminGuard`; it is not a public registration shortcut. If the invitation phone is wrong, use `PATCH /api/v1/platform/tenants/:tenantId/first-admin-phone`; to issue a new invitation use `POST /api/v1/platform/tenants/:tenantId/first-admin-invitation/renew`.
3. The invited first admin accepts through the invitation flow (`POST /api/v1/invitations/:token/accept`, as exposed by the invitation module), then logs in through `POST /api/v1/auth/login`.
4. Select the resulting workspace using `GET /api/v1/me/workspaces`; tenant-scoped calls use `/api/v1/workspaces/:tenantCode/...`. `WorkspaceGuard` requires an active member and active tenant.
5. The tenant admin invites members with `POST /api/v1/workspaces/:tenantCode/invitations`; invited members accept, log in, and use the same workspace selector. Verify member status and role before testing tenant data.

Exact invitation token delivery and any SMS delivery are external/unverified in this repository. Use an approved test channel and record the evidence separately.

## Backup and restore drill

```sh
BACKUP_DIR=/secure/path scripts/deployment/backup.sh
BACKUP_FILE=/secure/path/crm-<timestamp>.dump \
DRILL_DATABASE_URL=postgresql://<drill-owner>:<password>@<host>:5432/<empty-drill-db> \
scripts/deployment/restore-empty-drill-db.sh
```

`restore-empty-drill-db.sh` requires explicit runtime/admin/drill URLs, resolves their actual PostgreSQL server/database identities with `psql`, requires a `drill_*`/`*_drill` database name, verifies zero user relations, refuses runtime/admin targets, and checks that the local `pg_restore` major matches the PostgreSQL server major (a PG15 client must not restore into PG18). It intentionally omits `--clean`, `--no-owner`, and `--no-privileges`: the empty target preserves dump ownership, ACLs, grants, and RLS policies. Runtime roles/grants are cluster globals and must be separately captured/restored with a compatible `pg_dumpall --globals-only` process. It never prints connection URLs. Validate restored schema/data with a read-only smoke check and record backup timestamp, restore duration, and result. Encrypt backups and apply retention outside this repository.

## Rollback

Application rollback is feasible only when the deployment platform exposes a release pointer. Set an explicit, previously tested release and run:

```sh
RELEASE_POINTER_FILE=/controlled/path/release-pointer \
ROLLBACK_RELEASE=<known-good-release-id> \
scripts/deployment/rollback-release-pointer.sh
scripts/deployment/health.sh
```

The script only writes the pointer; it does not restart a platform or reverse database migrations. If a migration is incompatible, stop traffic and use the approved forward-fix/restore procedure. Never guess a release ID or run destructive SQL.

## Trial acceptance record

Record the release ID, build output, migration output, health response, backup/restore evidence, first-admin/tenant/member test identities (non-secret references only), AI provider/model smoke result, and every external dependency marked `PASS`, `FAIL`, or `NOT TESTED`. Current repository evidence does not establish production readiness for SMS, private object storage, managed databases/Redis, TLS, or external AI delivery.
