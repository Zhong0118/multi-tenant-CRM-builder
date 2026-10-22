# 字段生命周期上线记录

时间：2026-10-20（北京时间约 18:04）

## 发布版本

- GitHub 分支：`codex/generic-pool-lifecycle`
- 发布提交：`9136cdc2c1e6e634ea0690396c1c9f6a7ec95ed9`
- 内容：字段停用/恢复、历史发布字段类型保护、默认展示/搜索引用清理、字段与表单及列表展示与搜索说明。
- [CI 39402056878](https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/39402056878)：Contracts、Typecheck、Unit Tests、Build、Critical API E2E、Database Integration 全部成功。
- [镜像构建 39402101325](https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/39402101325)：成功，Linux amd64，镜像 revision 与提交一致。
- 当前生产入口继续使用 `https://62.234.18.169`。本次未切换域名，未合并 main。

## 数据与配置保护

服务器工作目录：`/home/ubuntu/crm-internal-test`。
备份位置：`backups/pre-fields-20261020T100350Z`，包括数据库 custom dump、附件归档、环境配置、Compose/Caddy 配置及数据摘要；私密配置不进入 Git。

本次没有数据库迁移。停止 API 写入后，对 public 业务表逐表比较行数和完整行摘要，切换前一致。数据库包含 3149 条业务记录；完成迁移数保持 33；切换时站内消息 2 条。恢复服务后正常业务和定时任务可能继续产生数据。

仅重建 API/Web；PostgreSQL、Redis、Caddy 的容器标识和卷保持不变；API/Web 附件挂载不变。环境配置除 RELEASE_ID 外逐行一致。保留公开注册、腾讯云短信配置，没有真实发送短信或调用 AI。

## 验证

- 外网 `/api/v1/health/ready` 返回 ok；`/`、`/login`、`/register` 均为 HTTP 200。
- API/Web 运行镜像均为 `crm-app:9136cdc2c1e6e634ea0690396c1c9f6a7ec95ed9`。
- 通过真实有效的管理员/员工上下文，数据库只读事务检查 13 次业务表导航/配置解析、3 个成员上下文的消息列表/数量/快照、收件人与租户隔离、1 个可读消息跳转、未知消息 404 和未登录 401。
- 已部署 Web 产物包含字段停用/恢复入口和新名称，同时保留批量分配、导入负责人、分页、AI 锚点、权限与站内消息组件。
- 探针中 pg 驱动提示同一连接并行 query 的既有弃用警告，检查均完成；本次未调整该独立连接使用方式。
- 本地预发布 Objects / Record Value Engine：10 suites / 374 tests；Web Objects / Templates：12 files / 131 tests；类型检查及独立 PostgreSQL 字段完整生命周期测试已通过。

## 后续边界

整张业务表停用/恢复随后在本地实施。该功能及其新增数据库迁移不包含在上述生产版本，不自动随开发同步服务器。
