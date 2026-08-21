# 对象、字段、权限与动态记录闭环设计

版本：1.0
日期：2026-08-21
状态：已确认，待实施

## 1. 目标

完成通用平台第二个端到端业务切片：租户管理员能够创建业务对象、配置字段/列表/员工权限并发布；获准成员能够通过发布配置查看、新建、编辑和软删除业务记录。该切片提供首家公司模板所需的通用承载能力，但不写入百杰专属对象名称、状态机或转换规则。

完成后，现有 `object_definitions`、`field_definitions`、`records` 数据骨架和 `/workspace/[tenantCode]/objects/[objectCode]` 占位页面成为可实际使用的动态 CRM 核心。

## 2. 已确认方案

采用“规范化对象草稿 + 不可变对象发布版本”方案：

- `object_definitions`、`field_definitions`、视图和权限表保存租户管理员正在编辑的对象草稿。
- 每次发布校验整个对象草稿并生成不可变 `object_publications.configuration` 快照。
- `object_definitions.active_publication_id` 指向运行时当前版本。
- 记录页面、记录校验和权限计算只读取当前对象发布版本，不读取尚未发布的编辑状态。
- 首次发布前对象状态为 `DRAFT`；发布后为 `ACTIVE`。后续编辑不会使线上版本失效，而是显示“有未发布变更”。
- 平台管理员负责可复用业务模板；租户管理员在工作空间内配置本租户对象。平台后台不直接编辑租户线上对象。

本决定记录在 [`ADR-0004`](../../adr/0004-published-object-configuration-snapshots.md)。

## 3. 切片范围

### 3.1 包含

- 租户管理员创建、编辑、预览、发布和归档通用业务对象。
- 配置、排序和停用动态字段。
- 配置一个默认表格视图的列、默认排序和基础筛选项。
- 配置员工对象动作、数据范围和字段访问级别。
- 对象发布校验、影响摘要、不可变发布记录和当前版本切换。
- 发布对象驱动的工作空间导航、记录列表、动态表单和详情编辑。
- 记录分页、标题搜索、负责人筛选、排序和 URL 状态保存。
- 记录创建、读取、更新、软删除、负责人规则、乐观锁和审计。
- 租户隔离、对象权限、OWN 数据范围和字段级权限的服务端强制执行。
- OpenAPI 契约、Web 生成客户端、单元/组件/PostgreSQL/API E2E 测试。

### 3.2 不包含

- 百杰“获客、跟单、客户、期刊”的具体字段、阶段、转换和统计口径。
- 业务模板编辑/升级页面；模板在第三切片应用到首家公司。
- 记录活动、关系、转换、自动化、公式、汇总和查找字段。
- 附件、文件存储、导入导出、批量修改、Dashboard 和图表。
- 看板、日历和个人自定义视图。
- 发布版本回滚和任意字段类型迁移。
- Playwright；Web 采用组件测试并由项目负责人手工验收关键流程。

## 4. 领域规则

### 4.1 对象草稿与发布版本

- 对象 `code` 在租户内唯一，首次发布后不可修改。
- 字段 `fieldKey` 在对象内唯一，首次发布后不可修改。
- 已发布字段不可改变 `type`，只能调整标签、帮助说明、展示顺序、兼容校验和访问级别。
- 已发布对象可新增字段；存在历史记录时，新字段只能先以非必填发布。
- 字段停用后不再出现在读取、写入、筛选和列设置中，历史 JSONB 值保留。
- 单选/多选的 option key 发布后稳定；已被记录使用的选项只能停用，不能删除或复用 key。
- 对象归档后从正常导航隐藏，不再允许创建或更新记录；租户管理员仍可通过配置页查看发布历史。
- 每次草稿修改增加 `object_definitions.version`。发布必须携带期望版本，版本冲突返回 `CONFIG_VERSION_CONFLICT`。
- 发布快照包含对象、字段、默认视图、员工角色对象权限和员工字段权限；发布后不可修改。成员对象覆盖策略属于实时成员管理，不写入发布快照。

### 4.2 字段类型

第二切片支持：

