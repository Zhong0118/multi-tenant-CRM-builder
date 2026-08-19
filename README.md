# Multi-tenant CRM Builder

面向多家公司的可配置 CRM 平台。当前仓库采用 pnpm monorepo，Web、API、Worker 分进程部署；API 与 Worker 可以访问数据库包，Web 只调用 REST API。

完整产品与架构设计见 [`docs/design/README.md`](docs/design/README.md)，本次脚手架实施记录见 [`docs/superpowers/plans/2026-08-19-initial-architecture.md`](docs/superpowers/plans/2026-08-19-initial-architecture.md)。

## 工程结构

```text
apps/
├── web/                         Next.js 16 + React 19 + Ant Design
│   └── src/
│       ├── app/
│       │   ├── (auth)/          登录、注册
│       │   ├── (account)/       待加入公司、工作区选择
│       │   ├── (platform)/      平台管理员页面
│       │   └── (workspace)/     公司工作区与动态对象页面
│       ├── components/          layout、table、form、feedback、ui
│       ├── features/            auth、tenant、member、object、record
│       ├── lib/                 API、认证、环境、查询基础设施
│       └── types/               Web 层类型出口
├── api/                         NestJS 11 REST API 与 OpenAPI
│   └── src/
│       ├── modules/             auth、tenant、membership、object、record 等领域
│       ├── common/              guard、filter、pipe、interceptor、decorator
│       ├── infrastructure/      database、queue 等外部设施适配边界
│       └── config/              API 配置边界
└── worker/                      BullMQ/Redis 异步任务进程
    └── src/
        ├── config/              Worker 配置
        ├── jobs/                任务定义
        ├── queues/              队列注册
        ├── processors/          任务处理器
        └── infrastructure/      外部设施适配边界
packages/
├── database/                    Prisma 7 schema 与 PostgreSQL 客户端工厂
├── contracts/                   跨应用共享的通用平台契约
└── tenant-templates/            通用模板与首家公司业务模板
docs/                            产品、页面、数据模型和技术设计
```

Web 只通过 API 获取业务数据；`packages/database` 仅供 API 与 Worker 使用。通用平台契约与特定公司模板分包，防止首家公司的流程进入平台核心。

## 环境要求

- Node.js `>=20.9`
- pnpm `11.19.0`
- Docker Desktop 或兼容的 Docker Compose（用于 PostgreSQL 18 和 Redis）

如果当前 Codex 终端没有直接暴露 Node/pnpm，可使用内置运行时：

```bash
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
node --version
pnpm --version
```

## 第一次启动

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d
pnpm --filter @crm/database prisma:generate
pnpm dev
```

开发地址：

- Web：<http://localhost:3000>
- API 健康检查：<http://localhost:3001/api/v1/health>
- OpenAPI（非生产环境）：<http://localhost:3001/api/docs>

根目录 `.env` 由 API、Worker 和 Prisma 配置分别加载。Web 不加载该文件，也不得导入 `@crm/database`、`@prisma/client` 或读取 `DATABASE_URL`。

## 常用命令

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm --filter @crm/api test:e2e
pnpm --filter @crm/database prisma:validate
docker compose config
```

停止本地基础设施：

```bash
docker compose down
```

只有在明确需要删除本地数据库和 Redis 数据时，才执行 `docker compose down --volumes`。

## 当前边界

本里程碑提供可运行的工程基础、完整页面/模块目录边界、健康接口、核心多租户 schema 和 Worker 运行时。页面目前是架构占位，不伪造业务数据；注册登录、租户权限、动态记录 CRUD、飞书与电话 Bot 将按照设计文档在后续里程碑实现。
