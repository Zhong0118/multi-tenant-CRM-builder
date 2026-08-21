# 账号、邀请与工作空间闭环设计

版本：1.0
日期：2026-08-20
状态：已实现；2026-08-21 人工浏览器验收通过

## 1. 目标

在现有多租户 CRM 工程骨架上完成第一个可运行、可验收的端到端业务切片：用户通过手机号注册和登录，查看并接受租户邀请，随后进入自己有权访问的工作空间；租户管理员可以邀请、重发、撤销和停用本公司成员。

这个切片同时验证身份、会话、邀请、成员关系、租户上下文、数据库隔离、前端路由和审计。它是后续动态对象、记录权限及首家公司业务闭环的安全基础。

## 2. 已确认决策

### 2.1 开发方式

采用端到端业务切片，不先铺开全部页面，也不先实现设计文档中的全部数据表。每个切片同时完成对应的数据模型、迁移、API、页面、测试和文档。

后续切片顺序固定为：

1. 账号、邀请与工作空间。
2. 对象、字段、权限与动态记录 CRUD。
3. 首家公司线索、跟单和客户转换。
4. Dashboard、导入导出、审计扩展与集成框架。

### 2.2 认证方式

- 手机号验证码注册。
- 手机号加密码登录。
- 手机验证码找回密码。
- 邮箱只作为可选联系资料，不参与首期注册、登录或找回密码。
- 租户管理员只能邀请员工，不能替员工设置、查看或重置密码。

### 2.3 工作空间路由

租户页面统一使用 `/workspace/[tenantCode]/*`。`tenantCode` 是工作空间定位参数，不是授权凭据。API 必须根据当前登录 User、TenantMember 状态和 Tenant 状态创建服务端 `TenantContext`。

## 3. 范围

### 3.1 本切片包含

- 注册验证码、注册、登录、退出、找回密码和重置密码。
- 可撤销的服务端会话与账号安全页面。
- 独立用户等待页面。
- 本人邀请列表、邀请详情、接受和拒绝。
- 单工作空间自动进入和多工作空间选择。
- 平台管理员创建租户、发出首位租户管理员邀请并控制租户启用状态。
- 通过本机管理命令幂等授予首位平台管理员权限。
- 工作空间首页的已认证外壳。
- 租户管理员的成员列表、邀请、重发、撤销和停用。
- 数据库迁移、RLS、租户上下文、审计和跨租户测试。
- OpenAPI 契约及 Web 生成客户端。

### 3.2 本切片不包含

- 动态对象设计器和字段发布。
- 业务记录 CRUD、活动、转换和 Dashboard。
- 首家公司线索、跟单、客户和期刊功能。
- 飞书、电话 Bot、文件导入导出和对象存储。
- 邮箱登录、邮箱验证、换绑手机号和自行创建租户。

未在本切片实现的现有页面继续显示明确的架构占位，不使用模拟业务数据伪装为已完成能力。

## 4. 系统架构

```text
Next.js Web
    ↓ REST / OpenAPI
NestJS API
    ├── Auth
    ├── Invitations
    ├── Tenancy
    ├── Memberships
    └── Audit
          ↓
PostgreSQL
```

- Web 不导入数据库包，不在 Next.js Route Handler 中实现业务领域入口。
- Controller 只负责协议、DTO 和响应映射。
- Application Service 编排事务和用例。
- Policy 负责邀请、成员和会话规则。
- Repository 只能使用经过 Guard 验证的身份或租户上下文。
- PostgreSQL 是身份、成员关系和审计的主数据源。

## 5. 正式页面路由

### 5.1 公共与账号

| 路由 | 用途 |
|---|---|
| `/register` | 手机号验证码注册 |
| `/login` | 手机号和密码登录 |
| `/forgot-password` | 手机验证码找回并重置密码 |
| `/waiting` | 无活动成员关系用户查看本人邀请 |
| `/invitations/[invitationId]` | 查看、接受或拒绝本人邀请 |
| `/workspaces` | 多工作空间选择 |
| `/account/security` | 修改密码、查看和撤销会话 |

### 5.2 平台后台

```text
/platform
/platform/tenants
/platform/tenants/new
/platform/tenants/[tenantId]
/platform/templates
/platform/jobs
/platform/audit
/platform/settings
```

### 5.3 租户工作空间

