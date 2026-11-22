# 架构与可维护性审查（只读）

- 审查对象：`origin/main` @ `848280b`（PR #81 合并后），2026-11-22
- 方式：只读。逐文件阅读关键链路，用 TypeScript AST 统计函数长度，用 `git grep` 统计重复与引用，实际运行 API/Web ESLint。仓库没有 `.codegraph/`，所以未使用 CodeGraph。
- 未改动任何业务代码。本报告是唯一新增的文件。

---

## 0. 一页结论

**整体评分：6.5 / 10**。地基扎实（安全、契约、引擎复用），但"每加一种东西要改几十处"的分散知识，以及超大前端组件，已经开始拖慢迭代。

| 维度 | 分数 | 一句话 |
|---|---|---|
| 分层与依赖方向 | 7 | Web 没有导入数据库；API 模块之间只有文件级循环，没有 DI 循环；有两处分层倒置 |
| 权限 / 多租户 | 9 | RLS + 有效权限纯函数 + 单一解析入口，是全仓最好的部分 |
| 设计模式运用 | 7 | Typed Command、发布快照、自动化编译成 Action，都用得恰当；缺的是"类型描述符"一类的集中元数据 |
| 臃肿与重复 | 5 | 26 个文件超过 700 行；`RecordList` 单个函数 1353 行；前后端各手写一份配置 JSON 解析器，已经开始走样 |
| 测试与门禁 | 7 | 测试多且分层清楚；CI 不跑 lint，34 个 E2E 只跑 11 个 |
| 文档与新人友好 | 4 | 文档约 3.9 万行，入口文件已经过时并互相矛盾；还有大量空壳脚手架 |

### 做得好的 3 件事

1. **租户隔离与权限是纵深防御，而且只有一个真相来源。** 37 张表全部 `ENABLE` + `FORCE ROW LEVEL SECURITY`，共 78 条 policy；运行时角色 `NOBYPASSRLS`；每个事务内用 `set_config` 注入租户（`apps/api/src/infrastructure/database/context-runner.ts:8-33`）。有效权限是纯函数 `resolveEffectiveAccess`（`apps/api/src/modules/objects/effective-access.ts:63`）。快照解析只走一个入口 `resolvePublishedObjectRecord`（`apps/api/src/modules/objects/published-object.service.ts:187`），HTTP 读路径、Action Engine、AI 工具都复用它，没有各写一套权限判断。
2. **引擎复用而不是另起炉灶。** AI 的 7 个读工具全部通过 `RecordsService` / `PublishedObjectService` 取数（`apps/api/src/modules/ai/tool-registry.ts:47-63`），权限裁剪和 UI 完全一致。AI 写入走"Proposal → 确认 → 重新加锁校验 → 复用 `updateRecordCommand` / `createRecordActivityCommand` / `createFollowUpCommand`"（`apps/api/src/modules/ai/ai-proposal.service.ts:478-540`）。跨表自动化不另造执行器，而是编译成 Action Engine 的 `CREATE_RECORD + CREATE_RELATION`（`apps/api/src/modules/automations/automation-publication.ts:19-49`），在同一个事务里执行。
3. **契约与错误处理有门禁。** OpenAPI 由 Nest 装饰器生成，`contracts:check` 在 CI 里检查漂移；Web 用 `openapi-fetch` 加 `paths` 类型调用 API（`apps/web/src/lib/api/browser-client.ts`）。API 有 423 处 `throw new ApiException`，错误码集中在 `api-error-code.ts`，前端统一用 `toApiError` 解析。普通 `Error` 只用于"不可能发生"的不变量。**生产代码的 ESLint 是 0 错误**（API 和 Web 都是）。

### 影响最大的 5 个问题

| # | 问题 | 影响 | 工作量 |
|---|---|---|---|
| P1 | 字段类型、AI 动作类型等"类型知识"散落在 20～40 个文件，没有集中的描述符 | 新增一种字段类型要改约 25～30 个文件，其中只有约 5 处有编译器兜底 | 中 |
| P2 | 配置类 JSON（工作台定义、Workflow Action、自动化规则、AI 流事件）没有进 OpenAPI，前端手写镜像类型和运行时解析器 | 已出现前后端校验逻辑走样；这类 bug 编译器发现不了 | 中～大 |
| P3 | 前端出现"上帝组件"：`RecordList` 1353 行、`ObjectDesigner` 878 行加 38 个 `useState`、`MemberTable` 709 行 | 每个记录相关功能都要改同一个巨型函数，冲突和回归的风险集中在这里 | 中 |
| P4 | 服务端"上帝服务"和分层倒置：`RecordsService` 同时承担查询解析、聚合、导出、导入、活动；仓储层触发自动化；基础设施层翻译业务错误 | 职责边界不清，新人找不到逻辑在哪；也很难做局部测试 | 中 |
| P5 | 文档和脚手架漂移：`HANDOFF.md` 停在 2026-10-08（之后又合并了 65 个 PR）；设计索引仍指向已作废的 V1；有 6 个空 API 模块、1 个空包、27 个占位 README；死组件还在被维护 | 这个仓库主要靠 AI agent 开发，错误的入口文档会被 agent 当成事实，直接制造错误代码 | 小 |

---

## 1. 架构与分层

