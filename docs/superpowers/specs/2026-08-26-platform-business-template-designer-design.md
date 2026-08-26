# 平台业务模板设计器设计

版本：1.0
日期：2026-08-26
状态：已确认，待实施

## 1. 目标

为平台管理员提供真实的业务模板管理能力，使其能够：

- 建立包含多个业务对象的模板草稿。
- 配置对象字段、默认表格视图和员工权限。
- 把完整模板发布为不可变版本。
- 将当前模板发布版本应用到空白的草稿租户。
- 为租户生成可继续修改、但尚未上线的对象草稿。

本切片只在本地完成实现、自动验证和人工验收，不部署、不推送远端、不处理真实生产数据。

## 2. 产品边界

平台管理员维护可复用的业务模板，但不直接修改租户线上对象。公司管理员仍然负责审查、调整和发布本公司的对象草稿；员工只使用公司管理员已经发布的对象。

```text
模板草稿（平台可编辑）
        ↓ 发布
模板发布版本（平台不可变）
        ↓ 应用到空白草稿租户
租户对象草稿（公司管理员可编辑）
        ↓ 发布
对象发布版本（员工运行时使用）
```

模板发布和对象发布是两个不同的生命周期。模板发布不会让任何租户对象上线；模板应用也不会创建对象发布版本。

### 2.1 本切片包含

- 平台业务模板列表、新建页和模板编辑器。
- 多对象模板草稿。
- 现有 12 种可发布字段类型。
- 默认表格视图。
- 员工动作权限、数据范围和字段权限。
- 模板发布分析、不可变版本和版本历史。
- 公司详情中的业务配置摘要和模板应用入口。
- 模板应用来源追踪、事务、幂等和审计。
- OpenAPI 契约、数据库迁移、必要自动测试和浏览器验收。

### 2.2 本切片不包含

- 向已有对象的租户合并或覆盖模板。
- 模板升级后同步已经应用的租户。
- 一家公司连续应用多套模板。
- 对象关系、状态机、转换动作和记录活动。
- Dashboard、飞书、电话 Bot、导入导出和附件。
- 百杰专属字段、阶段和业务规则。
- 模板复制、模板市场、行业筛选和复杂搜索。
- 模板归档操作；数据库保留 `archived_at`，本切片不提供入口。
- 移动端复杂模板编辑。
- 生产部署、远端推送和真实数据迁移。

## 3. 领域语言

- **业务模板（Business Template）**：可复用的业务对象、字段、视图和权限初始配置集合。
- **模板草稿（Template Draft）**：业务模板中可编辑的工作配置，不能直接应用到租户。
- **模板发布版本（Template Version）**：模板发布产生的不可变配置快照。
- **模板应用（Template Application）**：把当前模板发布版本一次性实例化为某个空白草稿租户的对象草稿，并记录来源的操作。
- **租户配置（Tenant Configuration）**：模板应用后归属于租户、可由公司管理员继续调整的配置。

界面使用“公司”“模板”“业务对象”；代码、API 和数据库继续使用 `tenant`、`businessTemplate`、`objectDefinition`。

## 4. 已选架构

采用“模板聚合 + 不可变版本”。不复制租户对象的全部规范化设计表，也不建立隐藏的模板租户。

模板草稿和模板发布版本均以完整 JSONB 配置聚合保存。模板生命周期模块负责校验、发布和版本事实；模板应用模块负责在单个数据库事务内把发布版本实例化为租户的规范化对象配置。

### 4.1 模块与接口

`TemplateLifecycle` 是管理模板草稿与发布版本的深模块。它的外部接口只暴露：

- `createTemplate(actor, input, meta)`
- `listTemplates(actor, query)`
- `getTemplate(actor, templateId)`
- `saveDraft(actor, templateId, input, meta)`
- `analyzePublication(actor, templateId, expectedVersion)`
- `publish(actor, templateId, expectedVersion, meta)`
- `listVersions(actor, templateId)`

`TemplateApplication` 是实例化租户配置的深模块。它的外部接口只暴露：

- `summarizeTarget(actor, tenantId)`
- `apply(actor, templateId, templateVersionId, tenantId, meta)`

Controller、页面和浏览器客户端不解释字段发布规则，不生成租户对象 ID，也不自行判断模板是否可发布或目标公司是否安全。

### 4.2 共享对象配置规则

模板对象与租户对象必须遵守相同的字段、标题、默认视图和员工权限不变量。实施时从现有 `object-publication.policy.ts` 提取纯对象配置校验与编译规则，使租户对象发布和模板发布共同调用同一实现。