| 类型 | JSON 值 | 规则 |
|---|---|---|
| `TEXT` | string | 长度 1–300；允许配置最小/最大长度 |
| `TEXTAREA` | string | 最大 10,000 字符 |
| `PHONE` | string | 作为业务资料保存，不等同于登录手机号 |
| `EMAIL` | lowercase string | 使用基础邮箱格式校验 |
| `NUMBER` | number | 可配置最小值、最大值和小数位 |
| `MONEY` | decimal string | 规范化为定点十进制字符串，避免 JSON 浮点误差 |
| `DATE` | `YYYY-MM-DD` | 不含时区 |
| `DATETIME` | ISO 8601 string | 服务端转换为 UTC |
| `SINGLE_SELECT` | option key | key 稳定，label 可改，停用项不能用于新写入 |
| `MULTI_SELECT` | option key[] | 去重并保持配置顺序 |
| `MEMBER` | tenant member UUID | 必须是当前租户活动成员 |
| `BOOLEAN` | boolean | 不接受 `yes/no` 字符串 |

对象必须存在一个必填标题字段。标题字段只能使用 `TEXT`、`PHONE`、`EMAIL` 或 `SINGLE_SELECT`，其展示值冗余写入 `records.title`。

### 4.3 有效访问权限

租户管理员固定拥有当前租户全部已发布对象的 `CREATE/READ/UPDATE/DELETE`、`ALL` 数据范围和字段 `EDIT`，不可被配置降权。

员工权限由统一权限求值模块计算：

1. 若存在该成员的实时对象覆盖策略，整条覆盖发布版本中的员工角色策略。
2. 否则使用对象的 `EMPLOYEE` 角色策略。
3. 没有显式策略时默认拒绝，不通过多条允许策略叠加授权。
4. 对象策略产生动作权限和 `readScope/updateScope = ALL | OWN | NONE`。
5. 字段策略产生 `EDIT | READ_ONLY | HIDDEN`；未配置的普通字段默认 `EDIT`，系统字段固定只读。

`OWN` 只以 `records.owner_member_id` 是否等于当前 `TenantMember.id` 判断，不使用创建人或最后修改人。

- 员工新建记录时负责人固定为本人，不能伪造他人负责人。
- 租户管理员可选择任意当前租户活动成员作为负责人。
- `READ_ONLY` 字段可以返回，但写入载荷中出现时返回 `FIELD_READ_ONLY`。
- `HIDDEN` 字段不得出现在 schema、列表、详情、筛选、列设置、导出或响应数据中；伪造写入返回 `FIELD_HIDDEN`。
- 第二切片不授予员工删除权限；软删除仅租户管理员可执行。
- 租户管理员在成员访问页修改成员对象覆盖策略，变更立即生效并写入审计，不要求重新发布对象；字段权限仍只支持角色级配置。

### 4.4 记录一致性

- `records.data` 只保存当前发布版本中的活动动态字段。
- `ownerMemberId`、`title`、`recordNo`、来源、创建者和版本属于稳定列，不重复混入 `data`。`statusKey` 保留给第三切片的受控状态机，第二切片写入时保持空值。
- 每个对象使用事务锁定的 `record_counters` 生成连续可读 `recordNo`，不使用 `MAX(record_no) + 1`。
- 更新必须提交当前 `version`；成功后递增，冲突返回最新版本摘要和 `RECORD_VERSION_CONFLICT`。
- 软删除设置 `deletedAt`，默认查询永不返回；第二切片不提供恢复或永久删除。
- 写入顺序固定为：解析发布版本 → 求有效权限 → 裁剪/校验字段 → 校验租户成员引用 → 事务写入 → 追加审计。

## 5. 数据模型

### 5.1 修改现有模型

`object_definitions` 新增：

- `active_publication_id uuid null`：当前运行时发布版本。
- `published_at timestamptz null`：最近一次发布时间。
- `sort_order integer not null default 0`：工作空间业务对象导航顺序。

保留现有 `version` 作为对象草稿乐观锁。`field_definitions` 继续表示草稿字段，补充帮助文案、占位文案和停用时间可放在受控 `config` 中；所有 JSON 配置均由 DTO schema 校验，不能透传任意对象。

### 5.2 `object_publications`

| 字段 | 说明 |
|---|---|
| `id` | UUID PK |
| `tenant_id` / `object_id` | 复合租户范围 FK |
| `publication_no` | 对象内从 1 递增 |
| `source_draft_version` | 发布所基于的草稿版本 |
| `configuration` | 完整不可变 `PublishedObjectSchema` JSONB |
| `change_summary` | 由发布影响分析生成的结构化摘要 |
| `published_by_member_id` | 当前租户管理员成员 ID |
| `published_at` | 发布时间 |