### 1.1 Monorepo 划分与依赖方向（基本合规）

- `apps/web` 只依赖 `@crm/contracts`；`apps/web/src` 里没有任何 `@crm/database`、`@prisma` 或 `DATABASE_URL` 引用。只有 `workflow-types.ts:7` 和 `workflow-action-editor.tsx:160` 在**注释**里提到 API 文件路径，原因是手工镜像（见 P2）。
- `apps/api` 依赖 `@crm/contracts` 和 `@crm/database`，方向正确。
- **`packages/tenant-templates` 是空包**：三个文件全是 `export {}`（`packages/tenant-templates/src/{index,generic/index,first-company/index}.ts`），没有任何应用依赖它。`packages/architecture-contract.test.mjs:19-38` 只断言这些占位文件"非空"，等于用测试把空壳锁住了。实际的模板能力在 `apps/api/src/modules/business-templates`（3794 行），数据存在数据库里。
- **`packages/contracts` 只有生成物**：`src/{auth,objects,records,tenants}/index.ts` 都是 2 行占位，唯一手写的内容是 `src/ai/stream.ts`（89 行）。任务里提到的"字段注册表、筛选注册表（`packages/contracts/src/records`）"**并不存在**，字段和筛选的知识都分散在 API 与 Web 各自的代码里（见 P1）。
- **`apps/worker` 是空进程**：81 行，只连 Redis，然后输出 `no business queues are registered`（`apps/worker/src/main.ts:35`）；`jobs/`、`queues/`、`processors/` 只有 README。

### 1.2 API 模块边界

按 `../<module>/` 的引用次数统计（非 spec 文件）：

```
records    -> objects(30) common(24) audit(6) infrastructure(3) auth(3) memberships(1) automations(1)
objects    -> common(14) records(7) actions(7) workflows(5) automations(5) audit(4) ...
ai         -> objects(17) common(16) records(14) follow-ups(7) ...
business-templates -> objects(10) records(6) dashboards(5) workflows(4) work(4) automations(3) actions(1) ...
```

- **没有 Nest DI 循环**（全仓没有 `forwardRef`），但有**文件级的双向依赖**：`objects ↔ records`、`objects ↔ actions`、`objects ↔ workflows`、`objects ↔ automations`。原因是 `objects` 同时扮演"对象模型底层"和"发布编译器顶层"两个角色：
  - 作为底层：`records` 依赖 `object-schema`、`effective-access`、`published-object.service`。
  - 作为顶层：`object-publication.policy.ts:1-22` 和 `published-object.service.ts:1-13` 反过来导入 workflows/actions/automations 的校验器；`object-configuration.policy.ts:18` 导入 `records/record-value-engine`。
- `objects` 是事实上的"共享内核"，但它没有作为内核来设计。
- **6 个空模块**：`users`、`integrations`、`imports` 只有空的 Controller/Service；`views`、`permissions`、`fields` 只有 `export {}` 的 DTO 文件。`app.module.ts:21-28` 注册了其中 3 个，`architecture.spec.ts:39-56` 断言这些空 Service 存在。更误导人的是，CSV 导入的真实实现是 `RecordsService.importRows`（`records.service.ts:518`，298 行），并不在 `imports` 模块里；权限规则也在 `objects/effective-access.ts`，并不在 `permissions` 模块里。

### 1.3 两处分层倒置

1. **基础设施层翻译业务错误**：`DatabaseContextRunner.withTenant` 用 `message.includes('POOL_PROTECTION_OWNER_REQUIRED')` 等 4 个字符串判断，把数据库触发器的消息翻译成中文业务错误（`apps/api/src/infrastructure/database/context-runner.ts:34-57`）。公海保护规则写在 PL/pgSQL 触发器里，同一个函数在 0029/0030/0032/0034 四个迁移里反复 `CREATE OR REPLACE`，规则本身对读应用代码的人不可见。
2. **仓储层驱动领域流程**：`PrismaRecordsStore.runFieldAutomations` 在仓储里调用自动化执行器（`apps/api/src/modules/records/records.repository.ts:472-490`），仓储的 `catch` 里还会写自动化失败审计（`records.repository.ts:398-410`、`492-511`）。仓储因此变成"数据访问 + 工作单元 + 领域钩子"三合一。

**建议**：把错误映射移到 `records` 模块里一个 `translatePoolProtectionError`，按 SQLSTATE 加约定的 code 匹配，`withTenant` 只负责事务。自动化触发改由 `record-command.ts` 在 patch 之后显式调用，仓储只暴露数据操作。**工作量**：小。**风险**：低，现有 E2E（`cross-table-automation.e2e-spec.ts`、`record-pool-*` 集成测试）能兜住。

---

## 2. 设计模式与技巧

### 2.1 权限：Effective Access + RLS + 租户上下文（做得好，不需要改）

- `WorkspaceGuard`（`common/tenancy/workspace.guard.ts:35-65`）从会话和路径解析 `TenantContext`，客户端没法自己提供 member。
- `resolveEffectiveAccess` 是纯函数，便于测试；GROUP 读范围、成员覆盖、字段覆盖都在这一处组合。
- 小瑕疵：`EffectiveObjectAccess` 的 `groupTitleHidden` / `ownTitleHidden` 在构造之后才被补写（`published-object.service.ts:203-208`），对象形状随调用路径变化。只建议在下次改这块时顺手改成构造时计算，不值得单独排期。

