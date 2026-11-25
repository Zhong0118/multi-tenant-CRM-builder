# Internal-trial deployment runbook

Status: **repository preparation; external deployment not tested**. The commands below are operator instructions, not actions automatically performed by this repository. Obtain authorization and approved DNS/TLS, secrets, backup retention, and rollback details before executing them on a deployment target. The Tencent SMS adapter is implemented; production delivery remains unverified. Supply approved credentials, app/sign/template identifiers, and verify delivery before accepting the account bootstrap. Never enable a fixed development code in production.

## Authoritative status: 2026-10-06 remediation in progress

Work in `.worktrees/crm-product-experience-v2-slice-4`, local branch `codex/internal-trial-preparation`; root `main` is behind and must not be used. PR #26 remains OPEN and unmerged, remote branch `codex/crm-product-experience-v2-slice-4`. Code SHA `58da1ce` run `37444823699`, remediation `3432aa4` run `37445633285`, and documentation follow-up `df90be3` run `37446164020` all have six required checks SUCCESS. The 2026-10-07 P2-R record-draft fix lands after `df90be3`; its checks are the ones reported for the PR #26 HEAD. These are recorded evidence, not a permanent latest SHA; merge and deployment remain forbidden. User-authorized work covers D01-D04, F01-F03, verification-code persistence and PR CI. PR updates/push are authorized; merge, deployment and cleanup remain forbidden. Preserve the user's untracked review and frontend brief.

The [remediation ledger](../audits/2026-10-06/internal-trial-remediation.md) is the current evidence source. Docker now copies root `tsconfig.base.json` and shares build-time-prepared pnpm 11.19.0 tooling with runtime (`COREPACK_ENABLE_NETWORK=0`). Old local baseline/fixed builds stopped on npm `fetch failed`; retain that as historical network limitation only. Code run `37444823699` Build (2m50) passed no-cache full Docker, offline pnpm, and internal-network migration twice. D01/D02 are verified at code/CI level; this does not authorize deployment.

Real local Caddy browser observation at `https://localhost:3443` covers login, `/workspace/nebula-demo`, refresh with a complete dashboard, and logout followed by protected-route redirect to login. The cookie was Secure, HttpOnly, host-only `localhost` and cleared on logout. This used an internal/self-signed certificate with browser trust bypass, Web3100/API3101 and isolated PostgreSQL55435/`crm_browser_review`; it does not verify public DNS, public certificate trust or deployment. F01 delayed real PATCH200 retained the cancelled/reopened session's new remark with save enabled. F02 also has a real local Playwright + AntD PATCH500 failure-retention PASS: isolated DB fixture session, no AI provider call, visible dialog, retained `draft retained browser` input and role-alert retry error; old-session race remains component-test evidence only. Real AuthService + Prisma main recheck passed Critical API E2E 2 suites/11 tests; database integration passed36, and full typecheck/build/contracts exited0. F03's clean23 migrations and runtime ACL/RLS/DRAFT/ACTIVE versus SUSPENDED/CLOSED boundary were verified. A final reviewer then found an Important pool risk: independent error-count persistence asks for another connection while a transaction already occupies the pool, so10 or more concurrent attempts may starve it. The pool Important is resolved in code: mismatch uses only private `ChallengeCodeMismatch`, REGISTER/RESET increment after the awaited transaction catch, and the 12-concurrency regression is green. `queryconnection_limit` is not a valid effective setting here; do not claim a configured pool-size safeguard (default pg pool10 applies). Code/CI is a merge candidate, but this runbook does not authorize merge or deployment. Migration `0023` is an unpublished consolidated repair; the probe must remain restricted and `NOBYPASSRLS`. Real SMS delivery/limiting, real AI provider, production server/DNS/TLS, external databases/Redis and backups are **NOT VERIFIED**.

## Topology and configuration