唯一约束 `(tenant_id, object_id, publication_no)`。禁止 UPDATE/DELETE；只允许插入和读取。

`configuration` 对应以下稳定结构，计划和代码不得另造一套运行时 schema：

```ts
interface PublishedObjectSchema {
  publication: {
    id: string;
    number: number;
    sourceDraftVersion: number;
    publishedAt: string;
  };
  object: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
  };
  fields: PublishedField[];
  defaultView: {
    code: "default";
    name: string;
    columnFieldKeys: string[];
    sort: { field: "updatedAt" | "createdAt" | "recordNo"; direction: "asc" | "desc" };
  };
  employeeAccess: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: false;
    readScope: "ALL" | "OWN" | "NONE";
    updateScope: "ALL" | "OWN" | "NONE";
    fields: Record<string, "EDIT" | "READ_ONLY" | "HIDDEN">;
  };
}
```

`PublishedField` 包含 `id`、`fieldKey`、`label`、`type`、`required`、`defaultValue`、受控 `validation/config`、`sortOrder` 和 `isSystem`。不得包含租户草稿备注、数据库内部时间或成员覆盖策略。

### 5.3 `view_definitions`

第二切片每个对象只有一个默认 `TABLE` 视图，规范化保存名称、代码、列字段键、默认排序、可筛选字段键和状态。个人查询条件只进入 URL，不写回共享视图。

### 5.4 `object_permissions`

沿用目标模型的 `ROLE | MEMBER` subject 设计，保存动作权限、读取范围和更新范围。唯一约束保证一个对象、一个 subject 只有一条策略；成员策略必须引用同租户成员。

- `ROLE/EMPLOYEE` 行属于对象草稿，发布时编入快照，后续草稿修改不立即影响运行时。
- `MEMBER` 行属于实时覆盖策略，不编入快照；成员管理页面修改后立即参与有效权限计算。

### 5.5 `field_permissions`

唯一键 `(tenant_id, field_id, subject_role)`。第二切片只配置 `EMPLOYEE` 角色的 `EDIT | READ_ONLY | HIDDEN`，成员级字段例外后置。

### 5.6 `record_counters`

唯一键 `(tenant_id, object_id)`，保存 `next_record_no`。创建记录时在同一数据库事务中行锁并递增。

### 5.7 RLS

`object_publications`、`view_definitions`、`object_permissions`、`field_permissions` 和 `record_counters` 全部启用并强制 RLS。策略要求 `tenant_id = current_setting('app.tenant_id', true)::uuid`；记录查询额外由应用权限求值限制 OWN/ALL。应用连接角色保持 `NOBYPASSRLS`。

## 6. 深模块与接口

第二切片把高复杂度集中在四个深模块中，Controller 和页面不重复解释配置：

### 6.1 对象配置模块

接口覆盖 `createDraft`、`getDraft`、`updateDraft`、`analyzePublication`、`publish` 和 `archive`。内部负责草稿版本、字段兼容性、默认视图、权限完整性、快照编译和审计。

### 6.2 发布对象解析模块

接口 `resolve(tenantContext, objectCode): PublishedObjectSchema`。调用者只学习一个已裁剪、类型化 schema，不需要知道草稿表、快照 JSON 或缓存实现。

### 6.3 有效权限模块

接口 `resolve(schema, tenantContext): EffectiveObjectAccess`。返回对象动作、数据范围和字段访问映射；Web schema 裁剪、记录查询和写入校验共享同一结果。

解析器先使用对象发布版本中的员工角色策略，再从数据库读取当前成员覆盖策略；租户管理员直接返回固定全权限。实时成员覆盖只改变对象动作和 OWN/ALL/NONE，不改变发布版本中的字段访问级别。

### 6.4 记录值引擎

接口 `validateMutation(schema, access, input, mode): ValidatedRecordMutation`。内部完成未知字段、字段权限、必填、类型、选项、成员引用、标题派生和规范化。创建/更新用例不各自实现字段 switch。

Repository 只接收经过 `WorkspaceGuard` 生成的 `TenantContext`，并在 `withTenant` 事务内设置 PostgreSQL session-local tenant/user/member 信息。

## 7. REST 与 OpenAPI