### 2.2 Typed Command 与 Proposal 确认链路（模式对，实现偏长）

- Command 已经抽出来复用（`records/record-command.ts`、`follow-ups/follow-up-command.ts`、`record-relations/record-relation-command.ts`），但**调用约定不一致**：`createRecordCommand({store, resolved, context, ...})` 用对象参数，`createFollowUpCommand(tx, context, input, meta, guard, deps)` 用 6 个位置参数（`follow-up-command.ts:219`）。
- `AiProposalService.confirm` 一个方法 232 行（`ai-proposal.service.ts:383-614`），用 if/else 按 3 种 `operationType` 分支执行；还直接写了两条 `FOR UPDATE` 原生 SQL（`:425-426`），绕过了仓储。`snapshot()`（`:224`，102 行）里还有一套同样的 if/else。
- **建议**：用"操作处理器表"`Record<AiOperationKind, { candidateSchema, preview, execute, safeFailureFields }>` 替换两套 if/else，`confirm` 只保留"锁定 → 校验 → 执行 → 状态迁移"的骨架。只有 3～5 种操作时用普通对象映射就够了，不需要 DI 插件机制。**工作量**：中。**风险**：中，`ai-confirmation.e2e-spec.ts` 和 `ai-proposal.e2e-spec.ts` 覆盖较全，但它们不在 CI 的关键集合里，需要先手动跑一遍。

### 2.3 Workflow、Action Engine 与跨表自动化（总体恰当）

- Action 随对象一起发布、冻结进快照，执行时整个 Transition 在一个事务里，全部成功或全部回滚，设计清楚。
- `executeActions` 函数 425 行（`actions/action-engine.ts:185`），5 个 `case` 都写在一个 `for/switch` 里（`:365-600`）。5 种类型用 switch 是合适的，**问题在函数体长度，不在缺少模式**。建议把每个 case 抽成 `executeCreateRecord(...)` 这样的同文件函数即可。
- 自动化 = Action 的宏（见"做得好的 3 件事"第 2 条），值得保持。不过 Web 端有两套映射编辑器：`workflow-action-editor.tsx`（1401 行）和 `automation-rule-editor.tsx`，映射 DSL 也不同（`SOURCE_RECORD/ACTION_OUTPUT` 对 `SOURCE_FIELD/LITERAL/NOW/INPUT`）。目前两者服务的用户心智不同，**暂不建议合并**。

### 2.4 动态字段类型系统（P1 的核心）

`record-value-engine.ts:255-281` 用一个穷尽 switch 处理 12 种类型的规范化，这是对的，TypeScript 能检查是否漏掉类型。真正的问题是**"类型能力"元数据没有集中**：

- 同一份 12 种类型的列表在 API 里手写了 **4 遍**：`objects/object-schema.ts:8`、`objects/dto/object.dto.ts:34`、`business-templates/dto/business-template.dto.ts:46`、`dashboards/dto/dashboard.dto.ts:~290`。另外还有 Prisma enum（`schema.prisma:68`）和 Web 端的 `object-types.ts:42`、`dashboard-types.ts:~740`。
- "哪些类型可搜索 / 可排序 / 可筛选 / 可分组 / 可作标题"分散在 `object-schema.ts:29,50`、`object-configuration.policy.ts:20`、`records.service.ts:1467`（`AGGREGATE_GROUP_TYPES`）、`dashboard-definition.ts:44-46`、`dashboard-definition.ts:743`（`operatorsFor`），Web 端也有一份对应的 `SORTABLE_FIELD_TYPES` / `SEARCHABLE_FIELD_TYPES`。
- 按类型分派的 if 链：`records.service.ts:1135-1201`（`parseListFilters`）、`records.repository.ts:1453-1500`（`filterSql`）、`record-export.ts:80`、`dashboards.repository.ts:938`、`action-value-resolver.ts:240`，Web 端还有 `dynamic-field.tsx:253,366`、`record-display-value.tsx:56`、`record-csv.ts:73`、`record-filter-controls.tsx:273` 等。
- `object-configuration.policy.ts:~640-680` 为发布分析又"镜像"了一套默认值校验（注释写明是 mirror the engine）。

**建议（不是插件化，而是"描述符 + 穷尽映射"）**：

1. 在共享包里定义一份 `FIELD_TYPES` 常量和 `FIELD_TYPE_TRAITS: Record<FieldType, { searchable; sortable; filterMode; aggregatable; titleEligible; dashboardOperators }>`，API 的 DTO 枚举、`object-schema`、dashboard 和 Web 都从这里派生。
2. 行为本身（normalize、SQL、编辑器组件、显示组件）保留在各自的层，但统一写成 `Record<FieldType, ...>` 映射或穷尽 switch。这样新增一个类型时，**TypeScript 会把所有该改的地方列出来**，不用靠 grep。

**工作量**：中（约 3～5 天，可以分两次 PR：先 API，再 Web）。**风险**：低到中，主要风险是 OpenAPI 枚举的生成结果变化，`contracts:check` 会兜底。

### 2.5 前端数据获取与状态（选型正确，不建议改）

