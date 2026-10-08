# 无域名内部测试环境

2026-10-08：用户已授权修复、整合、通过验收后合并，并部署内部测试环境。
此授权取代旧交接文档中针对先前轮次的“禁止合并/部署”；不代表正式对外上线。

## 访问方式

服务器运行 Ubuntu 24.04、Docker Engine 和 Compose。测试覆盖生产模式的
API、Web、PostgreSQL、Redis、Caddy，通过 SSH 访问，不发布业务端口到公网。

配置使用 `.env.internal-trial`，必须保持权限 0600，不提交 Git、不放入镜像：

```dotenv
WEB_HOST=localhost
WEB_ORIGIN=https://localhost:3444
API_ORIGIN=https://localhost:3444
NEXT_PUBLIC_API_ORIGIN=https://localhost:3444
HEALTH_URL=https://localhost:3444/api/v1/health
```

`WEB_HOST` 不带端口：Caddy 在容器的 443 端口监听。测试 overlay 只发布
服务器的 `127.0.0.1:8443`。浏览器 origin 是本机隧道端口 3444。
`PUBLIC_REGISTRATION_ENABLED=false`，`FIRST_ADMIN_PHONE` 只填写用户确认的手机号。
短信和 AI 密钥、数据库及 Redis 密码均为运行时私密配置。

从测试电脑建立隧道：

```sh
ssh -N -L 127.0.0.1:3444:127.0.0.1:8443 crm-beijing
```

然后访问 `https://localhost:3444`。Caddy 为 localhost 使用内部 CA，测试电脑需要
导入并信任该 CA 的公钥证书。不要复制 CA 私钥，也不要关闭项目的 HTTPS 校验。
浏览器自动化可以在隔离上下文中忽略测试证书错误，但这不等于普通浏览器已信任证书。

## 镜像与启动

GitHub 的 `Internal Trial Image` 工作流使用 Linux amd64 构建，并打包应用、
PostgreSQL、Redis、Caddy 镜像。手动运行时必须选择已验收的提交和正确 origin。
首次 PR 通过工作流路径过滤触发构建；后续按需手动运行，不为普通提交重复打包。
构建不携带私密配置，镜像标签使用源代码完整 SHA，artifact 保留三天。

下载 `crm-internal-trial-images` artifact，校验 SHA256，使用 SSH 上传到服务器：

```sh
sha256sum -c crm-images.tar.zst.sha256
zstd -dc crm-images.tar.zst | sudo docker load
```

部署目录中放置同版本的 `deploy/`、`scripts/deployment/`、
`infrastructure/postgres/init/` 和私密 `.env.internal-trial`。
将 `RELEASE_ID` 设为 `release-id.txt` 中的 SHA。

```sh
crm_compose() {
  sudo docker compose --env-file .env.internal-trial \
    -f deploy/compose.production.yaml -f deploy/compose.internal-test.yaml "$@"
}
crm_compose config --quiet
crm_compose up -d --wait postgres redis
crm_compose run --rm provision
crm_compose run --rm --no-deps migrate
crm_compose up -d --no-build api web caddy
```

首次创建空数据库时 provision 和 migrate 按上面顺序执行。不要对已有业务数据库
盲目重置、重新初始化或删除卷。后续更新需要先备份数据库和附件，执行迁移后
替换应用容器；保留旧镜像以便回退，数据库迁移不承诺自动回滚。

## 验收边界

- 先通过代码测试、CI 和本地浏览器验收，再部署测试环境。
- 服务端检查存活及数据库/Redis readiness，再检查浏览器真实登录 Cookie。
- 手机号和模板状态经用户确认后，才发送真实短信；注册、重置验证码有效期为十分钟。
- 首个账号通过正常短信注册后，使用受审计的 `platform-admin:grant` CLI 授权。
- 真实 AI 检查流式输出、CRM 数据工具和错误处理，模拟 Provider 结果不能替代。
- 记录实际执行结果和未完成项；无域名内部测试通过不等于正式上线验收通过。

## 已知基线限制

API 全仓 lint 在系统基线和整合分支均有 434 个既有错误、13 个 warning；
不在本轮 Redis 修改文件中。Web lint 无错误，有一条既有导航 warning。
六项 required CI 不包含全仓 lint；本轮不把全仓 lint 声称为通过。
