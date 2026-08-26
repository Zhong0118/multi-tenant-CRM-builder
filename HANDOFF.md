# 接手开发指南

本文件供接手本仓库的人或 AI 使用。目标：让你在**不重新设计、不重新初始化**的前提下继续开发。

版本：1.1 ｜ 对应提交：平台业务模板设计器切片完成（仅本地）

---

## 1. 三条不可协商的规则

1. **现有代码和设计是事实来源。** 不要重新设计架构、不要重新初始化项目、不要更换技术栈。
2. **不要动这两个文件**：`apps/web/src/app/(auth)/register/page.tsx`（用户未提交的改动）和 `chat会话.md`。不要 checkout / restore / reset / 格式化 / 暂存 / 提交它们。
3. **本地 `main` 领先 `origin/main` 很多提交且从未推送。** 不要 reset、rebase、强推或回退。

---

## 2. 项目是什么

**双层产品**：

- **通用多租户 CRM 平台** —— 租户管理员配置业务对象（字段、视图、权限），发布后成员按权限录入和查询记录。
- **平台业务模板能力** —— 平台管理员维护多对象模板草稿、发布不可变版本，并把当前版本应用为空白草稿公司的对象草稿。
- **首家公司「百杰」的具体业务模板** —— 线索、跟单、客户、期刊。**尚未配置**，真实 Excel 表头仍需确认。

**关键架构约束**：百杰专属的阶段、转换规则、期刊、电话 Bot、飞书自动化**绝对不能写死进通用平台核心**（对象、记录、导航、权限模块）。首期用百杰验证闭环，但底层必须保留接入其他公司的能力。

---

## 3. 核心机制（读代码前先理解这个）

```
对象草稿（可编辑）           →  发布  →   不可变发布快照（运行时唯一依据）
object_definitions              编译      object_publications.configuration
field_definitions                         = PublishedObjectSchema (JSONB)
view_definitions
object_permissions(ROLE)
field_permissions
```

- 运行时的导航、schema、表单、校验、记录读写**只读 `active_publication_id` 指向的快照**。改草稿不影响线上，只显示「有未发布变更」。
- **唯一例外**：`object_permissions` 里 `subject = MEMBER` 的成员覆盖策略是**实时**的，整条替换发布快照中的员工角色策略（动作 + `ALL/OWN/NONE` 数据范围），但**不改变字段权限** —— 字段权限永远来自发布快照。
- 记录值存在 `records.data` (JSONB)，但结构由发布快照校验。`ownerMemberId`、`title`、`recordNo`、`version` 是稳定列，不混入 JSONB。
- 租户隔离三层：`TenantContext`（应用）+ 事务内 `app.tenant_id`（会话）+ PostgreSQL RLS（数据库，`FORCE`，运行时角色 `NOBYPASSRLS`）。
- 跨租户或不存在的资源统一返回 `OBJECT_NOT_FOUND` / `RECORD_NOT_FOUND`，**不泄露资源是否存在**。

平台模板与租户对象是两段独立生命周期：

```text
模板草稿（平台可编辑） → 模板发布版本（不可变） → 应用到空白草稿公司
                                                ↓
                                  租户对象草稿（公司管理员可编辑）
                                                ↓
                                  对象发布版本（员工运行时使用）
```

- 模板只可应用当前发布版本，目标必须是 `DRAFT` 且从未存在任何对象行的公司。
- 应用事务生成新的对象、字段、默认视图与员工权限 ID，记录 `source_template_version_id`，但不创建 `object_publications`。
- 相同公司与相同模板版本的重试返回同一应用记录，不重复生成对象。
- 平台管理员身份不等于公司成员身份，不能绕过正常工作空间授权。

---

## 4. 按顺序读这些文件

### 4.1 必读设计文档（约 30 分钟）