- URL 状态 + TanStack Query + 局部 `useState` + `localStorage` 偏好，没有引入全局状态库，也没有 `createContext`。对这个规模的 CRM 来说是合适的。
- 只有 4 个 feature 有 queryKey 工厂（`followUpQueryKeys`、`goalKeys`、`workKeys`、`aiQueryKeys`），另外还有 57 处内联的 `queryKey: [...]`，其中 25 处以 `"workspace"` 开头，`invalidateQueries` 共 51 处。失效范围要靠字符串前缀约定，容易漏刷新。建议随改随补 key 工厂，不单独排期。
- `record-api.ts` 手写了 17 个导出类型，引用生成的 `Schemas` 0 次；调用本身是类型化的（`browserApiClient.GET(...)`），所以风险中等。建议改成 `type X = Schemas["..."]`，随改随做即可。
- 有 3 处绕过 `openapi-fetch` 的原生 `fetch`：附件 multipart、AI 流式、CSV 导出。都有正当理由。

### 2.6 抽象过度或空转的地方

| 位置 | 情况 | 建议 |
|---|---|---|
| 6 个空 API 模块 + `architecture.spec.ts` 断言 | 没有任何价值的间接层，还误导找代码的人 | 删除 |
| `packages/tenant-templates` + `architecture-contract.test.mjs` | 空包 + 用测试锁住空包 | 删除，或在 README 写明"故意未使用" |
| 27 个占位 README（`common/{decorators,filters,guards,interceptors,pipes}`、`worker/src/*`、`web/src/components/{data-table,forms,...}`） | 例如 `common/guards/README.md` 写着"权限规则放在 permissions 模块"，但 permissions 是空的；guard 实际在 `modules/auth` 和 `common/tenancy` | 删除，或改成真实的指路说明 |
| 32 个 `Symbol(...)` 注入令牌（repository / clock / id generator） | 有一些冗余，但它们是单测的接缝 | **保留**（见第 6 节） |

---

## 3. 臃肿与重复

### 3.1 超过约 700 行的非测试文件（共 26 个）

| 行数 | 文件 | 判断 | 怎么拆 |
|---|---|---|---|
| 2309 | `apps/web/src/features/objects/object-designer.tsx` | **该拆** | 主组件 878 行，38 个 `useState`，11 个 `useMutation`。`PermissionsSection`（427 行，`:1642`）、`DefaultViewSection`（322 行，`:1301`）、`PublicationHistorySection` 各自移到单独文件，每个 section 自带 mutation hook |
| 1630 | `apps/api/src/modules/records/records.service.ts` | **该拆** | 38 个方法/函数。拆成 `record-query-parser.ts`（`parseListFilters` 到 `parseListSort`，约 300 行纯函数）、`record-import.service.ts`（`importRows` 298 行）、`record-export.service.ts`（`exportCsv` 123 行）、`record-activities.service.ts` |
| 1580 | `apps/web/src/features/records/record-list.tsx` | **该拆** | `RecordList` 单个函数 1353 行（`:155-1508`）。子组件其实已经拆出去不少（筛选、批量、导入都是独立文件），剩下的主要是列定义（`fieldColumn` / `systemColumns`，约 200 行）和约 1000 行 JSX。抽出 `useRecordColumns`、`useRecordSelection`、`RecordToolbar`、`RecordCardList` |
| 1578 | `apps/api/src/modules/records/records.repository.ts` | 部分拆 | SQL 构建器（`listWhereSql`、`filterSql`、`presenceSql`、`recordSortExpression`，`:1316-1570`）移到 `record-query.sql.ts`；自动化钩子移出（见 1.3） |
| 1401 | `apps/web/src/features/objects/workflow-action-editor.tsx` | 可以不拆 | 已有 34 个小函数，结构尚可；`ActionStepBody`（303 行）可以按 action 类型拆 |
| 1355 | `apps/api/src/modules/dashboards/dashboards.repository.ts` | 可以不拆 | 主要是 SQL，职责单一 |
| 1158 | `apps/api/src/modules/objects/objects.service.ts` | 部分拆 | 把 `publishTemplateInitialization`（123 行）和 `create`（147 行）中的模板初始化部分移到 `business-templates` |
| 1116 | `apps/api/src/modules/dashboards/dashboard-definition.ts` | 结合 P2 处理 | 校验逻辑应该成为前后端共享的 schema |
| 981 / 979 / 951 / 941 / 903 / 857 / 841 | `dashboard-builder`、`my-work`、`dashboard-widget-inspector`、`record-pool`、`member-table`、`member-object-access`、`workflow-designer`（均为 Web） | 按需拆 | 统一的问题是"一个文件 = 一个页面的全部 state + 全部 JSX"；`MemberTable` 主函数 709 行，`DashboardBuilder` 661 行 |
| 835 | `apps/api/src/modules/ai/conversation.repository.ts` | 可以不拆 | |
| 809 | `apps/web/src/features/dashboard/dashboard-types.ts` | **删一半** | 其中约 500 行是手写的运行时响应解析器（P2） |
| 637 | `apps/api/src/modules/ai/ai-proposal.service.ts` | 按 2.2 改 | 不到 800 行，但单方法 232 行 |

