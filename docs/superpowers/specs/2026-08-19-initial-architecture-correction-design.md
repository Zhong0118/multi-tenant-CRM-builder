# Initial Architecture Correction Design

## 1. 背景与问题

现有初始化分支已经安装 Next.js、NestJS、Prisma、Worker 和相关依赖，但交付重点偏向运行示例与验证，缺少用户要求的页面路由、组件分区和后端领域模块骨架。整改目标是先建立可浏览、可扩展的工程结构，不提前实现注册、权限、动态记录 CRUD 或首家公司业务逻辑。

整改完成并通过验证后，分支合并到 `main`，随后删除本次 worktree 和临时分支。

## 2. 采用方案

采用“页面路由 + 业务领域模块”组织方式：

- Web 以 Next.js App Router 路由分组表达登录、独立账号、平台后台和租户工作区。
- Web 可复用代码分为 `components`、`features`、`lib` 和 `types`。
- API 以 NestJS 领域模块表达身份、租户、配置、记录及平台能力。
- Worker 只建立任务、队列、处理器和基础设施边界，不注册具体业务队列。
- 共享包保留数据库包，并增加跨应用契约和租户模板包。

不采用只有 `components/services/utils` 的扁平结构，也不引入完整 Clean Architecture、CQRS 或微服务拆分。

## 3. Web 目录与路由

```text
apps/web/src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (account)/
│   │   ├── waiting/page.tsx
│   │   └── workspaces/page.tsx
│   ├── (platform)/platform/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── tenants/page.tsx
│   │   ├── templates/page.tsx
│   │   ├── jobs/page.tsx
│   │   ├── audit/page.tsx
│   │   └── settings/page.tsx
│   ├── (workspace)/workspace/[tenantCode]/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── objects/[objectCode]/page.tsx
│   │   ├── statistics/page.tsx
│   │   ├── members/page.tsx
│   │   ├── import-export/page.tsx
│   │   ├── audit/page.tsx
│   │   └── settings/page.tsx
│   ├── error.tsx
│   ├── layout.tsx
│   ├── not-found.tsx
│   └── page.tsx
├── components/
│   ├── data-table/
│   ├── feedback/
│   ├── forms/
│   ├── layout/
│   ├── navigation/
│   └── ui/
├── features/
│   ├── auth/
│   ├── members/
│   ├── objects/
│   ├── records/
│   └── tenants/
├── lib/
│   ├── api/
│   ├── auth/
│   ├── env/
│   └── query/
└── types/
```

Next.js 的 `app` 目录本身就是页面和路由定义，不另建传统 Pages Router 的 `pages/`。业务 REST 接口由 NestJS 提供，因此 Web 不建立重复的业务 Route Handlers。

所有页面仅提供页面名称、用途说明和“功能尚未实现”状态。根页面重定向至 `/login`。平台与工作区布局提供最小导航边界，但不接入真实会话或数据。

## 4. API 目录与模块

```text
apps/api/src/
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   └── pipes/
├── config/
├── infrastructure/
│   ├── database/
│   └── queue/
├── modules/
│   ├── audit/
│   ├── auth/
│   ├── dashboards/
│   ├── fields/
│   ├── health/
│   ├── imports/
│   ├── integrations/
│   ├── invitations/
│   ├── memberships/
│   ├── objects/
│   ├── permissions/
│   ├── records/
│   ├── tenants/
│   ├── users/
│   └── views/
├── app.module.ts
└── main.ts
```

每个业务模块建立 `<name>.module.ts`、`<name>.controller.ts`、`<name>.service.ts` 和 `dto/` 边界。Controller 只声明路由前缀，不提供虚假的成功响应；Service 只作为依赖注入边界，不实现业务方法。现有健康检查移动至 `modules/health` 并继续提供真实接口。

`common` 和 `infrastructure` 的空边界通过说明文件保留，不创建无意义的装饰器或数据库封装。API 仍然是唯一业务接口和数据库访问入口。

## 5. Worker 与共享包

Worker 结构：

```text
apps/worker/src/
├── config/
├── infrastructure/
├── jobs/
├── processors/
├── queues/
└── main.ts
```

保留当前 Redis 配置校验和优雅退出；代码移动到对应边界。`jobs`、`processors` 和 `queues` 仅记录职责与导出入口，不创建虚假任务。

共享包结构：

```text
packages/
├── contracts/
│   └── src/
│       ├── auth/
│       ├── objects/
│       ├── records/
│       └── tenants/
├── database/
└── tenant-templates/
    └── src/
        ├── generic/
        └── first-company/
```

`contracts` 只建立稳定 DTO/类型输出边界；当前不定义未经业务实现验证的字段。`tenant-templates` 建立通用模板与首家公司模板分层，不在本次填入模板业务配置。

## 6. 删除与保留

删除：

- Next.js 默认 SVG 图片和子项目默认 README。
- 自行设计的“架构就绪”展示首页及其专用样式和测试。
- 本次失败安装产生的根目录 `.pnpm-store/`。
- `.next/`、`dist/` 等构建产物。
- 完成合并后的 `.worktrees/codex` 与 `codex/initial-architecture` 分支。

保留：

- pnpm workspace、锁文件和依赖配置。
- Next.js、NestJS、Worker、Prisma 的有效运行配置。
- Ant Design、TanStack Query、React Hook Form、Zod 等已确认依赖。
- API 健康检查、Prisma 核心 schema 和 Worker 配置校验。
- 产品设计文档与原始 `chat会话.md`；后者不纳入 Git。

## 7. 验收标准

1. `main` 根目录直接包含 `apps/`、`packages/`、`compose.yaml` 和 workspace 配置。
2. 上述 Web 路由、组件分区、Feature 分区、API 模块和 Worker 分区均存在。
3. Web 不导入数据库包或读取 `DATABASE_URL`。
4. 除健康检查外，不存在假业务接口或假数据成功响应。
5. 页面只提供中性空壳，不实现业务流程。
6. 冻结锁文件安装、格式检查、Lint、类型检查、测试、构建、Prisma 校验和 Compose 校验通过。
7. 合并完成后工作区无 `.pnpm-store`、`.next`、`dist` 或残留 worktree。