For the proposed Ubuntu 24.04 / 4 CPU / 8 GB target, [Compose](../../deploy/compose.production.yaml) runs API, Web, PostgreSQL 18, authenticated Redis, and [Caddy](../../deploy/Caddyfile). Only Caddy publishes 80/443. API uses the actual `@crm/api start:prod` command (`node dist/main`); Web uses `@crm/web start` (`next start`). Each has a separate container `PORT` (3001 and 3000). The placeholder worker has no business queues and is omitted.

Copy the [environment template](../../.env.internal-trial.example) to ignored `.env.internal-trial`, restrict its permissions to 0600, and replace every placeholder. `WEB_HOST` is a hostname without a scheme. Use one public HTTPS `WEB_ORIGIN`: Caddy routes `/api/v1/*` to API and all other paths to Web, preserving the host-only session cookie for browser requests and SSR. Compose supplies the browser build argument and API public origin from `WEB_ORIGIN`; keep the template's `API_ORIGIN` and `NEXT_PUBLIC_API_ORIGIN` aligned with it. Web SSR uses private `http://api:3001` and forwards incoming cookies. Do not restore split app/API domains without a separately verified session design. Supply unique owner, `crm_app`, and Redis passwords; passwords in connection URLs must be URL-encoded. Runtime URLs use Compose hostnames `postgres` and `redis`, not localhost. Keep `CRM_APP_PASSWORD` consistent with `DATABASE_URL`, and `REDIS_PASSWORD` with `REDIS_URL`. Environment-backed AI uses the existing AI settings. Production requires `SMS_PROVIDER=tencent` plus all `TENCENT_SMS_*` credentials and approved provider identifiers in the template. Compose forwards them only to API; Web and build arguments receive no SMS or AI secrets.

### 平台模型主密钥的首次设置与备份

在服务器部署目录运行以下命令。部署文件按实际环境选择，示例使用 Compose 已读取的 `.env.internal-trial`。命令生成 32 字节随机密钥，以 0600 权限原子更新该文件，不输出密钥。遇到已有的非空配置会停止。多 API 实例从同一份受控配置分发，避免每台机器各自生成。

```sh
python3 - .env.internal-trial <<'PYTHON'
import base64, json, os, re, secrets, sys, tempfile
from pathlib import Path

path = Path(sys.argv[1])
data = path.read_text()
pattern = re.compile(r"^AI_MODEL_KEYRING=.*$", re.M)
matches = pattern.findall(data)
if len(matches) > 1 or any(line.partition("=")[2].strip() for line in matches):
    raise SystemExit("发现已有主密钥配置，请按轮换步骤处理")
key = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
ring = json.dumps({"activeKeyId":"v1","keys":{"v1":key}}, separators=(",",":"))
line = "AI_MODEL_KEYRING='" + ring + "'"
data = pattern.sub(line, data) if matches else data.rstrip("\n") + "\n" + line + "\n"
with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as tmp:
    tmp.write(data)
    tmp.flush()
    os.fsync(tmp.fileno())
os.replace(tmp.name, path)
PYTHON
```