**最长的函数**（AST 统计，非测试代码）：`RecordList` 1353、`ObjectDesigner` 878、`MemberTable` 709、`DashboardBuilder` 661、`RecordImportDrawer` 626、`WorkflowDesignerForm` 614、`RecordDetailPage` 581、`seed-demo-company main` 462、`executeActions` 425、`continueTurn` 335（`ai-orchestrator.ts:74`）、`importRows` 298。前 8 个里有 7 个是前端组件，**前端的臃肿比后端严重**。

### 3.2 前后端、模块间的重复

1. **工作台筛选校验逐行重复，而且已经走样**：`apps/web/src/features/dashboard/dashboard-types.ts:534-579` 和 `apps/api/src/modules/dashboards/dashboard-definition.ts:770-806` 都叫 `validateFilterValueShape`，几乎逐行相同；但最后一个分支不同，Web 端额外校验原始类型，API 端只检查 `hasValue`。
2. **Workflow Action 类型手工镜像**：`apps/web/src/features/objects/workflow-types.ts`（305 行）的文件头注释写明是 "the web mirror of the API contract"，因为生成的 `WorkflowActionDraftDto` 把 payload 声明成自由对象。
3. **AI 操作类型字面量重复 9 次**：`schema.prisma`（enum）、`ai-proposal.schema.ts`、`tools/propose-change.tool.ts:14`、`ai-operation.types.ts:7`、`dto/ai-proposal.dto.ts:19`、`packages/contracts/src/ai/stream.ts:3`、`web/.../ai-stream-parser.ts:193`、`web/.../ai-proposal-card.tsx:21`、`providers/fake-ai.provider.ts:11`。
4. **CSV 往返规则分在两端**：导出在服务端（`record-export.ts:73-96`，多选用 `；` 拼接），导入解析在浏览器（`apps/web/src/features/records/record-csv.ts:56-92`，按 `[;；,，]` 拆分）。目前是匹配的，但修改其中一端时，没有测试能保证两端同步。
5. **字段类型列表与能力**：见 2.4。

**P2 的建议**：建一个**同构的纯逻辑共享包**。可以把 `@crm/contracts` 扩展出 runtime 子路径，也可以新建 `packages/domain`；API 已经在运行时导入 ESM 的 `@crm/database`，所以技术上没有障碍。先把 `dashboard definition`、`workflow actions`、`automation rules`、`AI operation` 这几个 JSON 配置的 zod schema 放进去，API 用它做校验，Web 用它做解析和类型推导，替代 `dashboard-types.ts` 和 `workflow-types.ts` 里的手写版本。**工作量**：中～大（建议从工作台筛选开始，一次迁一类）。**风险**：中，涉及 CJS/ESM 打包，要先做一次只迁一个 schema 的试点 PR。

### 3.3 死代码与无人使用的功能

| 项 | 证据 | 备注 |
|---|---|---|
| `apps/web/src/features/records/record-detail-drawer.tsx`（369 行） | 没有生产代码引用，只被 3 个测试导入 | **还在被维护**：最近 5 个功能提交都改过它（`7b19f67`、`8b9e30f`、`7fbc393`、`d379ea3`、`a6a7cda`），白白消耗精力，测试也在为死代码"保驾护航" |
| `apps/web/src/features/objects/employee-permission-comparison.tsx`（139 行） | 0 个引用 | 最后修改是 `fce7cd2` |
| `apps/web/src/components/workbench/filter-bar.tsx` | 只被测试引用 | |
| 6 个空 API 模块、空 `tenant-templates` 包、空 worker 队列 | 见 1.1 / 1.2 | |
| `executionSummary` | API 会返回（`workflow-runtime.service.ts:384`），Web 只声明了类型，`HANDOFF.md` 第 7 节也写明"没有任何消费者" | 是否删除由产品决定 |

---

## 4. 可维护性

### 4.1 测试结构（分工清楚，但 CI 覆盖与耦合度有问题）

| 层 | 规模 | 评价 |
|---|---|---|
| API 单测 | 115 个文件 / 41,144 行（测试与生产代码的行数比约 0.85:1） | 纯函数（policy、engine、effective-access）的单测质量高 |
| API E2E（真实 PostgreSQL） | 34 个文件 / 21,511 行 | 覆盖关键链路，但 **CI 只跑其中 11 个**（`apps/api/package.json:24` 的 `test:e2e:critical`），另外 23 个没有门禁，迟早会腐烂 |
| DB 集成 | 20 个文件 | RLS、触发器、并发这些都覆盖到了，这是正确的分工 |
| Web | 137 个测试文件（Vitest + jsdom） | 没有浏览器级 E2E（README 写明暂不引入 Playwright） |

**过度依赖实现细节**：7 个仓储单测用"按 SQL 文本路由"的方式伪造 `$queryRaw`。例如 `conversation.repository.spec.ts:218-233` 把 SQL 模板 `join('$')` 后用正则判断该返回什么；`:655,1266` 断言 SQL 里包含 `FOR UPDATE`。只要改写 SQL（哪怕语义不变），这些测试就会坏。而它们真正想保护的行为（锁、RLS），DB 集成测试已经覆盖了。**建议**：不要新增这类测试；改到相关仓储时，迁到 `packages/database/test/integration` 或 E2E。

### 4.2 类型与契约

