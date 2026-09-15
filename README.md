# Multi-tenant CRM Builder

面向多家公司的可配置 CRM 平台。当前仓库采用 pnpm monorepo，Web、API、Worker 分进程部署；API 与 Worker 可以访问数据库包，Web 只调用 REST API。

完整产品与架构设计见 [`docs/design/README.md`](docs/design/README.md)。**当前实现事实以 [`HANDOFF.md`](HANDOFF.md) 为准**，这里不重复维护状态。

`docs/audits/` 下是历史验收记录，其中 [2026-09-09 三角色补齐与验证](docs/audits/2026-09-09/role-completion.md) 记录的是三角色功能补齐阶段；其后的修复与人工验收都已汇总进 `HANDOFF.md`。设计规格分别覆盖账号邀请、动态对象记录、平台模板和组件化工作台；旧设计索引可能落后于本地 `main`。

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

- Node.js `>=24`（本地验证版本 24.19.0）。`@crm/database` 是 ESM 包而 `apps/api` 编译为 CJS，需要支持 `require(esm)` 的 Node；若要在 Node 22 LTS 上运行，先实测再放宽 `package.json` 的 `engines`。
- pnpm `11.19.0`
- PostgreSQL 15+（本机服务或 Docker 均可；当前本地验证使用 PostgreSQL 15）
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

拉取新代码后先把迁移应用到本地开发库，否则新表和新列缺失会让接口直接 500：

```bash
set -a && source .env && set +a
pnpm --filter @crm/database prisma:migrate:deploy
```

集成测试与 API E2E 使用独立的测试库（`compose.test.yaml`，端口 5433），需要先启动：

```bash
docker compose -f compose.test.yaml up -d
```

停止本地基础设施：

```bash
docker compose down
```

只有在明确需要删除本地数据库和 Redis 数据时，才执行 `docker compose down --volumes`。

## 租户管理员配置业务对象

配置保存为草稿，只有**发布**后才影响成员当前使用的表单、权限和导航。

1. 进入 `设置 → 业务对象 → 新建业务对象`，填写名称与小写代码（如 `customers`）。
2. 在设计器的「字段」页添加字段。对象必须有一个必填标题字段，类型只能是 `TEXT`、`PHONE`、`EMAIL` 或 `SINGLE_SELECT`。
3. 「列表视图」选择默认列与排序；「员工权限」配置动作、数据范围和每个字段的访问级别。
4. 点「发布变更」先看影响面板：存在阻断项时无法确认；警告项需要知情后确认。
5. 发布成功后对象才出现在成员的「业务对象」导航中。

运行时字段类型固定为 12 种：

`TEXT`、`TEXTAREA`、`PHONE`、`EMAIL`、`NUMBER`、`MONEY`、`DATE`、`DATETIME`、`SINGLE_SELECT`、`MULTI_SELECT`、`MEMBER`、`BOOLEAN`。

需要注意的发布约束：

- 字段 `fieldKey` 和已发布字段的**类型不可再改**，只能调整标签、校验、选项和访问级别。
- 已有历史记录时，新增字段只能先以非必填发布。
- 选项 key 发布后稳定；已被记录使用的选项只能停用，不能删除或改写含义。
- 成员访问页的**成员覆盖立即生效**，而对象设计器里的员工默认权限**需要发布后生效**。

## 当前实现边界

最新完成项与未完成项见 [`HANDOFF.md`](HANDOFF.md)。下面保留对象/记录切片的实现要点；其后又落地了平台模板、组件化多工作台、类型化记录筛选和公司生命周期 UX。

已完成第一个“账号、邀请与工作空间”切片：手机号注册/登录/找回密码、服务端会话、平台管理员授权、租户开通、首位管理员邀请、成员邀请与停用、等待页、工作空间选择、租户隔离、OpenAPI 契约及对应页面。

已完成第二个“对象、字段、权限与动态记录”切片：

- 不可变对象发布快照（`object_publications`）与草稿乐观锁；发布只记录哪一版生效，不消耗草稿版本。
- 12 种动态字段类型的服务端统一校验、标题派生、`MONEY` 定点字符串规范化。
- 对象动作权限、`ALL/OWN/NONE` 数据范围、`EDIT/READ_ONLY/HIDDEN` 字段权限；隐藏字段不出现在 schema 与响应中，伪造写入被拒绝。
- 成员对象覆盖实时生效，不改变发布快照中的字段权限。
- 事务内行锁分配连续 `recordNo`、记录乐观锁、软删除、审计。
- 配置账本对象设计器、动态记录列表/表单/详情抽屉、成员访问权限页、发布对象驱动的工作空间导航。
- PostgreSQL RLS 强制租户隔离；跨租户对象与记录统一返回 not-found，不泄露资源存在性。

自动化验证覆盖：Web 单元/组件测试、API 单元测试、PostgreSQL 集成测试（RLS、发布快照不可变、record counter 并发）、API E2E（配置→发布→运行时链路、记录权限、并发编号、版本冲突）、OpenAPI 契约漂移。当前不引入 Playwright。

尚未实现（留待后续切片）：对象关系、记录转换与状态机、公式/汇总/查找字段、附件与文件存储、看板与日历、个人自定义视图、发布版本回滚、真实短信。记录活动时间线、CSV 导入导出、批量修改和个人跟进待办（改期、完成、取消、逾期筛选）已实现。主动通知和团队派单尚未接入，短信与 AI 按当前安排后置。Dashboard 与图表已经以组件化工作台形式落地。首家公司线索、跟单、客户和期刊规则不得写死进通用平台核心。

## 人工验收清单

自动化测试覆盖不到浏览器交互，请按顺序跑一遍：

```text
管理员创建对象 → 添加标题/普通/只读/隐藏字段 → 配置员工 OWN 权限
→ 发布 → 管理员创建并编辑记录 → 员工登录验证导航、OWN、只读、隐藏
→ 管理员在成员访问页改为 NONE 覆盖并确认立即失效 → 恢复继承
```

预期结果：员工只看到获准对象；标题显示“我的{对象名}”；隐藏字段在列表、详情和表单中都不存在；只读字段显示正常文本与“仅管理员可编辑”；改为 `NONE` 覆盖后员工下一次请求即失去访问，无需重新发布。
