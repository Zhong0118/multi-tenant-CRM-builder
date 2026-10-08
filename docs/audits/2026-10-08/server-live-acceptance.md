# 内部服务器运行验收（首个平台管理员已启用）

2026-10-08；这是当前运行快照，后续公司业务验收完成后需继续更新。

- 首个账号手机号已由用户指定，仅在私密配置中保存；此项允许首个账号注册，不会自动授予平台管理员。用户回填真实短信验证码后，注册返回 201 / accepted。
- 短信补修 PR #30 已合并。运行镜像源提交：`f0632b7fa67db24f2463f16421d6c55d3807d487`；合并提交：`cf8f18a9bd9cefc364d711c0a6d15e021acea990`。
- [六项 CI](https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/37739090672) 和 [Linux amd64 镜像构建](https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/37739091010) 均通过；独立代码复核无阻塞问题。
- 新镜像 ZIP、镜像包均通过 SHA256 校验。API/Web 已替换，Caddy/PostgreSQL/Redis 正常运行；服务就绪检查返回 200 / ok。
- 内部入口通过 SSH 隧道访问 `https://localhost:3444`；服务器仅绑定 `127.0.0.1:8443`，未开放公网业务端口。curl 使用 Caddy 公共 CA 证书校验成功；普通浏览器信任尚需配置，自动化浏览器忽略内部证书错误不等于已完成系统信任。
- 登录页在 1440、390 宽度均返回 200，无横向溢出或 pageerror。未认证 `/api/v1/me` 返回 401；不可信 Origin 的 POST 返回 403。
- 首次真实短信请求因旧接口版本失败；补修部署后的同一路径返回 HTTP 202 / accepted。用户随后提供收到的验证码并成功完成注册，确认注册短信送达与验证链路通过。
- 数据库最新 challenge 为 PENDING、尝试次数 0，有效期实际为 600 秒；没有读取或打印验证码及其散列。
- 更新前备份权限 0600；成功恢复到独立测试数据库并核对 23 项迁移后删除测试库，没有覆盖运行库。
- 已通过正常短信注册、受审计的 `platform-admin:grant` CLI 授权：授权前平台 runtime-status 为 403，授权后为 200，`/me` 返回 isPlatformAdmin=true。
- 密码采用用户明确指定的值，符合当前十至七十二字符且包含字母、数字的规则；密码和验证码未写入本验收文档。使用该密码在浏览器登录成功并跳转 `/platform`，页面显示平台超级管理员；登录 Cookie 的 Secure、HttpOnly 为 true。
- 当前平台没有公司，没有导入本地历史演示数据。服务器上的完整公司业务与 AI 操作、密码重置短信仍未验收，不宣称所有流程已通。
- 首个管理员启用后另行生成备份 `backups/after-admin-bootstrap.dump`，权限 0600，并确认归档目录可读取。

## 已观察到的非阻塞样式问题

登录页深色介绍区的描述文字对比度不足：实际元素为 Ant Design Typography 的 `div`，样式规则却为 `.statementBody p`，导致该颜色规则不生效。浏览器计算颜色为 rgb(23,35,45)，背景为 rgb(22,37,50)。本轮未把此问题描述为已修复，应在下一次前端调整时改为明确的描述文字 class 并核对截图。

私密凭据与证书位于用户本机的 `~/.config/crm-internal-trial/`，不纳入仓库。初始凭据文件已更新为用户指定密码，账号已通过实际登录验收。

## 历史本地数据库盘点

以下本地库均未迁入服务器，服务器运行不依赖它们。本轮只读盘点，未停用、删除容器或删除卷。

| 容器 | 数据库 | 建议 |
| --- | --- | --- |
| crm-polish-postgres | crm_polish | 前端验收历史库，确认无需保留后备份清理 |
| crm-auth-f03-test-postgres | crm / crm_auth_final_test / crm_browser_review | 认证和浏览器历史验收库，可列入备份清理范围 |
| crm-v2-browser-postgres | crm_v2_browser | V2 浏览器历史验收库，可列入备份清理范围 |
| crm-v1b-isolated-test-postgres-v1b-test-1 | crm_v1b_test | AI V1B 隔离测试库，可列入备份清理范围 |
| multi-tenant-crm-postgres-1 | crm | 本地主开发环境，继续本地开发时仍可用 |
| multi-tenant-crm-test-postgres-test-1 | 已停止，未启动读取 | 旧集成测试环境；删除前需保留对应卷备份 |

服务器 crm-production-postgres-1、crm-production-redis-1 及部署备份应保留。paper-review-postgres 属于另一个项目，不属于 CRM 清理范围。清理历史测试库与删除服务器运行库是两件事，不能混用 `docker system prune --volumes` 一类全局清理命令。