- **REST 的 DTO 层是单一来源**：Nest DTO → `openapi.json` → `generated/openapi.ts`，CI 检查漂移。这部分做得好。
- **JSON 配置层不是单一来源**：OpenAPI 里共有 378 个 `"type": "object"`，工作台组件、Action payload、自动化映射都以自由对象出现，于是 Web 端只能手写镜像（P2）。另外 `packages/contracts/src/ai/stream.ts` 是手写的，它放在 contracts 包里，看起来像契约，但没有任何生成或校验机制保证它和 API 一致。

### 4.3 错误处理（一致，不需要改）

除了 1.3 提到的字符串匹配触发器消息之外，错误处理是统一的。`tenants.service.ts:182` 的 `throw new Error('Template application is not wired into tenants')` 是可选注入留下的痕迹，可以在拆模块时改成必填依赖。

### 4.4 ESLint："600 多个错误"实际是什么

实测：先 `prisma generate` 和构建 `@crm/database` 之后，API ESLint 报 **637 个错误、7 个警告，全部在测试文件里，`src` 的生产代码是 0**。Web ESLint 0 错误、1 个警告（`dashboard-builder.tsx:396` 用了 `window.location.assign`）。

| 规则 | 数量 | 是否反映真实问题 |
|---|---|---|
| `prettier/prettier` | 302（其中 244 个在 `test/workflow-template-inheritance.e2e-spec.ts`） | 否，纯格式问题，执行一次 `prettier --write` 就能清零 |
| `no-unsafe-member-access` / `no-unsafe-assignment` / `no-unsafe-call` / `no-unsafe-return` | 163 | 弱：测试里对 `any` 型响应体做断言，只影响测试的可读性 |
| `require-await` | 60 | 否，fake 实现写成 `async` 但没有 `await` |
| `no-unnecessary-type-assertion` | 57 | 否 |
| `unbound-method` | 36 | 否，`expect(obj.method)` 这种 jest 惯用写法 |
| 其他（`require-yield`、`no-unused-vars` 等） | 约 20 | 少量是真问题（未使用变量） |

**两个陷阱**：

1. 如果没有先生成 Prisma 客户端，同一条命令会报 **8,663 个错误**：数据库类型解析成 `any`，导致 `no-unsafe-*` 大面积级联。根目录的 `pnpm lint` 不会自动执行 `predev` 构建，所以不同人、不同 agent 报出来的数字会差一个数量级。
2. **CI 根本不跑 lint**：`.github/workflows/ci.yml` 只有 Typecheck、Contracts、Unit、DB Integration、Build、Critical E2E 六个门禁。测试文件的 lint 债就是这样积累起来的。

**建议**：(a) 执行一次 `prettier --write apps/api/test apps/api/src/**/*.spec.ts`；(b) CI 加一个 `eslint src` 门禁（目前已经是 0 错误，立刻能绿）；(c) 测试文件用 override 关掉 `unbound-method`、`require-await` 和 `no-unsafe-*`，不要为了清零去重写测试。**工作量**：小。

### 4.5 设计文档：过多、重叠、过时

- 规模：`docs/superpowers` 有 90 个文件、31,533 行（48 个 plan、34 个 spec、8 个 brief）；`docs/audits` 有 206 个文件；`docs/design` 有 319 个文件，其中包括 126 张 jpg、89 张 png 和 18 个 html。全仓 Markdown 约 3.9 万行，生产代码约 10.3 万行。
- **入口文件互相矛盾**：`docs/design/README.md`（最后修改 2026-08-26）的第 12 和 14 行仍然指向 V1 的 `04-交互与样式约束.md` 和 `06-页面设计.md`，而 `04-…-v3-final.md` 开头写着"唯一有效版本，V1、V2 仅保留归档"。
- **HANDOFF.md 过时**：502 行，顶部的"当前权威更新"指向 2026-10-06 的 `codex/internal-trial-preparation` 和"PR #26 OPEN/未合并"，第 10 节还声称"仓库存在 `.codegraph/`"。之后又合并了 65 个 PR（截至 PR #81），里面完全没有记录公海、成员分组、跨表自动化、工作目标等后来的功能。
- 根目录还有 `README-PACKAGE.md`（某次"文档包"的复制说明）和 `design-qa.md`（引用本机 `/Users/...` 截图路径），都不该留在仓库根目录。

**建议**：(a) `docs/design` 只保留 v3-final，V1/V2 移到 `docs/design/archive/`，并改正 README 索引；(b) 把 `HANDOFF.md` 重写成不超过 150 行的"当前事实"（模块地图、启动、门禁、禁止事项），历史验收移到 `docs/audits`；(c) 删除或归档根目录的 `README-PACKAGE.md` 和 `design-qa.md`；(d) 在 `CONTEXT.md` 旁边加一页 `docs/guides/extension-points.md`，写明第 5 节的两条改动路径。**工作量**：小（约半天）。**收益**：很高，因为这个仓库的主要开发者是 agent。

---

## 5. 新人友好度：实际走一遍

### 5.1 "新增一种字段类型"（以简单的 `URL` 类型为例）

**必须改**才能"可配置、可录入、可展示、可筛选、可导出"的文件：