| 顺序 | 文件 | 为什么 |
|---|---|---|
| 1 | `CONTEXT.md` | 统一领域语言。命名必须一致 |
| 2 | `docs/superpowers/specs/2026-08-21-dynamic-objects-records-design.md` | **第二切片的事实来源**，含发布规则、字段类型表、权限矩阵、错误码、视觉规范 |
| 3 | `docs/superpowers/plans/2026-08-21-dynamic-objects-records.md` | Task 1–13 实施计划，全部已完成并勾选 |
| 4 | `docs/superpowers/specs/2026-08-26-platform-business-template-designer-design.md` | 平台模板聚合、发布、应用和安全边界 |
| 5 | `docs/superpowers/plans/2026-08-26-platform-business-template-designer.md` | 平台模板 Task 1–9 实施计划 |
| 6 | `docs/design/README.md` | 切片路线图，回答「一共几个阶段」 |
| 7 | `docs/design/04-交互与样式约束.md` | 全局交互与视觉基线 |
| 8 | `docs/design/07-首家公司业务模板.md` | 百杰具体模板下一步要做什么 |

### 4.2 服务端深模块

| 文件 | 职责 |
|---|---|
| `apps/api/src/modules/objects/object-schema.ts` | `PublishedObjectSchema` 稳定类型定义 |
| `apps/api/src/modules/objects/object-publication.policy.ts` | 发布校验（阻断/警告/变更分析）与快照编译 |
| `apps/api/src/modules/objects/effective-access.ts` | 有效权限求值：管理员固定全权 / 员工角色策略 / 成员覆盖整条替换 / 默认拒绝 |
| `apps/api/src/modules/records/record-value-engine.ts` | 12 种字段类型的**唯一** switch、标题派生、隐藏与只读拒绝、PATCH missing vs null |
| `apps/api/src/modules/objects/object-configuration.policy.ts` | 模板发布与租户对象发布共享的纯配置校验和编译规则 |
| `apps/api/src/modules/business-templates/business-template-publication.policy.ts` | 模板聚合分析、发布编译、身份锁与稳定 checksum |
| `apps/api/src/modules/business-templates/business-templates.service.ts` | 模板草稿、乐观锁、发布分析与版本生命周期 |
| `apps/api/src/modules/business-templates/template-application.service.ts` | 应用前置条件、幂等、checksum 与新 ID 水合 |
| `apps/api/src/modules/business-templates/template-application.repository.ts` | 单事务锁、租户 RLS 上下文、规范化行与审计写入 |

**规则**：Controller、Service 和页面**不得**再对字段类型做 switch，也不得重复解释配置。新增字段类型只改 `record-value-engine.ts`。

其他关键服务端文件：

- `apps/api/src/modules/objects/published-object.service.ts` —— 运行时 schema 解析与裁剪（隐藏字段在此消失）
- `apps/api/src/modules/objects/object-draft.presenter.ts` —— 给设计器派生事实（当前版本号、是否有未发布变更、字段类型是否已锁定）。**原始快照不出 API**
- `apps/api/src/modules/objects/objects.service.ts` —— 草稿与发布用例
- `apps/api/src/modules/records/records.service.ts` —— 记录 CRUD、OWN 谓词、record counter
- `apps/api/src/common/errors/api-error-code.ts` —— 稳定错误码

平台模板 HTTP 路由：

```text
GET    /api/v1/platform/business-templates
POST   /api/v1/platform/business-templates
GET    /api/v1/platform/business-templates/:templateId
PUT    /api/v1/platform/business-templates/:templateId/draft
POST   /api/v1/platform/business-templates/:templateId/publication-analysis
POST   /api/v1/platform/business-templates/:templateId/versions
GET    /api/v1/platform/business-templates/:templateId/versions
POST   /api/v1/platform/business-templates/:templateId/applications
GET    /api/v1/platform/tenants/:tenantId/business-configuration
```

数据库事实由 `0004_business_templates` 建立模板、版本、应用、来源外键、RLS 与不可变触发器；`0005_restrict_business_template_rls_policies` 把发布版本和应用收紧为平台管理员仅可 `SELECT` / `INSERT`。

### 4.3 Web 侧