所有路由位于 `/api/v1/workspaces/:tenantCode`，由 Session、Workspace 和租户管理员/对象权限 Guard 保护。

### 7.1 配置路由（租户管理员）

```text
GET    /object-definitions
POST   /object-definitions
PUT    /object-definitions/order
GET    /object-definitions/:objectId
PATCH  /object-definitions/:objectId
POST   /object-definitions/:objectId/fields
PATCH  /object-definitions/:objectId/fields/:fieldId
PUT    /object-definitions/:objectId/field-order
PUT    /object-definitions/:objectId/default-view
PUT    /object-definitions/:objectId/permissions
POST   /object-definitions/:objectId/publication-analysis
POST   /object-definitions/:objectId/publications
GET    /object-definitions/:objectId/publications
POST   /object-definitions/:objectId/archive
GET    /members/:memberId/object-access
PUT    /members/:memberId/object-access/:objectId
```

发布分析和正式发布接受同一 `expectedVersion`。分析返回新增/停用字段、权限变化、历史数据阻断项和警告；存在阻断项时发布返回 `PUBLICATION_BLOCKED`。

### 7.2 运行时 schema 和记录路由

```text
GET    /objects
GET    /objects/:objectCode/schema
GET    /objects/:objectCode/records
POST   /objects/:objectCode/records
GET    /objects/:objectCode/records/:recordId
PATCH  /objects/:objectCode/records/:recordId
DELETE /objects/:objectCode/records/:recordId
```

列表参数：`page`、`limit <= 100`、`search`、`ownerMemberId`、`sort = updatedAt|createdAt|recordNo` 和 `direction = asc|desc`。第二切片不接受 `statusKey`、任意 JSONPath 或 SQL 表达式；动态字段高级筛选后置。

创建使用 `{ values, ownerMemberId? }`；更新使用 `{ version, values, ownerMemberId? }`。更新中的字段缺失表示保持原值，显式 `null` 只允许清空非必填字段。记录响应中的 `values` 已按字段权限裁剪。

运行时 schema 已按有效访问权限裁剪，包含对象标题、可执行动作、数据范围、可见字段、可编辑字段、默认视图和当前 publication number。默认视图只发布列与排序；本切片的标题搜索和负责人筛选属于稳定系统能力，不发布无效的动态字段筛选配置。

### 7.3 稳定错误码

- `OBJECT_NOT_FOUND`
- `OBJECT_NOT_PUBLISHED`
- `OBJECT_ARCHIVED`
- `CONFIG_VERSION_CONFLICT`
- `PUBLICATION_BLOCKED`
- `OBJECT_ACTION_FORBIDDEN`
- `RECORD_NOT_FOUND`
- `RECORD_VERSION_CONFLICT`
- `FIELD_UNKNOWN`
- `FIELD_REQUIRED`
- `FIELD_INVALID`
- `FIELD_READ_ONLY`
- `FIELD_HIDDEN`
- `FIELD_OPTION_INACTIVE`
- `OWNER_INVALID`

跨租户对象和记录统一映射为 `OBJECT_NOT_FOUND` / `RECORD_NOT_FOUND`，不泄露资源存在性。

## 8. Web 路由与页面

### 8.1 租户管理员对象配置

```text
/workspace/[tenantCode]/settings/objects
/workspace/[tenantCode]/settings/objects/new
/workspace/[tenantCode]/settings/objects/[objectId]
/workspace/[tenantCode]/members/[memberId]/access
```

对象配置列表展示名称、code、草稿/已发布/有未发布变更/已归档状态、字段数、当前发布版本和更新时间。只有租户管理员能看到导航和访问页面。

对象设计器布局：

```text
┌────────────────────────────────────────────────────────────────────┐
│ 客户资料 / 对象配置      有 3 项未发布变更       [预览] [发布变更] │
├───────────────┬────────────────────────────────────────────────────┤
│ 基本设置      │ 字段 12                                  [＋字段] │
│ 字段          │ ── FIELD LEDGER ───────────────────────────────── │
│ 列表视图      │ ≡ 客户名称   customer_name  文本   必填   可编辑 │
│ 员工权限      │ ≡ 电话       phone          电话   必填   可编辑 │
│ 发布记录      │ ≡ 最终评级   final_rating   单选   可选   只读   │
│               │                                                    │
│ v3 当前版本   │ 选择字段后从右侧打开配置抽屉                       │
└───────────────┴────────────────────────────────────────────────────┘
```

