# 公网 IP HTTPS 内部试用

用户于 2026-10-08 明确授权启用公网 IP 直连。此模式替代 SSH 隧道入口；保留原账号、数据库、Redis、附件与备份，不代表完整公司业务验收已通过。

## 配置与镜像

私密 `.env.internal-trial` 设置以下公开地址，其余密钥和密码保持不变：

```dotenv
WEB_HOST=62.234.18.169
WEB_ORIGIN=https://62.234.18.169
API_ORIGIN=https://62.234.18.169
NEXT_PUBLIC_API_ORIGIN=https://62.234.18.169
HEALTH_URL=https://62.234.18.169/api/v1/health
```

Next.js 会把浏览器 API 地址编译进前端。必须运行 `Internal Trial Image` 工作流，选择已验收的源提交，并把 `web_origin` 设为 `https://62.234.18.169`。不能只更改运行时环境变量或继续使用 localhost 镜像。

`RELEASE_ID` 使用镜像源提交完整 SHA。下载镜像后核对 artifact 与镜像包的 SHA256、release-id.txt 和镜像 revision 标签，保留上一版本镜像及私密配置以便回退。

## 证书与端口

使用 `deploy/Caddyfile.public-ip` 显式指定 Let's Encrypt ACME issuer 和 `shortlived` profile。Caddy 的 IP 默认配置使用本地证书，不能代替这个显式配置。
同时设置 `default_sni` 为公网 IP，以支持浏览器直接访问 IP 时不发送 SNI 的 TLS 握手。

- 腾讯云安全组允许公网 TCP 80、443；SSH 22 保持现有配置。
- 80 用于 HTTP 跳转及 ACME 验证，443 用于 HTTPS。API、Web、PostgreSQL、Redis 均不直接发布端口。
- `caddy_data` 保存 ACME 账户、证书与私钥，必须持久保存，不得提交 Git。Caddy 自动管理短期证书续期，续期仍依赖端口连通和 ACME 网络可用。
- 正常浏览器无需导入本地测试 CA。验收不得使用 `-k` 或 `ignoreHTTPSErrors` 来掩盖公网证书错误。

依据：[Let's Encrypt IP 证书说明](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)、[Caddy ACME profile 配置](https://caddyserver.com/docs/caddyfile/directives/tls)。

## 切换

切换前备份数据库、附件及当前私密配置，确认源提交 CI 已通过。使用已有数据库，不再执行首次 provision 或重置。

```sh
sudo docker compose --env-file .env.internal-trial \
  -f deploy/compose.production.yaml -f deploy/compose.public-ip.yaml config --quiet
sudo docker compose --env-file .env.internal-trial \
  -f deploy/compose.production.yaml -f deploy/compose.public-ip.yaml \
  up -d --no-build --pull never api web caddy
```

不要同时叠加 `compose.internal-test.yaml`，该文件会把入口重新限制到服务器回环端口。

## 验收与回退

确认 HTTP 跳转 HTTPS；公网证书链验证通过且 SAN 包含目标 IP；health/ready 返回 200；浏览器实际登录并进入平台后台；认证 Cookie 保持 Secure/HttpOnly，浏览器请求不再访问 localhost。账号及数据库保持原有内容。

切换访问域名后需要重新登录，旧 localhost Cookie 不应跨主机复用。

若需回退，恢复切换前私密配置和旧 RELEASE_ID，使用 `compose.production.yaml` + `compose.internal-test.yaml` 重建 API/Web/Caddy，再按旧手册建立 SSH 隧道。不要删除任何数据卷。