| 文件 | 职责 |
|---|---|
| `apps/web/src/features/objects/object-types.ts` | **在生成的 OpenAPI 类型之上收窄**。契约把部分对象声明为自由 JSON，这里在边界校验一次 |
| `apps/web/src/features/objects/object-api.ts` | 对象客户端（运行时 + 配置），只调生成路径 |
| `apps/web/src/features/records/record-api.ts` | 记录客户端 |
| `apps/web/src/features/records/dynamic-field.tsx` | 12 种字段类型的动态控件；HIDDEN 渲染 `null` |
| `apps/web/src/features/records/record-form.tsx` | 只提交 EDIT 字段；未触碰的可选字段省略而非发 null |
| `apps/web/src/features/objects/field-ledger.tsx` | 签名元素 FIELD LEDGER |
| `apps/web/src/features/templates/template-types.ts` | 基于生成契约收窄模板页面视图 |
| `apps/web/src/features/templates/template-editor.tsx` | 多对象本地草稿、dirty/save、发布交互 |
| `apps/web/src/features/templates/template-application.tsx` | 公司业务配置摘要、模板预览、确认与结果 |
| `apps/web/src/app/providers.tsx` + `apps/web/src/app/globals.css` | **设计令牌唯一来源**，两处数值必须一致 |

---

## 5. 现在能跑通什么（已验证）

| 链路 | 验证方式 |
|---|---|
| 注册 / 登录 / 邀请 / 工作空间 | 单元 + E2E + 人工 |
| 建对象 → 加字段 → 配视图 → 配权限 → 发布 | `apps/api/test/object-publication.e2e-spec.ts`（HTTP 打真实 PostgreSQL）+ 浏览器实测 |
| 记录 CRUD、OWN 范围、隐藏/只读拒绝、并发 recordNo、版本冲突 | `apps/api/test/dynamic-records.e2e-spec.ts` |
| 租户隔离与 RLS | `packages/database/test/integration/` |
| 浏览器闭环：管理员建记录、员工只看「我的」、隐藏字段消失 | 手工实测（截图确认） |
| 平台模板：列表/新建/双对象编辑/保存/分析/发布/v1 历史/身份锁 | `apps/api/test/business-templates.e2e-spec.ts` + 本地浏览器实测 |
| 模板应用：空白草稿公司生成完整对象草稿、精确重试幂等、无对象发布 | 同一 E2E 的真实 PostgreSQL 断言 + DB 集成来源关系断言 |
| 模板权限：普通用户 403；平台管理员不能越权进入工作区 | E2E + 本地浏览器实测 |

Task 9 focused 实证：模板 HTTP E2E 1 套件 / 1 测试；数据库集成 10 测试。完整仓库门禁的最新套件和测试总数记录在 `.superpowers/sdd/2026-08-26-platform-business-template-designer/task-9-report.md`。

---

## 6. 完整验证门禁

```bash
set -a && source .env && set +a
docker compose up -d
docker compose -f compose.test.yaml up -d
pnpm --filter @crm/database prisma:migrate:deploy

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @crm/database test:integration
pnpm --filter @crm/api test:e2e
pnpm contracts:check
pnpm build
pnpm --filter @crm/database prisma:validate
git diff --check
```

全部应退出 0，且用户的未提交改动保持未暂存。

---

## 7. 踩过的坑（别重复）

1. **改了 API 的 DTO 或路由后必须跑 `pnpm contracts:generate`**，否则 Web 拿到的是旧类型。`pnpm contracts:check` 会在 CI 层面挡住漂移。
2. **`@ApiProperty` 一定要写 `type`**。省略会生成 `Record<string, never>`，Web 侧完全不可用。契约测试已锁住这条不变量。
3. **`tenantCode` 来自 `@CurrentTenant()` 自定义装饰器，Swagger 推断不到**，必须在 Controller 类级声明 `@ApiParam({ name: 'tenantCode', type: String })`。
4. **拉新代码后先跑迁移**。dev 库落后会让配置接口直接 500。
5. **发布不能消耗草稿版本号**。发布是记录哪一版生效，不是配置变更；`saveObject(..., { bumpVersion: false })`。
6. **POST 但语义是读取的端点要显式 `@HttpCode(200)`**，Nest 默认 201 会和契约不符。
7. **Ant Design 6 的注意点**：`Alert` 用 `title` 不是 `message`；`Space` 用 `orientation` 不是 `direction`；`Drawer` 用 `size` 不是 `width`；`Form.Item` 脱离 `Form` 上下文时标签是行内的，需要 `<Form component={false} layout="vertical">`。
8. **jsdom 里测 antd Select**：`role="listbox"` 是虚拟化的无障碍镜像（只含一个窗口的选项），可见项在 `.ant-select-item-option` 上带 `title`。键盘选择用 `fireEvent` 不生效。
9. **不要在 Web 手写与 OpenAPI 平行的接口类型**。要收窄就在 `object-types.ts` 里基于生成类型收窄。
10. **不要让浏览器去 diff 发布快照**。需要派生事实就加到 `object-draft.presenter.ts`。

