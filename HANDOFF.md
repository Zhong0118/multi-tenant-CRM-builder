# 多租户 CRM Builder 接手说明

截至 2026-11-22，主线参照 `848280b`。本地架构修复和验证见[独立复核](docs/audits/2026-11-22/architecture-reliability.md)。接手时用 `git status -sb` 和 `git log -1` 确认当前工作树与版本。2026-10-08 及以前的交接全文可用 `git show 848280b:HANDOFF.md` 查看，其中的 PR 状态、演示环境和临时授权均有日期。

## 从业务入口找到实现

| 要处理的业务 | 入口与约束 |
| --- | --- |
| 平台与公司 | 平台管理员开通公司、邀请首位管理员。公司管理员可手工建表或从业务模板初始化草稿。模板和公司特有规则在 `apps/api/src/modules/business-templates` 管理。 |
| 会话、成员与小组 | `WorkspaceGuard` 从会话和工作区解析成员。对象默认权限随发布生效，成员覆盖和小组成员关系即时生效。组员列规则可单独配置。[操作指南](docs/guides/group-record-field-access.md) |
| 对象与发布 | `objects` 管理草稿、发布分析、不可变快照和有效权限。业务对象按公司和对象代码定位，字段键在对象内唯一。成员读写使用当前发布，管理员通过设计入口管理草稿。 |
| 记录与公海 | `records` 管理列表、聚合、导入导出、编辑和归属。动态详情路由使用 `RecordDetailPage`。公海保护、编号、幂等和并发版本需要真实 PostgreSQL 验证。 |
| 跨表写入 | `workflows`、`actions`、`automations` 和 `record-relations` 共用动作与事务边界。改写入时一起检查业务行、版本、关系与审计。 |
| 工作台、工作和 AI | `dashboards` 管理组件配置与汇总，`work` 管理任务、目标和团队活动，`follow-ups` 管理记录跟进。AI 查询复用领域服务，AI 提议须在确认时重验权限并执行领域命令。 |

Web 通过 REST 调用 API。API 用受限角色和事务内租户上下文访问 PostgreSQL。数据库迁移使用单独的管理员连接。`apps/worker` 当前检查 Redis 连通性，业务写入及其审计在 API 事务链路完成。

## 本地运行与验证

- Node 24、pnpm 11.19.0、PostgreSQL 18、Redis。环境变量、迁移与启动命令见[项目 README](README.md#第一次启动)。
- 安装依赖后先构建内部包，运行 `pnpm --filter @crm/contracts --filter @crm/database build`。日常检查使用 `pnpm typecheck`、`pnpm test`、`pnpm contracts:check`、`pnpm build`。
- 变更租户、权限、写入或审计时，增加行为回归。在专用测试库运行 API E2E 和数据库集成，命令和连接名见[测试说明](README.md#常用命令)。两套测试会写入和清理数据，同库顺序运行。
- CI 定义见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。CI 基础设施与业务修复按主题单独提交。试用外部短信、AI 供应商以及生产环境需要各自的验收记录。
- 保留工作树里他人的修改与未跟踪文件，发布、推送与部署按当次授权执行。

## 领域语言和历史决策

[领域术语](CONTEXT.md) · [产品和设计索引](docs/design/README.md) · [架构决策](docs/adr/) · [历次验收](docs/audits/)