```text
/workspace/[tenantCode]
/workspace/[tenantCode]/members
/workspace/[tenantCode]/objects/[objectCode]
/workspace/[tenantCode]/statistics
/workspace/[tenantCode]/import-export
/workspace/[tenantCode]/audit
/workspace/[tenantCode]/settings
```

## 6. 页面流转

登录成功后的服务端决策顺序为：

```text
存在安全的 returnTo 且用户有权访问 → returnTo
没有活动成员关系                 → /waiting
只有一个活动工作空间             → /workspace/[tenantCode]
存在多个活动工作空间             → /workspaces
```

`returnTo` 只允许站内相对路径，并在跳转前重新验证访问权，禁止开放重定向。

邀请深链接流程：

```text
打开邀请链接
→ 未登录：跳转 /login 并保留 returnTo
→ 已登录：只读取本人邀请
→ 展示租户、角色、邀请人和有效期
→ 接受或拒绝
→ 接受成功后按工作空间数量跳转
```

## 7. 第一阶段数据模型

### 7.1 模型范围

第一阶段正式纳入迁移和上线验收的模型为：

- `users`
- `verification_challenges`
- `sessions`
- `tenants`
- `tenant_invitations`
- `tenant_members`
- `audit_logs`

现有 `object_definitions`、`field_definitions` 和 `records` 保留为后续切片的设计骨架，但在对应迁移、权限和集成测试完成前不视为可上线模型。

### 7.2 身份约束

- `users.phone` 保存规范化手机号，首期只接受中国大陆手机号并存为 `+86` E.164 格式。
- `users.phone` 唯一；`email` 可空且不参与首期认证。
- 验证码只保存哈希、用途、状态、尝试次数、请求 IP、过期和消费时间。
- Session 只保存高熵令牌的哈希，支持过期、最后使用时间和撤销时间。
- 密码修改撤销当前会话之外的全部会话；用户停用撤销全部会话。

### 7.3 租户与邀请约束

- `(tenant_id, user_id)` 在 `tenant_members` 中唯一。
- `(tenant_id, id)` 为租户内复合外键提供目标唯一键。
- 同一租户、同一规范化手机号同时最多存在一个 `PENDING` 邀请，使用 PostgreSQL 部分唯一索引实现。
- 邀请码只保存哈希，具有过期时间和一次性消费语义。
- 接受邀请必须匹配当前 User 的已验证手机号。
- 接受邀请在单个数据库事务内锁定邀请、复查状态、创建或恢复成员、更新邀请并追加审计。
- 并发或重复接受返回同一个最终成员结果，不产生重复成员。
- 平台管理员创建租户时，在一个事务中创建 `DRAFT` Tenant 和首位 `TENANT_ADMIN` 邀请，不替管理员创建 User 或密码。
- `tenants.code` 保存小写字母、数字和连字符，创建后不可修改并全局唯一。
- 首位管理员可以在 Tenant 为 `DRAFT` 时接受邀请，但工作空间只有在平台管理员确认至少存在一个活动租户管理员并将 Tenant 设为 `ACTIVE` 后才可进入。

### 7.4 审计约束

`audit_logs` 记录操作者类型和标识、租户、动作代码、资源类型和标识、脱敏前后差异、原因、请求 ID、IP 和创建时间。应用不提供更新或删除审计日志的普通接口。

第一阶段至少审计注册、登录结果、登出、密码重置、会话撤销、邀请创建/重发/撤销/接受/拒绝、成员角色修改、成员停用和租户上下文拒绝。

## 8. 数据库上下文与 RLS

数据库事务使用两个不可由请求体直接覆盖的上下文：

```text
app.user_id
app.tenant_id
```

- `users`、验证码和登录查询属于平台身份数据，不使用租户 RLS；Repository 不提供列表或任意手机号查询接口，匿名认证流程只暴露固定用例。
- 本人会话、邀请和工作空间查询使用 `app.user_id`。邀请 Policy 通过该 User 的已验证手机号匹配目标，不接受客户端另传手机号。
- 普通租户业务表要求有效 `app.tenant_id`，缺失时默认拒绝。
- 工作空间列表只允许根据 `app.user_id` 查询当前用户自己的活动成员关系。
- 邀请接受只允许查询与当前用户已验证手机号或绑定 User 相匹配的邀请。
- 平台跨租户操作使用独立、受限、全量审计的应用路径，不复用普通租户 Repository。
- 应用数据库角色不是表所有者、超级用户，也没有 `BYPASSRLS`。