| 层 | 文件 | 数量 |
|---|---|---|
| DB | `schema.prisma`（`FieldType` enum）+ 新迁移（`ALTER TYPE`） | 2 |
| 契约（生成） | `openapi.json`、`generated/openapi.ts` | 2 |
| API | `object-schema.ts`、`objects/dto/object.dto.ts`、`business-templates/dto/business-template.dto.ts`、`dashboards/dto/dashboard.dto.ts`、`record-value-engine.ts`、`object-configuration.policy.ts`、`records.service.ts`（筛选解析）、`record-export.ts`、`dashboard-definition.ts` | 9 |
| Web | `object-types.ts`（列表 + `FIELD_TYPE_LABELS`）、`field-list.tsx`（`TYPE_ICONS`）、`field-editor-form.tsx`、`dynamic-field.tsx`、`record-display-value.tsx`、`record-cell.tsx`、`record-column-layout.ts`、`record-filter-controls.tsx`、`record-csv.ts`、`dashboard-types.ts` | 10 |
| **合计** | | **约 23 个** |

如果还要和现有类型能力对齐（工作台 SQL、Action 映射、自动化、文件导入推断、模板），还要再改 `dashboards.repository.ts`、`action-value-resolver.ts`、`action-publication.policy.ts`、`automation-runner.ts`、`automation-publication.ts`、`workflow-action-editor.tsx`、`automation-rule-editor.tsx`、`object-file-fields.ts`、`dashboard-renderer.tsx` / `dashboard-value-format.ts`、`company-audit-presenter.ts` 等，**一共约 33～39 个文件**（用 `git grep` 搜 `MONEY|BOOLEAN|MULTI_SELECT|DATETIME|TEXTAREA`，命中 39 个生产文件）。

**编译器能兜住的只有约 5 处**：`record-value-engine.ts` 的穷尽 switch，以及 Web 端 4 个 `Record<PublishedFieldType, …>`（`field-list.tsx:52`、`object-types.ts:246`、`field-editor-form.tsx:54,399`）。其余位置全靠 grep。**估计新人需要 1～2 天才能找全**，而且漏改不会报编译错误，只会表现成"某处筛选或导出静默不支持"。

### 5.2 "新增一个 AI 动作"（例如"修改负责人"）

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `packages/database/prisma/schema.prisma` | `AiOperationType` enum |
| 2 | 新迁移 | `ALTER TYPE` |
| 3 | `apps/api/src/modules/ai/ai-proposal.schema.ts` | zod 候选 schema |
| 4 | `apps/api/src/modules/ai/tools/propose-change.tool.ts` | 工具 schema 和提示词描述 |
| 5 | `apps/api/src/modules/ai/ai-operation.types.ts` | `AiOperationKind` |
| 6 | `apps/api/src/modules/ai/dto/ai-proposal.dto.ts` | OpenAPI enum |
| 7 | `apps/api/src/modules/ai/ai-proposal.service.ts` | `snapshot()` 和 `confirm()` 各加一个分支 |
| 8 | `apps/api/src/modules/ai/ai-operation.repository.ts` | 视图投影分支（`:59,103,254,289`） |
| 9 | `packages/contracts/src/ai/stream.ts` | 手写联合类型 |
| 10–11 | `openapi.json`、`generated/openapi.ts` | 重新生成 |
| 12 | `apps/web/src/features/ai/ai-stream-parser.ts` | 白名单（`:193`） |
| 13 | `apps/web/src/features/ai/ai-proposal-card.tsx` | 标签和渲染 |
| 14 | `apps/api/src/modules/ai/providers/fake-ai.provider.ts` | 测试 provider 的正则 |
| + | 目标领域的 Command（如果还不存在） | |

**约 14 个文件**，外加 Command 本身。改动面比字段类型小，但同一个字面量要手改 9 处，靠编译器发现不了遗漏。按 2.2 的"操作处理器表"和 P2 的共享常量改造之后，预计能降到约 6 个文件。

---

## 6. 不建议改的部分（避免为了模式而加模式）

| 不要做 | 理由 |
|---|---|
| 把 `record-value-engine` 的穷尽 switch 改成"字段类型插件 / 类继承体系" | 12 种类型加上 TS 穷尽检查已经是最佳形态；该集中的是"能力元数据"，不是行为 |
| 把 Action Engine 的 5 个 case 改成 DI 注册的 Handler 插件 | 类型集合是封闭的，而且随发布快照冻结；拆成同文件函数就够了 |
| 引入 Redux、Zustand 或全局 store | URL + React Query + 局部 state 已经覆盖需求，没有跨页共享状态的痛点 |
| 把 RLS 或 DB 触发器迁回应用层 | 数据库兜底是多租户产品的核心安全资产；只需要把**错误翻译**移出基础设施层 |
| 把 class-validator DTO 全面迁到 zod-openapi | 迁移成本高；现有 OpenAPI 生成和漂移检查运转良好。只对 JSON 配置引入共享 zod（P2） |
| 为了"架构完整"引入 CQRS、领域事件总线或消息队列 | Worker 现在没有业务需求；同步事务正是 Action Engine "全成全败"语义的基础 |
| 删除 repository 接口和 `Symbol` 注入令牌 | 有一些冗余，但它们是单测的接缝，删除收益低于风险 |
| 合并 Workflow Action 编辑器和自动化规则编辑器 | 用户心智和映射 DSL 不同，强行合并会产生条件分支更多的"万能编辑器" |
| 为清零 lint 去重写测试 | 637 个错误里没有生产代码的错误，修改规则 override 加一次格式化就够了 |
| 拆出更多 monorepo 包 | 只需要一个共享纯逻辑包（或扩展 contracts），不要按领域再拆包 |