- 左侧导航编码真实配置步骤，不使用无意义编号装饰。
- 拖动只改变 `sortOrder`；稳定 `fieldKey` 始终可见。
- 字段抽屉分为“显示、数据类型、校验、选项、员工访问”小节。
- 预览可在“管理员/员工”间切换，真实展示隐藏、只读和无创建权限状态。
- 发布按钮先打开影响面板，阻断项与警告分开；用户确认的是具体变更，不是空泛二次确认。
- 发布记录是一条纵向配置账本，显示版本、操作者、时间和变更摘要，不提供回滚按钮。

成员访问页按已发布对象显示权限矩阵。每行可选择“使用员工默认”或“成员覆盖”；覆盖时一次性设置创建、读取、更新和数据范围。界面明确说明成员覆盖立即生效，而对象设计器中的员工默认值需要发布后生效。

### 8.2 运行时记录页面

```text
/workspace/[tenantCode]/objects/[objectCode]
/workspace/[tenantCode]/objects/[objectCode]/new
/workspace/[tenantCode]/objects/[objectCode]/[recordId]
```

列表页包含对象标题/说明、唯一主操作、标题搜索、负责人筛选、默认视图列、服务器分页和记录详情入口。搜索/筛选/排序/页码写入 URL，返回列表时保持上下文。业务状态筛选留给第三切片的状态机。

员工处于 OWN 范围时页面标题显示“我的{对象名}”，不渲染“全部记录”切换。无 CREATE 权限不显示新增按钮；无 READ 权限不生成导航项，直接访问显示无权结果。

记录深链接在桌面复用列表并打开 640px 右侧详情抽屉；小于 768px 使用全屏详情。详情按发布字段顺序展示，只有 `EDIT` 字段进入编辑状态；`READ_ONLY` 使用正常文本和“仅管理员可编辑”说明；`HIDDEN` 完全不存在。

新建页使用完整动态表单而非窄抽屉，字段按每组 4–8 个排列。第二切片只有一个“基本信息”分组，但结构允许发布 schema 后续增加布局分组。提交失败保留输入并聚焦第一个错误。

### 8.3 导航

工作空间布局服务端读取成员可访问的已发布对象清单，按对象配置顺序生成业务导航。未发布/归档对象、无 READ 权限对象不出现。系统导航（工作台、成员、设置）与业务对象导航在视觉上分组。

## 9. 前端视觉与交互规范

### 9.1 设计方向

主题是“可审计的业务配置账本”：对象配置和业务记录都强调稳定键、版本、状态和修改轨迹，使页面看起来像可靠的业务工具，而非通用低代码搭建器。

签名元素只使用一处：对象设计器的 `FIELD LEDGER` 纵向规则线，将字段顺序、稳定 key、类型、必填与权限合并成可扫描行。其余页面保持克制。

### 9.2 设计令牌

- `Ledger Ink #172033`：标题和高权重文字。
- `Working Blue #2457D6`：主操作、焦点和当前选择。
- `Canvas #F5F7FA`：应用背景。
- `Paper #FFFFFF`：表格、抽屉和编辑面。
- `Rule #D7DEE8`：结构分隔线。
- `Verified Teal #167A72` / `Review Amber #A86405`：已发布与待发布语义。

字体使用 Geist Sans/PingFang SC 作为界面正文，Geist Mono/系统等宽字体只用于 `objectCode`、`fieldKey`、记录编号和版本。圆角控制在 6–8px；不使用大面积渐变、玻璃效果、漂浮背景或无数据来源的指标卡。

### 9.3 状态与响应式

- 加载使用稳定骨架，避免表格列跳动。
- 空对象列表引导“创建第一个业务对象”；空记录列表根据权限显示“新增第一条记录”或只读说明。
- 筛选无结果与完全无记录使用不同文案。
- 409 版本冲突保留本地表单，显示最新版本并提供重新加载，不自动覆盖。
- ≥1200px 显示完整设计器侧栏和详情抽屉；768–1199px 收起侧栏；<768px 允许查看记录和编辑表单，但对象配置页明确提示使用桌面端。
- 所有图标按钮有 Tooltip 和无障碍名称；键盘焦点可见；抽屉关闭后焦点返回原记录行；尊重 `prefers-reduced-motion`。