---

## 8. 下一步该做什么

### 下一切片：首家公司百杰具体模板

**前置条件（阻塞）**：百杰真实 Excel 表头需要先确认并冻结。见 `docs/design/README.md` 的「当前交付阶段」。

事实来源：`docs/design/07-首家公司业务模板.md`。要做的是基于已完成的平台模板能力配置获客、跟单、客户、期刊。状态机、转换、关系等能力仍需独立设计与实现，不能假设本切片已经具备，更不能往通用对象、记录、导航或权限模块里写死百杰逻辑。

### 平台 MVP 还缺的（各自独立切片）

记录活动与关系、记录转换与状态机、Dashboard 配置、导入导出、附件与文件存储、批量修改、看板与日历、个人自定义视图、发布版本回滚、平台级集成框架（飞书 / 电话 Bot / AI）。

### 已知的小缺口

- 记录列表没有列设置、批量操作、导出。
- 动态字段的高级筛选未实现（只有标题搜索 + 负责人筛选）。
- 对象配置页在 `<1024px` 直接隐藏并提示用桌面端（符合规格，但意味着手机上无法配置对象）。
- 模板应用只支持当前发布版本初始化空白草稿公司；不支持模板升级同步、已有对象合并或覆盖。
- 对象关系、状态机、转换动作和记录活动仍未实现。
- 本切片只完成本地实现与验收，没有生产部署或远端推送。

---

## 9. 给下一个 AI 的启动提示词

把下面整段贴给它：

```text
你接手一个正在开发中的多租户 CRM Builder 项目。

目录：/Users/zhongxu/Desktop/0-Inbox/multi-tenant-CRM-builder

现有设计、实施计划和已提交代码是唯一事实来源。不要重新设计架构、
不要重新初始化项目、不要更换技术栈、不要重复已完成的切片。

请先执行只读检查：
  git status --short --branch
  git log -10 --oneline
然后完整阅读 HANDOFF.md，再按它第 4 节列出的顺序读设计文档和核心代码。

严禁修改、暂存、提交、checkout、restore、reset 或格式化这两个文件：
  apps/web/src/app/(auth)/register/page.tsx
  chat会话.md
本地 main 领先 origin/main 且从未推送，不要 reset / rebase / 强推。

读完后先向我汇报三件事，不要动代码：
1. 你理解的产品边界和「对象草稿 / 发布快照 / 成员实时覆盖」这套机制
2. 前两个切片各自完成了什么，现在的真实验证边界在哪里
3. 你建议的下一步，以及为什么

开发方式：
- 在 main 上按 Task 开发，每个 Task 单独提交，不建 worktree
- 深模块（权限求值、字段类型、发布校验、Schema 收窄）先写失败测试并确认 RED，
  再实现；纯布局与展示组件靠 typecheck + lint + 我手工验收
- 改了 API 的 DTO 或路由后必须跑 pnpm contracts:generate
- 提交前跑 HANDOFF.md 第 6 节的完整门禁，并执行 git diff --check 和 git status
- 只暂存本 Task 明确涉及的文件，禁止 git add .

关键架构边界：这是「通用平台 + 首家公司百杰模板」的双层结构。
百杰专属的线索阶段、跟单转换、期刊、电话 Bot、飞书自动化绝对不能写死进
通用的对象、记录、导航或权限模块。
```

---

## 10. 本地验证账号

`.env` 里 `DEV_VERIFICATION_CODE=123456` 是固定开发验证码，只能本地用。

上一轮为验证闭环在 dev 库建了一份数据（可以删）：

| 账号 | 手机号 | 密码 | 角色 |
|---|---|---|---|
| 验证用管理员 | `13900000001` | `ClaudeVerify2026` | 租户 `claude-verify` 的 TENANT_ADMIN |
| 验证用员工 | `13900000002` | `ClaudeVerify2026` | 同租户 EMPLOYEE |

该租户下有一个已发布对象 `customers`（5 个字段，含一个员工只读和一个员工隐藏）和 2 条记录。

清理方式：删除 `tenants.code = 'claude-verify'` 及其关联行，以及 `users.phone` 为上述两个号码的用户。
