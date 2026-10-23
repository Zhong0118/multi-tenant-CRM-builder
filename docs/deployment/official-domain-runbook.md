# Official domain: crm.baijiehub.com

Moves the CRM from the public-IP entry (`https://62.234.18.169`, see [public-ip-runbook](public-ip-runbook.md)) to `https://crm.baijiehub.com`. The old IP keeps working as a permanent redirect to the domain. Nothing else changes: same server, same PostgreSQL, Redis, attachment and certificate volumes, same secrets, no schema migration.

`www.baijiehub.com` is reserved for the corporate website and `baijiehub.com` is the brand domain. Neither is served by this deployment. `admin.` and `erp.` subdomains are not configured.

## Preconditions (verified 2026-10-22)

| Check                | Result                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server public IP     | `62.234.18.169` (from the server itself)                                                                                                                                                                                 |
| DNS                  | `crm.baijiehub.com A 62.234.18.169`, no AAAA or CNAME; answered by the authoritative DNSPod servers (`deirdre`/`bathroom.dnspod.net`) and Google DNS. `baijiehub.com` and `www` also point at this IP but are not served |
| ICP filing           | `鲁ICP备2026063095号-1`, enterprise filing by 山东百杰网络科技有限公司, approved 2026-10-21 (public filing record). The official MIIT lookup (`beian.miit.gov.cn`) requires a CAPTCHA and was not queried automatically  |
| Access provider      | HTTP to `crm.baijiehub.com` on this Tencent Cloud server reaches Caddy (`Server: Caddy`), not Tencent's unfiled-domain block page                                                                                        |
| HTTPS before cutover | TLS alert: Caddy only has the IP certificate. Expected until the cutover                                                                                                                                                 |

Check DNS from the server or with DNS-over-HTTPS. A workstation behind a fake-IP proxy resolves to `198.18.x.x`, which is not the real answer.

## What changes

| Item                                                 | Before                                               | After                                             |
| ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Compose overlays                                     | `compose.production.yaml` + `compose.public-ip.yaml` | `compose.production.yaml` + `compose.domain.yaml` |
| Caddy config (bind mount)                            | `Caddyfile.public-ip`                                | `Caddyfile.domain`                                |
| `WEB_HOST`                                           | `62.234.18.169`                                      | `crm.baijiehub.com`                               |
| `WEB_ORIGIN`, `API_ORIGIN`, `NEXT_PUBLIC_API_ORIGIN` | `https://62.234.18.169`                              | `https://crm.baijiehub.com`                       |
| `HEALTH_URL`                                         | `https://62.234.18.169/api/v1/health`                | `https://crm.baijiehub.com/api/v1/health`         |
| `LEGACY_IP` (new)                                    | —                                                    | `62.234.18.169`                                   |
| `RELEASE_ID`                                         | current                                              | an image built for the domain origin (below)      |

Unchanged: `TRUSTED_PROXY_IP` (Caddy's fixed internal address), registration and SMS settings, database and Redis URLs, all volumes.

- **Session cookie:** host-only, `HttpOnly`, `Secure`, `SameSite=Lax`. It binds to the domain automatically. Everyone signs in once more after the switch; cookies set on the IP do not carry over.
- **CSRF and CORS:** the API accepts writes only from `WEB_ORIGIN`, so a single official origin is used. The IP entry redirects instead of serving the app.

`NEXT_PUBLIC_API_ORIGIN` is compiled into the browser bundle, so **an image built for the IP cannot serve the domain**. Changing runtime variables is not enough.

## Release steps

1. **Build** the `Internal Trial Image` workflow on the merged, CI-green `main` commit, with `web_origin=https://crm.baijiehub.com`. Download the artifact, check `sha256sum -c crm-images.tar.zst.sha256`, and check that `release-id.txt` equals the commit.
2. **Load only the app image.** The archive also contains `postgres`, `redis` and `caddy` images, and a plain `docker load` would retag the host's copies, which production containers would then use on their next recreate. Extract the `crm-app:<sha>` entry from `manifest.json` (its config and layer blobs) into a separate tar and load that. Then check the image architecture (`amd64`) and the `org.opencontainers.image.revision` label.
3. **Back up** into `backups/pre-domain-<UTC>/`:
   - `.env.internal-trial`, the `deploy/` directory and container mounts;
   - `pg_dump -Fc` and the `pg_restore --list` check;
   - the attachments volume (tar) and the Caddy `caddy_data` volume (tar, contains certificates and the ACME account);
   - the business row counts and digests.
4. **Place the files.** Copy `deploy/Caddyfile.domain` and `deploy/compose.domain.yaml` to the server's `deploy/`. Write the new environment through a temporary file (changed keys only), then run `compose --env-file .env.internal-trial -f deploy/compose.production.yaml -f deploy/compose.domain.yaml config --quiet`.
5. **Cut over:**
   ```sh
   sudo docker compose --env-file .env.internal-trial \
     -f deploy/compose.production.yaml -f deploy/compose.domain.yaml \
     up -d --no-deps --no-build --pull never api web caddy
   ```
   Only API, Web and Caddy are recreated, so the outage is seconds. Caddy obtains the domain certificate on start (HTTP-01 on port 80, TLS-ALPN on 443).
6. **Verify:**
   - `https://crm.baijiehub.com/`, `/login` and `/register` return 200 with a valid public certificate whose SAN contains `crm.baijiehub.com` (no `-k`);
   - `http://crm.baijiehub.com/*` redirects 308 to HTTPS;
   - `https://62.234.18.169/<path>` redirects 308 to the same path on the domain;
   - `/api/v1/health` and `/api/v1/health/ready` return 200;
   - API and Web run the new `RELEASE_ID`;
   - mounts and infrastructure container IDs are unchanged;
   - the environment is identical apart from the keys in the table;
   - business digests are unchanged;
   - a browser sign-in on the domain sets a `Secure` host-only cookie, and API calls, AI streaming, uploads and downloads go to the domain.

## Rollback

Restore the backed-up `.env.internal-trial`, then:

```sh
sudo docker compose --env-file .env.internal-trial \
  -f deploy/compose.production.yaml -f deploy/compose.public-ip.yaml \
  up -d --no-deps --no-build --pull never api web caddy
```

That brings back the previous image, the IP Caddyfile and the IP origin. The IP certificate stays in `caddy_data`, and no data volume is touched at any point. Keep `compose.public-ip.yaml` and `Caddyfile.public-ip` on the server until the domain has been validated.