与现有记录有关的规则，例如“把已有记录字段改为必填前检查缺失值”，仍由租户对象发布层补充；模板没有记录，不复制这部分逻辑。

## 5. 数据模型

### 5.1 `business_templates`

| 字段 | 规则 |
|---|---|
| `id` | UUID 主键 |
| `code` | 全局唯一，首次发布后不可修改 |
| `name` | 1–100 字符 |
| `description` | 可空，最多 1000 字符 |
| `draft_version` | 从 1 开始的乐观锁版本 |
| `draft_configuration` | `BusinessTemplateConfiguration` JSONB |
| `active_version_id` | 当前发布版本，可空 |
| `published_at` | 最近一次发布时间，可空 |
| `created_by_user_id` | 创建模板的平台管理员 |
| `archived_at` | 预留，可空；本切片不提供归档入口 |
| `created_at` / `updated_at` | 审计时间 |

状态由服务器派生，不另存易漂移的状态枚举：

- 无 `active_version_id`：草稿。
- `draft_version` 大于当前版本的 `source_draft_version`：有未发布变更。
- 两者相同：已发布。
- 有 `archived_at`：已归档。

### 5.2 `business_template_versions`

| 字段 | 规则 |
|---|---|
| `id` | UUID 主键 |
| `template_id` | 所属业务模板 |
| `version_no` | 模板内从 1 递增，唯一 |
| `source_draft_version` | 该版本来自哪一版模板草稿 |
| `schema_version` | 配置格式版本，首期固定为 1 |
| `configuration` | 不可变完整配置 JSONB |
| `configuration_checksum` | 配置规范化后的 SHA-256 |
| `change_summary` | 对象及字段变化摘要 JSONB |
| `published_by_user_id` | 发布人 |
| `published_at` | 发布时间 |

该表的 RLS 只允许平台管理员 `SELECT` 和 `INSERT`，不创建 `UPDATE` 或 `DELETE` 策略。外键引用使用 `RESTRICT`。

### 5.3 `business_template_applications`

| 字段 | 规则 |
|---|---|
| `id` | UUID 主键 |
| `template_version_id` | 被应用的不可变版本 |
| `tenant_id` | 目标租户 |
| `applied_by_user_id` | 执行应用的平台管理员 |
| `configuration_checksum` | 应用时确认的版本校验和 |
| `object_id_map` | 模板对象 ID 到租户对象 ID 的结果映射 |
| `applied_at` | 应用时间 |

建立 `(tenant_id, template_version_id)` 唯一约束，用于同版本网络重试幂等。该表只允许平台管理员 `SELECT` 和 `INSERT`。

不同模板或版本并发应用到同一租户时，由目标租户行锁和“完全空白”检查保证只有第一个事务成功，不依赖唯一约束表达未来不会永远成立的“一家公司只能有一次模板应用”。

### 5.4 对象来源

现有 `object_definitions.source_template_version_id` 建立到 `business_template_versions.id` 的真实外键。模板应用生成的每个租户对象都写入该字段；租户管理员手工创建的对象保持为空。

## 6. 配置格式

```ts
interface BusinessTemplateConfiguration {
  schemaVersion: 1;
  objects: TemplateObjectConfiguration[];
}

interface TemplateObjectConfiguration {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  titleFieldKey: string;
  sortOrder: number;
  status: "ACTIVE" | "INACTIVE";
  fields: TemplateFieldConfiguration[];
  defaultView: TemplateDefaultView | null;
  employeeAccess: TemplateEmployeeAccess | null;
}
```

模板对象和字段的 `id` 是模板内部稳定 UUID，只用于草稿、版本比较和应用结果映射。应用时必须为租户对象、字段和权限重新生成 UUID，不能复用模板内部 ID。

字段包含现有对象草稿所需的 `fieldKey`、`label`、`type`、`required`、`defaultValue`、`validation`、`config`、`sortOrder`、`isSystem` 和 `status`。员工字段权限只在对象的 `employeeAccess.fields` 映射中保存一次；模板详情 Presenter 可以为编辑器把对应权限派生到字段视图，但不能在持久化配置中保留两个事实来源。

默认视图包含名称、列字段键和 `updatedAt | createdAt | recordNo` 排序。员工权限包含创建、读取、更新动作，`ALL | OWN | NONE` 数据范围，以及每个有效字段的 `EDIT | READ_ONLY | HIDDEN` 权限。删除动作首期固定为 `false`。

配置不包含租户 ID、租户成员 ID、业务记录、对象发布元数据、成员级覆盖或百杰专属业务规则。

## 7. 字段范围与发布规则

首期模板只允许现有记录引擎完整支持的字段：