---

## 7. 重构清单（按收益 ÷ 成本排序）

### A. 可以随功能开发顺手改的（每项不超过 1 天）

| 序 | 项 | 收益 | 成本 | 风险 |
|---|---|---|---|---|
| A1 | 修文档入口：设计索引指向 v3-final，V1/V2 归档，HANDOFF 重写成"当前事实"，移走根目录的两个杂项文件，新增 `extension-points.md` | 高（直接影响 agent 的正确率） | 小 | 无 |
| A2 | 删死代码：`record-detail-drawer.tsx` 及 3 个测试、`employee-permission-comparison.tsx`、`filter-bar.tsx`、6 个空 API 模块、27 个占位 README；`architecture.spec.ts` 和 `architecture-contract.test.mjs` 同步改 | 高 | 小 | 低 |
| A3 | CI 加 `eslint src` 门禁；测试文件执行一次 prettier，规则 override；在根 `lint` 前加构建前置步骤 | 中高 | 小 | 无 |
| A4 | 把 AI 操作类型收敛到一个常量（共享包或 contracts），9 处引用都从它派生 | 中 | 小 | 低 |
| A5 | 触发器错误翻译从 `context-runner.ts` 移到 records 模块，按 SQLSTATE 加 code 匹配 | 中 | 小 | 低 |
| A6 | 工作台筛选校验：删除 Web 端副本，改为共享（P2 的试点） | 中 | 小～中 | 中（ESM/CJS） |
| A7 | 改到哪个 feature，就补它的 queryKey 工厂；`record-api.ts` 改用 `Schemas[...]` | 中 | 小 | 低 |
| A8 | `ILIKE` 搜索转义 `%` 和 `_`（`records.repository.ts:1442,1497`，现状下用户输入 `%` 会被当作通配符） | 低 | 小 | 低 |

### B. 需要单独排期的

| 序 | 项 | 收益 | 工作量 | 风险 | 前置 |
|---|---|---|---|---|---|
| B1 | 字段类型描述符 `FIELD_TYPE_TRAITS` 加穷尽映射（2.4） | 高 | 中（3～5 天） | 低～中 | A1 |
| B2 | 拆 `RecordList`（以及 `ObjectDesigner`、`MemberTable`），抽 hooks 和子组件 | 高 | 中（每个 2～3 天） | 中，需要 Web 测试加人工走查 | A2 |
| B3 | 拆 `RecordsService`：查询解析器、导入、导出、活动；SQL 构建器移出仓储；自动化钩子上移到 Command | 中高 | 中 | 中 | A5 |
| B4 | AI Proposal "操作处理器表"，统一 Command 调用约定 | 中 | 中 | 中（先手动跑 AI 相关 E2E） | A4 |
| B5 | 共享 JSON 配置 schema（工作台、Workflow Action、自动化），替代 `dashboard-types.ts` 和 `workflow-types.ts` 的手写镜像 | 中高 | 大（逐类迁移） | 中 | A6 试点成功 |
| B6 | 打破 `objects ↔ records/actions/workflows/automations` 循环：抽出下层 `object-model`（schema、值引擎纯函数、pool 配置类型），`objects` 只保留草稿和发布编排 | 中 | 中 | 中 | B1、B3 |
| B7 | 全部 34 个 E2E 在 nightly 或手动 workflow 中运行，然后逐个修复失败 | 中 | 小～中 | 低 | 无 |
| B8 | 仓储里"SQL 字符串路由"的单测逐步换成 DB 集成测试 | 低中 | 中（随改随换） | 低 | 无 |

**建议顺序**：A1 → A2 → A3（一周内完成，几乎零风险）→ B1 → B2（`RecordList`）→ B3 → 其余按需求驱动。当前正在开发的销售跟进功能会再次改动 `record-list.tsx` 和 `records.service.ts`，**建议在它合并后再启动 B2 和 B3**，避免冲突。

---

## 附录：度量方法

- 文件行数：`git ls-files` 排除 `spec/test/e2e-spec/generated/migrations` 后执行 `wc -l`。
- 函数长度：用 `typescript` 编译器 API 遍历 `FunctionDeclaration/MethodDeclaration/ArrowFunction`，只统计具名且不少于 120 行的函数。
- 模块依赖：统计每个模块非 spec 文件中 `from '../<module>/'` 的出现次数。
- 死代码：对每个生产文件的 basename 做 `git grep`，排除自身和测试后引用数为 0 的视为死代码，再逐一人工确认。
- ESLint：`apps/api` 执行 `npx eslint "{src,test}/**/*.ts" -f json`（先执行 `prisma generate` 和构建 `@crm/database`）；`apps/web` 执行 `npx eslint .`。
- 规模：Web 生产代码 54,538 行、测试 33,568 行；API 生产代码 48,541 行、测试 62,739 行；Worker 81 行；contracts 手写约 110 行、生成 8,800 行；Prisma schema 1,082 行、47 个迁移。