将完整 keyring（含 key ID）离线备份到独立的加密介质或受控密码库，和数据库备份分开保管。用隔离恢复环境检验备份能解密已保存的测试 Key。恢复旧数据库备份时也需要当时的主密钥；轮换后保留相应旧版本的离线副本。若所有副本丢失，平台录入的厂商 Key 都需要逐个重新录入、测试并重新分配。CRM 业务数据不受影响。主密钥轮换流程见[设计规格第 2.2 节](../superpowers/specs/2026-11-24-ai-models-and-sales-daily-design.md#22-key地址与测试)。



Compose explicitly passes only the API settings needed at runtime; the API and Web do not receive database-owner credentials. The database owner is privileged and used only for provisioning, migrations, and deliberate administrative jobs. Docker administrators can inspect container environment values; restrict Docker/socket access. The [Docker ignore file](../../.dockerignore) excludes local env files, keys, dependency directories, build outputs, and dumps from build context. Never store secrets under ordinary source names.

`NEXT_PUBLIC_API_ORIGIN` is a Docker build argument embedded into the browser bundle. Changing it requires rebuilding the image; runtime environment changes cannot update the bundle. [Dockerfile](../../Dockerfile) builds all packages and retains tooling for the explicit migration/admin jobs. This minimal image runs as root; container hardening and image-size optimization remain follow-up work.

Attachments use private API-mediated disk storage at `/var/lib/crm/attachments`, persisted in `attachments_data`; metadata remains in PostgreSQL. Back up both database and this volume together. This is single-host private storage, not verified private object storage, and requires a single API instance or shared storage before scaling.

头像保存在 API 使用的独立卷 `avatars_data:/var/lib/crm/avatars`。限制宿主机访问权限，多 API 实例必须挂载同一共享目录。暂停头像写入后，同时备份数据库、附件卷和头像卷。恢复时使用同一批次的数据库和卷。

先执行数据库迁移，再部署 API 和 Web。确认账号页可用后，根据 [腾讯云发信开通说明](email-tencent-ses.md) 填写 SMTP 配置，在受控环境执行 `openssl rand -hex 32` 生成 `MAIL_SECRET`，单独备份该密钥。设置 `MAIL_PROVIDER=smtp` 并重启 API。生产 `WEB_ORIGIN` 必须包含 `https://crm.baijiehub.com`。用平台管理员本人的已验证邮箱试发并查看近七天统计。清空 `MAIL_PROVIDER` 可停用发信，回滚应用时保留数据库结构和头像卷。轮换密钥后，用户需要重新申请验证码。

本地运行 `docker compose --profile mail up -d mailpit`。开发 API 依照示例设置发件人和密钥，并配置 `SMTP_HOST=127.0.0.1`、`SMTP_PORT=1025`、`MAIL_PROVIDER=smtp` 和 `WEB_ORIGIN=http://localhost:3000`。在 `http://127.0.0.1:8025` 查看本机捕获的邮件。


Compose fixes edge subnet `172.30.26.0/24`, Caddy `.2`, API `.3`, Web `.4`. API trusts only exact Caddy peer `172.30.26.2`; Caddy replaces incoming `X-Forwarded-For` with the actual client address. Never use unconditional proxy trust or arbitrary trusted subnets. Check subnet conflicts before a separately authorized startup. Real client containers `.10`/`.11` sending the same forged XFF were observed upstream with distinct real client addresses and remote peer `.2`; bounded-proxy tests passed 8 cases including untrusted spoof, default deny and safe exact IP. Actual Nest controller/service/limiter tests also passed (3 suites/11 tests, 63 HTTP requests): each of two clients independently accepts20/hour then429, untrusted spoof cannot avoid the limit, and rejected requests do not create challenges/send SMS. Repository/sender boundaries are fake in that test; it does not verify external SMS delivery or the public deployment.

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
HEALTH_URL=https://app.example.invalid/api/v1/health scripts/deployment/health.sh
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
5. Invited users must have an account/session. With public registration disabled, the intended invitation boundary permits DRAFT first-admin bootstrap and ACTIVE tenants, while excluding SUSPENDED/CLOSED tenants and expired/revoked invitations. The baseline omitted tenant status. Unpublished migration `0023` passed clean23-migration and runtime ACL/RLS regression for this boundary; production has not been migrated. Verification-code failure counts are written after the business transaction releases its connection; correct-code consumption and business writes remain atomic. Code/follow-up commits `58da1ce`, `3432aa4`, and `df90be3` passed all six required checks; `df90be3` is tied to run `37446164020`. These repository and isolated-database results do not establish production readiness. Subsequent PR changes require checks for their own HEAD. Keep `FIRST_ADMIN_PHONE` restricted to approved bootstrap administrators; current production validation requires it to remain nonempty. Do not run the platform-admin grant for tenant admins or members.
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