`TEXT`、`TEXTAREA`、`PHONE`、`EMAIL`、`NUMBER`、`MONEY`、`DATE`、`DATETIME`、`SINGLE_SELECT`、`MULTI_SELECT`、`MEMBER`、`BOOLEAN`。

`ATTACHMENT` 虽在数据库枚举中预留，但不能进入模板编辑器或发布版本。

发布整个模板时一次校验：

- 至少包含一个有效业务对象。
- 有效对象代码在模板内唯一。
- 每个有效对象至少有一个有效字段。
- 标题字段存在、启用、必填且类型适合作为单行标题。
- 默认视图存在且只引用有效字段。
- 员工权限存在，字段权限覆盖全部有效字段。
- 选项键在字段内唯一。
- 字段校验配置与字段类型相容。
- 提交的 `expectedVersion` 等于当前 `draft_version`。

首次模板发布后，已经进入发布版本的对象代码、字段键和字段类型保持稳定。新加入且从未发布的对象或字段在下一次发布前仍可修改稳定键。改变已发布字段语义时，停用旧字段并新增字段。

发布不增加 `draft_version`，只记录哪一版草稿被发布。继续编辑才增加草稿版本，并派生“有未发布变更”。

## 8. 模板应用

只有模板当前的 `active_version_id` 可以用于新的应用。历史版本可查看但不可新应用。应用请求显式携带 `templateVersionId`，避免页面打开后模板发生新发布而静默应用错误版本。

### 8.1 前置条件

- 操作者仍是有效平台管理员。
- 模板存在、未归档且已有当前发布版本。
- 请求版本等于模板当前发布版本。
- 目标租户存在且状态为 `DRAFT`。
- 目标租户从未存在任何业务对象；归档或软删除对象也视为非空。

### 8.2 事务顺序

1. 查询同一租户和版本的应用记录；若存在，返回原结果。
2. 锁定业务模板行和目标租户行。
3. 重新检查模板、版本和目标租户前置条件。
4. 重新计算规范化配置的 SHA-256，并与版本校验和比较。
5. 为所有租户对象和字段生成新 UUID，并建立模板 ID 到租户 ID 的映射。
6. 写入对象、字段、默认视图、员工角色对象权限和字段权限。
7. 每个对象写入 `source_template_version_id`，状态为 `DRAFT`，不创建对象发布版本。
8. 写入模板应用记录。
9. 写入租户审计事件。
10. 提交事务。

任一步失败都回滚全部对象配置。

### 8.3 应用后的所有权

应用产生的是租户配置，不是持续链接的模板副本。公司管理员可以修改名称、字段、视图和权限并自行发布；模板下一版本不会静默改变它。平台管理员不能通过模板编辑器修改已经应用的租户配置。

## 9. 安全、RLS 与审计

所有模板 Controller 使用：

```text
SessionAuthGuard → PlatformAdminGuard
```

模板仓储事务设置 `app.user_id`。模板表 RLS 通过 `users.is_platform_admin = true` 再次校验。应用事务锁定目标租户后设置 `app.tenant_id`，再写租户对象相关表。

公司管理员和员工不能读取模板草稿、模板版本或模板应用表，也不能通过租户对象接口自行写入 `source_template_version_id`。

应用成功写入一条租户审计事件：

```text
action: platform.template.applied
resourceType: business_template_application
resourceId: applicationId
after:
  templateId
  templateVersionId
  templateVersionNo
  objectCount
  objectIdMap
```

操作者使用真实平台管理员用户身份，不伪装成租户管理员。

首期新增并稳定暴露四个错误码：

- `TEMPLATE_NOT_FOUND`
- `TEMPLATE_VERSION_CONFLICT`
- `TEMPLATE_PUBLICATION_BLOCKED`
- `TEMPLATE_APPLICATION_NOT_ALLOWED`

`TENANT_NOT_FOUND` 继续复用。应用不允许的具体原因放入错误详情和可读消息，不为每个分支创建独立错误码。

## 10. 平台接口

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

完整模板草稿使用嵌套 OpenAPI DTO，不声明为自由 JSON。Web 只使用生成的 OpenAPI 路径和类型；若需要视图收窄，在模板 feature 的边界解析一次，不在页面手写平行契约。

模板列表支持常规分页和 `hasActiveVersion=true` 服务端查询。界面首期不展示搜索或筛选控件；公司应用弹窗使用该查询只加载存在当前发布版本的模板。

模板详情由服务器派生当前版本号、是否有未发布变更、对象数、字段数、应用公司数，以及每个对象代码和字段键/类型是否已被发布版本锁定。浏览器不 diff 发布 JSON。

