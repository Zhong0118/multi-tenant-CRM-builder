# Multi-tenant CRM Builder

面向多家公司的可配置 CRM 平台。当前仓库采用 pnpm monorepo，Web、API、Worker 分进程部署；API 与 Worker 可以访问数据库包，Web 只调用 REST API。

完整产品与架构设计见 [`docs/design/README.md`](docs/design/README.md)。首个“账号、邀请与工作空间”业务切片已经实现，设计事实来源见 [`docs/superpowers/specs/2026-08-20-account-invitation-workspace-design.md`](docs/superpowers/specs/2026-08-20-account-invitation-workspace-design.md)。

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
- PostgreSQL 18（本机服务或 Docker 均可）
- Redis 7.4（本机服务或 Docker 均可）
- Docker Desktop 或兼容的 Docker Compose（可选，仅用于快速启动隔离基础设施）

如果当前 Codex 终端没有直接暴露 Node/pnpm，可使用内置运行时：

```bash
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
node --version
pnpm --version
```

## 第一次启动

### 方式一：使用 Docker 启动 PostgreSQL 和 Redis

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d
pnpm --filter @crm/database prisma:generate
pnpm --filter @crm/database prisma:migrate:deploy
pnpm dev
```

### 方式二：使用本机 PostgreSQL 和 Redis

数据库名不要求叫 `crm`，可以使用 `baijie` 等名称；`crm_app` 是 API/Worker 使用的受限运行时角色，不是数据库名。先用本机 PostgreSQL 管理员账号创建数据库和角色：

```sql
CREATE DATABASE baijie;
CREATE ROLE crm_app LOGIN PASSWORD '请替换为本地密码'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE baijie TO crm_app;
```

连接到 `baijie` 后执行：

```sql
GRANT USAGE ON SCHEMA public TO crm_app;
```

在根目录 `.env` 中填写管理员迁移连接和应用运行连接，例如：

```dotenv
DATABASE_ADMIN_URL=postgresql://zhongxu:管理员密码@localhost:5432/baijie
DATABASE_URL=postgresql://crm_app:应用密码@localhost:5432/baijie
REDIS_URL=redis://localhost:6379
```

确认本机 Redis 已启动后执行：

```bash
pnpm install --frozen-lockfile
pnpm --filter @crm/database prisma:generate
pnpm --filter @crm/database prisma:migrate:deploy
pnpm dev
```

开发地址：

- Web：<http://localhost:3000>
- API 健康检查：<http://localhost:3001/api/v1/health>
- OpenAPI（非生产环境）：<http://localhost:3001/api/docs>

根目录 `.env` 由 API、Worker 和 Prisma 配置分别加载。Web 不加载该文件，也不得导入 `@crm/database`、`@prisma/client` 或读取 `DATABASE_URL`。

本地 `DEV_VERIFICATION_CODE` 是固定开发验证码，只能用于本地/测试环境；生产环境必须配置真实短信发送适配器，API 不会返回或记录验证码。

## 初始化平台管理员

先通过注册页创建并验证手机号账号，再执行幂等授权命令：

```bash
set -a
source .env
set +a

pnpm --filter @crm/api platform-admin:grant -- \
  --phone 15562266465 \
  --reason "初始化本地平台管理员"
```

数据库角色（如 `zhongxu`、`crm_app`）只负责连接 PostgreSQL，不是网站登录账号。网站平台管理员必须先是 `users` 表中已验证、状态正常的用户。

## 常用命令

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm contracts:check
pnpm --filter @crm/api test:e2e
pnpm --filter @crm/database test:integration
pnpm --filter @crm/database prisma:validate
docker compose config
```

停止本地基础设施：

```bash
docker compose down
```

只有在明确需要删除本地数据库和 Redis 数据时，才执行 `docker compose down --volumes`。

## 当前实现边界

已完成第一个“账号、邀请与工作空间”切片：手机号注册/登录/找回密码、服务端会话、平台管理员授权、租户开通、首位管理员邀请、成员邀请与停用、等待页、工作空间选择、租户隔离、OpenAPI 契约及对应页面。单元、数据库集成和 API E2E 已自动化；完整浏览器流程已由项目负责人在本地人工验收，当前不引入 Playwright。

下一实施切片是“对象、字段、权限与动态记录 CRUD”。本切片将把现有 `object_definitions`、`field_definitions`、`records` 数据骨架和 `/workspace/[tenantCode]/objects/[objectCode]` 占位页升级为可配置、可授权、可实际录入和查询记录的平台能力。首家公司线索、跟单、客户和期刊模板仍放在第三个切片，避免把百杰业务规则写死进通用平台核心。