## 10. 数据流

### 10.1 发布

```text
Tenant Admin 编辑草稿
  → PATCH 配置（expectedVersion）
  → 发布影响分析
  → 确认发布
  → 事务内锁定对象并复查版本
  → 编译 PublishedObjectSchema
  → INSERT ObjectPublication
  → 更新 activePublicationId/publishedAt
  → AuditLog
  → Web 刷新对象导航与 schema 缓存
```

### 10.2 记录写入

```text
WorkspaceGuard
  → PublishedObjectResolver
  → EffectiveAccessResolver
  → RecordValueEngine
  → Tenant-scoped transaction
  → Record + AuditLog
  → 返回按字段权限裁剪后的记录
```

任何一层都不接受 Web 提供的 tenant ID、权限结果、字段类型或标题派生结果作为事实。

## 11. 测试策略

### 11.1 单元测试

- 发布阻断：缺少标题字段、重复 key、无默认视图、无员工策略、不兼容字段变化。
- 字段类型的合法/非法边界和规范化结果。
- 租户管理员、员工角色、实时成员覆盖、OWN/NONE 与字段权限矩阵。
- 标题派生、隐藏字段裁剪、只读字段伪造和版本冲突。

### 11.2 PostgreSQL 集成测试

- 新表迁移、FK/唯一约束、发布版本不可变和 record counter 并发。
- 缺少 tenant setting 默认拒绝；租户 A 无法读取/写入租户 B 的草稿、发布版本、权限和记录。
- OWN 查询只返回当前负责人记录；管理员返回全部。

### 11.3 API E2E

- 管理员创建草稿、字段、视图、权限并发布，员工随后看到对象导航和运行时 schema。
- 未发布草稿不影响当前记录页面；再次发布后新 schema 生效。
- 管理员修改成员覆盖策略后无需重新发布，对该成员的下一次请求立即生效。
- 员工创建 OWN 记录，无法指定他人为负责人或读取他人记录。
- `READ_ONLY/HIDDEN` 字段读取与伪造写入行为。
- 两个并发创建产生不同 record number；两个并发更新只有一个版本成功。
- 普通员工不能访问对象设计器；修改 tenantCode/objectCode/recordId 不泄露跨租户数据。

### 11.4 Web 测试与人工验收

- 组件测试覆盖设计器字段行/抽屉、发布影响面板、权限预览、动态表单、URL 查询状态和详情抽屉。
- 项目负责人人工跑通：创建对象 → 添加字段 → 配置员工权限 → 发布 → 新建记录 → 列表查询 → 修改记录 → 验证员工 OWN/只读/隐藏表现。
- 当前不重复引入 Playwright；出现无法由组件/API 测试覆盖的浏览器回归后再补最小冒烟测试。

## 12. 验收条件

- 租户管理员可以在不影响当前线上版本的情况下编辑对象草稿并发布新版本。
- 未发布对象不会进入工作空间业务导航，也不能创建记录。
- 发布版本完整、不可变，运行时页面和服务端校验使用同一版本。
- 员工只能看到获准对象、记录范围和字段；直接伪造请求仍被服务端拒绝。
- 动态记录类型、必填、选项、成员引用、标题和版本由服务端统一校验。
- 列表、动态表单和详情页面均由发布 schema 驱动，不写死百杰字段。
- 记录创建、更新、软删除和对象发布写入审计。
- 任意修改 tenantCode、objectCode 或 recordId 均不能跨租户访问。
- PostgreSQL 迁移、RLS/并发集成测试、API E2E、Web 单元/组件、OpenAPI 漂移、Lint、类型和生产构建通过。

## 13. 文档事实来源

- 本规格是第二个业务切片的实现事实来源。
- [`CONTEXT.md`](../../../CONTEXT.md) 定义业务对象、对象草稿、对象发布版本、业务记录和有效访问权限等统一领域语言。
- [`docs/design/03-数据模型定义.md`](../../design/03-数据模型定义.md) 描述跨切片长期目标模型；冲突时以本切片规格的实施范围和明确约束为准。
- [`docs/design/04-交互与样式约束.md`](../../design/04-交互与样式约束.md) 和 [`docs/design/06-页面设计.md`](../../design/06-页面设计.md) 提供全局交互基线。
- 实施计划必须逐任务引用本规格，采用测试先行并保持通用平台与首家公司模板隔离。
