# 公网 IP HTTPS 启用验收（已切换）

2026-10-08。用户明确授权启用 `https://62.234.18.169`，并确认已放行腾讯云入站 TCP 443。随后公网预检、正式切换与真实浏览器登录均通过。

## 已完成

- 公网配置 PR #31 已合并，主分支为 `7b53c653a00df5bdf5c413ff7960ef646000a0f3`。六项 required checks 均通过： https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/37744818698 。独立配置复核无阻塞。
- Linux amd64 镜像源提交 `cc8588908c524479ddf63ce2051b50e2142c42b8`，构建： https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/37744696051 。合并树相对镜像源仅验收文档两处措辞变化；应用和部署配置一致。
- 镜像已传入服务器并 docker load，ZIP 和内部 tar.zst 的 SHA256、release-id、amd64 与 revision 标签均验证通过。9 个前端 bundle 包含公网 origin，没有 bundle 包含旧 `https://localhost:3444`。
- Let's Encrypt 已签发 IP SAN 为 62.234.18.169 的证书。有效期 2026-10-08 06:30:45 UTC 至 2026-10-14 22:30:44 UTC；Caddy 使用 shortlived profile 和持久卷管理自动续期。
- 设置 default_sni 后，服务器本地无 SNI TLS 验证通过；经 SSH 转发使用公网 IP 作为 TLS 校验目标的 curl 返回 200，未使用 -k。
- 私密配置、数据库和附件分别备份到服务器 backups/pre-public-ip.env、pre-public-ip.dump、pre-public-ip-attachments.tar.gz，权限均为 0600；dump 目录和附件归档可读取。
- 公网配置通过 Compose config 验证后已写入服务器 `.env.internal-trial`（0600），使用 production + public-ip overlay 重建 API/Web/Caddy，未重建数据库与 Redis。本地私密配置同步更新，并保留切换前副本。

## 公网运行验证

- 放行 TCP 443 后，从本机公网直接请求 HTTPS 预检返回 200；未使用 SSH 转发、`-k` 或忽略证书错误。
- 临时 `crm-ip-https-preflight` 容器已删除，正式 Caddy 接管公网 80/443。HTTP 返回 308 并跳转 HTTPS。
- `/api/v1/health`、`/api/v1/health/ready` 均返回 HTTP 200 / ok；未登录 `/api/v1/me` 返回 401。
- 正常 Chrome 浏览器验证 TLS 1.3 / Let's Encrypt YE2，登录页 HTTP 200；既有账号密码登录后进入 `/platform`，`/me` 返回 200 且 isPlatformAdmin=true。
- 会话 Cookie 域为 62.234.18.169，Secure=true、HttpOnly=true、SameSite=Lax；捕获到的所有浏览器 API 请求 origin 均为 `https://62.234.18.169`。
- 1440 与 390 宽度均无横向溢出，无 pageerror；截图保存在本机 `/tmp/crm-internal-trial-review/screens/public-ip-admin-1440.png` 和 `public-ip-admin-390.png`，不包含密码或会话令牌。
- 当前镜像版本为 cc8588908c524479ddf63ce2051b50e2142c42b8，数据库与 Redis 容器未替换，原账号仍为平台超级管理员，公司列表为空。
- 旧镜像、数据卷和回退备份均保留。公网入口不再依赖 SSH 隧道；证书由持久化 Caddy 自动续期，80/443 应保持可达。

本次验证范围是公网入口、认证与基本页面。服务器上的公司开通、成员邀请、完整业务及 AI 操作、重置密码短信仍需后续验收，不能由本次登录成功推断全部通过。