## 9. API 接口

### 9.1 认证与本人资源

```text
POST   /api/v1/auth/verification-challenges
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/me
GET    /api/v1/me/sessions
DELETE /api/v1/me/sessions/:sessionId
PATCH  /api/v1/me/password
```

### 9.2 邀请与工作空间

```text
GET  /api/v1/me/invitations
GET  /api/v1/me/invitations/:invitationId
POST /api/v1/me/invitations/:invitationId/accept
POST /api/v1/me/invitations/:invitationId/decline
GET  /api/v1/me/workspaces
```

### 9.3 租户成员管理

```text
GET   /api/v1/workspaces/:tenantCode
GET   /api/v1/workspaces/:tenantCode/members
GET   /api/v1/workspaces/:tenantCode/invitations
POST  /api/v1/workspaces/:tenantCode/invitations
POST  /api/v1/workspaces/:tenantCode/invitations/:id/resend
POST  /api/v1/workspaces/:tenantCode/invitations/:id/revoke
PATCH /api/v1/workspaces/:tenantCode/members/:memberId
```

### 9.4 平台租户开通

```text
GET   /api/v1/platform/tenants
POST  /api/v1/platform/tenants
GET   /api/v1/platform/tenants/:tenantId
PATCH /api/v1/platform/tenants/:tenantId/status
```

创建请求包含租户名称、唯一工作空间代码和首位管理员手机号。创建结果是 `DRAFT` Tenant 与待接受邀请；状态变为 `ACTIVE` 前必须至少存在一个活动 `TENANT_ADMIN`。平台操作使用独立的 Platform Admin Guard、数据库路径和审计，不通过普通租户 Repository 绕过 RLS。

工作空间 API 的 `tenantCode` 只定位租户。Guard 必须依次验证 User、TenantMember 和 Tenant 状态，并生成包含 `userId`、`tenantId`、`tenantCode`、`memberId` 和 `role` 的 `TenantContext`。

## 10. 认证与安全

- 密码使用 Argon2id 成熟实现，不自行实现哈希算法。
- Web 会话使用 HttpOnly、Secure、SameSite Cookie。
- 状态变更接口执行 CSRF 校验。
- 验证码、登录和找回密码按手机号、IP 和设备维度限流。
- 注册、登录和找回密码使用中性响应，避免账号枚举。
- 停用 User、TenantMember 或 Tenant 后，下一次受保护请求立即拒绝。
- 已登录用户修改密码后保留当前会话并撤销其他会话；通过找回密码重置后撤销全部会话，并要求重新登录。
- 日志不得记录手机号明文、验证码、密码、Session Token 或 Cookie。
- 邀请详情对非本人统一返回不可枚举结果。

短信发送位于 `VerificationSender` 接口后。单元和集成测试使用内存 Adapter；本地开发使用环境变量配置的固定验证码，API 响应与日志都不返回验证码；生产环境未配置真实 Sender 时启动失败。具体短信供应商不是领域接口的一部分，可以在不修改 Auth 模块的情况下替换 Adapter。

首位平台管理员不通过公开 HTTP 接口产生。仓库提供幂等的本机管理命令，操作者必须指定一个已经完成手机号验证的 User；命令授予 `isPlatformAdmin` 并写入平台审计。公开注册用户不能自行申请或提升平台管理员权限。

## 11. 错误契约

统一错误响应：

```json
{
  "code": "INVITATION_EXPIRED",
  "message": "该邀请已失效，请联系公司管理员重新邀请。",
  "fieldErrors": {},
  "requestId": "req_01...",
  "status": 409
}
```

第一阶段稳定错误代码：

- `AUTH_REQUIRED`
- `INVALID_CREDENTIALS`
- `VERIFICATION_INVALID`
- `VERIFICATION_EXPIRED`
- `INVITATION_NOT_FOUND`
- `INVITATION_EXPIRED`
- `INVITATION_PHONE_MISMATCH`
- `MEMBERSHIP_INACTIVE`
- `TENANT_INACTIVE`
- `WORKSPACE_FORBIDDEN`
- `RATE_LIMITED`

OpenAPI 是接口事实来源。`packages/contracts` 从 OpenAPI 生成类型，Web 不手写重复的响应类型。

## 12. 页面和交互

正式实现以下页面：