`GET /platform/tenants/:tenantId/business-configuration` 返回对象总数、最近模板应用摘要、是否允许应用和阻断原因，使公司详情在展示按钮前得到服务器事实。

## 11. 页面与交互

### 11.1 模板列表 `/platform/templates`

使用 `PageHeader` 和标准列表表格。列为模板名称、模板代码、状态、对象数、当前版本、已应用公司和更新时间。唯一主操作是“新建模板”。不显示假统计、搜索、行业筛选或营销型模板卡片。

### 11.2 新建模板 `/platform/templates/new`

单页表单收集模板名称、模板代码和模板说明。创建成功后进入编辑器。模板代码帮助文案明确说明首次发布后不可修改。

### 11.3 模板编辑器 `/platform/templates/[templateId]`

页面使用现有 AppShell 和 V3 Token。主体为两列：左侧 240px“模板清单轨”，右侧当前对象配置。清单轨显示对象顺序、稳定代码、字段数和配置完整性，并提供“新建业务对象”。

当前对象配置分为基本设置、字段、列表视图和员工权限。复用现有 `FieldLedger`、字段配置抽屉和对象预览的纯展示能力，但不复用租户对象请求逻辑。

页面本地维护完整模板草稿。所有编辑先形成明确的“未保存变更”，点击“保存草稿”一次提交聚合和 `expectedVersion`。存在本地未保存变更时禁用“发布模板”。版本冲突保留本地编辑内容，提示刷新后重新应用，不静默覆盖。

发布打开清单式确认面板，按对象展示阻断项和变化摘要。成功后显示 `vN`。复杂编辑在小于 1024px 时使用桌面端提示；列表和应用确认仍可响应式展示。

### 11.4 公司详情 `/platform/tenants/[tenantId]`

新增“业务配置”区。空白草稿公司显示“应用业务模板”；其他公司显示已有对象数、最近模板来源或不能应用的原因。

应用弹窗只列出存在当前发布版本的模板。选择后显示模板版本、对象数和对象名称，并明确提示“将创建对象草稿，不会直接上线”。成功后展示生成对象清单和来源版本。

公司创建成功页增加“前往业务配置”链接，但不把模板选择加入当前新增公司表单。

## 12. 验证策略

测试与可运行功能按纵向切片同行，不建立先写大量测试、最后才出现页面的独立阶段。

### 12.1 必要自动验证

- 模板生命周期：合法草稿保存、乐观锁冲突、合法发布和阻断发布。
- 不可变性：模板版本不能通过运行时数据库角色更新或删除。
- 模板应用：完整创建对象配置、失败全部回滚、同版本重试幂等、非空或非草稿公司被拒绝。
- 权限：非平台管理员无法访问模板接口。
- HTTP 闭环：创建模板、保存、发布、应用到测试公司。
- Web 行为：列表空状态；编辑器未保存时禁止发布；应用确认成功状态。

普通 CSS、每个 DTO 属性和每条文案不单独建立测试。视觉通过 typecheck、lint、构建和人工浏览器验收。

### 12.2 本地人工验收

1. 平台管理员新建“测试 CRM”模板。
2. 创建至少两个业务对象，配置字段、视图和员工权限。
3. 保存并发布 `v1`。
4. 修改草稿，确认 `v1` 不变且页面显示“有未发布变更”。
5. 把当前发布版本应用到空白草稿公司。
6. 公司管理员在原有对象设计器看到完整对象草稿。
7. 发布前员工看不到对象；公司管理员发布后员工按权限使用。
8. 重复应用和错误目标不会产生重复或半套配置。

### 12.3 完成门禁

完成实现后执行 `HANDOFF.md` 第 6 节完整门禁，包括格式、lint、类型、测试、数据库集成、API E2E、契约检查、构建、Prisma 校验和 `git diff --check`。

## 13. 实施切片

1. 模板数据模型、RLS、生命周期最小接口、列表、新建和草稿编辑。
2. 共享对象配置规则、模板发布分析、不可变版本和发布交互。
3. 公司业务配置摘要、应用事务、应用确认和租户草稿验收。
4. 契约生成、回归门禁和浏览器人工验收。

每个切片先写一个能够证明关键行为缺失的失败测试，立即实现对应功能并恢复绿色，然后交付可见页面；不把测试积压成单独的大工程。

## 14. 工作区保护

实施和提交不得修改、格式化、暂存或提交：

- `apps/web/src/app/(auth)/register/page.tsx`
- `chat会话.md`
- 用户通过其他 API 生成、但尚未明确纳入本切片的未跟踪设计文档

本地 `main` 领先 `origin/main` 且从未推送。不得 reset、rebase、强推或远端部署。