- 注册：默认、发送验证码、倒计时、字段错误、限流和成功。
- 登录：默认、提交中、凭据错误、锁定/限流和成功跳转。
- 找回密码：验证手机号、验证码、设置新密码和完成。
- 等待加入公司：加载、有邀请、无邀请、邀请过期和刷新失败。
- 邀请详情：可接受、已接受、已拒绝、已撤销、已过期和手机号不匹配。
- 工作空间选择：单租户、多租户、租户停用和成员停用。
- 账号安全：修改密码、会话列表和撤销会话。
- 成员管理：成员列表、邀请、重发、撤销、停用和无权。
- 平台租户开通：创建租户、首位管理员邀请、草稿状态、启用和停用结果。

页面只负责路由和编排。请求、错误映射和状态转换放在 `features/auth`、`features/invitations`、`features/workspaces` 和 `features/members`。Ant Design 是唯一 UI 体系，React Hook Form 与 Zod 处理表单，TanStack Query 处理服务端状态。

## 13. 测试策略

### 13.1 单元测试

- 手机号规范化和密码策略。
- 验证码状态转换及尝试次数。
- 邀请接受 Policy。
- 登录后的目标路由决策。
- API 错误到表单错误的映射。

### 13.2 PostgreSQL 集成测试

- 缺少身份或租户上下文时 RLS 默认拒绝。
- 两个租户之间查询、更新和关联均隔离。
- 本人邀请可见、他人邀请不可见。
- 并发接受邀请只创建一个成员。
- 部分唯一索引和事务回滚。
- 停用成员后工作空间访问被拒绝。

不得使用 SQLite 代替 PostgreSQL 验证 RLS、JSONB 或事务行为。

### 13.3 API E2E 与 Web 验收

- 注册、登录、退出和密码重置。
- 无租户用户进入 `/waiting`。
- 邀请深链接登录回跳、接受和拒绝。
- 单工作空间自动进入、多工作空间选择。
- 修改 `tenantCode` 的越权请求被拒绝。
- 租户管理员邀请、重发、撤销和停用成员。
- 平台管理员创建租户、邀请首位管理员并在验收后启用租户。
- 首位平台管理员授予命令只接受已验证 User，重复执行不产生额外权限记录。
- 普通员工无法访问成员管理。
- 会话撤销后旧会话不可继续使用。

API 的认证、平台租户和邀请/工作空间流程使用自动化 E2E 测试；Web 表单、路由和权限表现使用组件测试。完整浏览器流程由项目负责人在本地人工验收通过，当前决定不引入 Playwright，避免与已有 API E2E 重复维护。后续出现跨页面回归风险时再补最小浏览器冒烟测试。

## 14. 验收条件

- 新用户能够完成手机号注册和密码登录。
- 独立用户只能查看本人账号和邀请，不能访问租户数据。
- 用户接受本人有效邀请后只创建一个 TenantMember。
- 用户只能进入自己具有活动成员关系的工作空间。
- 租户管理员可以管理本租户邀请和成员，员工不能执行管理动作。
- 平台管理员可以在不代设密码的前提下创建租户并邀请首位管理员；未启用租户不能进入工作空间。
- 任意修改 URL 或 API 中的 `tenantCode` 都不能跨租户访问。
- 停用用户、成员或租户后访问立即失效。
- 全部迁移可在空 PostgreSQL 数据库执行。
- OpenAPI、生成契约和 Web 调用一致。
- 格式、Lint、类型、单元、PostgreSQL 集成、API E2E 和生产构建通过；Web 完整流程由项目负责人人工验收。

## 15. 实施结果

- 账号与手机号唯一身份、验证码、密码和服务端会话已经落地。
- 平台管理员通过本机幂等命令授予，公开注册无法自行提权。
- 平台租户开通、首位管理员邀请、租户启用、成员邀请与停用已经落地。
- 未登录平台路由、普通用户平台路由、租户成员关系与租户状态均由服务端校验。
- OpenAPI 生成契约供 Web 客户端使用；Web 不直接访问数据库。
- 项目负责人已人工跑通创建账号、登录、平台租户创建和工作空间相关流程。

## 16. 文档事实来源

- 本规格是第一个业务切片的实现事实来源。
- `docs/design/01` 至 `07` 描述长期产品和跨切片设计。
- `CONTEXT.md` 只定义领域术语，不保存实现细节。
- `docs/adr` 只记录难以逆转的架构决策。
- 实施计划必须引用本规格，并将每个任务限制在可独立测试和审查的交付物内。
