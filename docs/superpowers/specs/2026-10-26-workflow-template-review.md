# 完整流程模板继承：设计复核

结论：保留既定方向。模板来源 + 可空 workflow 创建/更新成员，以及仅针对模板初始化的原子批量发布，是当前架构下合理且较小的改动。无需引入通用导入框架、通用依赖发布器、假成员或系统租户管理员。实施前应合入以下修正。

## 已核对的现状

- `bootstrap.ts:38` 全局前缀为 `/api/v1`；平台 controller 是 `platform/business-templates`；对象管理是 `workspaces/:tenantCode/object-definitions`，`objects` 是员工运行时接口。
- `tenants.service.ts:153` 开始的创建事务只建公司及首个管理员邀请，再应用模板，没有可作为 workflow 作者的 TenantMember。
- workflow 作者字段均非空；`workflow.repository.ts:replaceDraft` 目前删除旧 workflow 再创建新行，并把两个作者都设为当前操作者。
- `ObjectsService.publish` 已有租户级 `lockLifecycleConfiguration`，对象行锁，版本比较，发布策略，CAS 保存及审计。`analyzePublication` 的 targets 由调用者注入，适合复用，不需要重新实现动作规则。
- `record-pool.service.ts:updateConfig` 立即更新 object 的公海列，单独递增 `poolConfigVersion`，不递增 object.version。现有对象 publish 并未调用公海保护规则验证，不能假设复用 publish 就已经覆盖它。
- 应用幂等键是 `(tenantId, templateVersionId)`，对象已有 `sourceTemplateVersionId`。当前空公司检查只检查对象和看板，不检查每日目标。
- 模板版本与应用表 RLS 只允许平台管理员读取（migration 0005），普通租户管理员不能 join 它们取模板名称或 objectIdMap。

## 必须修正的边界

### 1. 不可移植值不止 MEMBER 默认值和 LITERAL 映射

按字段类型和动作语义检查完整携带配置，而不是搜索 UUID 字符串：

- MEMBER 字段非空默认值。
- CREATE_RECORD.values 指向目标 MEMBER 字段的非空 LITERAL。
- UPDATE_RECORD.values 指向来源 MEMBER 字段的非空 LITERAL。
- automation mappings 指向目标 MEMBER 字段的非空 LITERAL。
- FIELD_CHANGED trigger 的来源字段是 MEMBER 且 equals 非空。
- 动作值 `{source:'ACTOR', memberId:'...'}`：当前协议明确接受这个可选属性，resolver 会要求该 ID 等于当前执行人。它并非纯动态 ACTOR，带入新公司会运行时报错。应阻止并定位到 `.memberId`；纯 `{source:'ACTOR'}` 可以继承。

对于已携带但禁用的 automation 也执行可移植性检查，避免之后启用才暴露来源成员依赖。不要删除固定值或改成 ACTOR 来悄悄改变业务语义。可空 MEMBER 映射 null 按现有字段校验处理。SOURCE_FIELD、SOURCE_META.ownerMemberId、ACTION_OUTPUT 以及纯动态 owner 保留。

检查应同时覆盖捕获预览、保存、模板发布及应用入口。保存允许一般尚未完成的流程草稿，但不能存入明确的公司专属成员绑定。发布执行完整图校验；应用至少复核完整模板可移植性及结构，不能只依赖旧 `findTemplateMemberDefaultBlockers`。

### 2. 一次初始化发布的严格范围与并发

- 输入对象集合必须与事务内该来源组的全部当前待发布对象集合完全一致：不接受遗漏、重复、额外 ID、跨租户 ID 或混合来源。
- 资格检查使用非空 sourceTemplateVersionId、同租户、未归档/删除、无任何历史 publication、无任何 records（包括软删除记录）。仅 `activePublicationId === null` 或 active record count 为零不足以证明从未发布/无记录。
- 已单独发布对象仅以当前 ACTIVE publication 充当依赖，不读取其未发布草稿，也不重发或覆盖。
- 复用租户配置锁，按固定 ID 顺序锁候选对象，然后重新查询组集合、版本、发布历史、记录数、公海配置。同事务验证全部，再创建全部 publication/指针/审计。
- 初始化确认需要 `expectedPoolConfigVersion`；公海变更不会触发 object expectedVersion 冲突。GET 摘要返回当前 poolConfigVersion，POST 逐表比较它。每次发布使用当前公海配置而不是模板旧副本。
- 候选 schema 与既有 ACTIVE schema 合并成统一 target map，但只有初始化路径允许候选充当 target。单表发布继续要求已发布目标。
- 复用 analyzePublication/compilePublication 和既有入向 automation 检查。候选之间的出向 action/automation 必须全部通过；对整个有效图检查启用公海保护规则的来源表与状态存在。把公海检查提为小型纯 helper，供配置保存及模板/初始化验证复用。
- 不在事务外生成已确认的结果再直接落库，不调用多次独立 `publish()` 伪装原子发布。

### 3. provenance 与作者最小迁移

可以为 ObjectWorkflowDefinition 增加 `sourceTemplateVersionId` 外键，允许 createdByMemberId/updatedByMemberId 为空，并加 CHECK：`source_template_version_id IS NOT NULL OR (created_by_member_id IS NOT NULL AND updated_by_member_id IS NOT NULL)`。保留已有 `(tenant_id, member_id)` 外键。

模板初始化专用写入路径填来源，作者为空；普通创建函数依然要求真实 actorMemberId，不开放外部 DTO 对作者/来源赋值。写入时验证 workflow 与所属 object 的模板来源一致。

由于 replaceDraft 是删除重建，必须明确保留原 workflow 的 sourceTemplateVersionId、createdByMemberId（模板初始作者仍为空），新 updatedByMemberId 使用当前成员。不能只改 schema 而让首次编辑丢失来源/伪装为管理员创建。无需为此扩大到其他业务表的通用 provenance 框架。

### 4. 无覆盖和 RLS

模板应用既支持 DRAFT 也支持空 ACTIVE 公司。加入目标规则后，若目标公司已有任何 WorkGoalRule，应拒绝本次初始化，不能 upsert 覆盖，也不能遇同 metric 才静默跳过。让 canApplyTemplate/summary 使用同一空配置判断。写入与现有 `tenantId + ':goal:' + metric` 锁序协调，避免空检查后并发创建规则；可先锁此次可写入的固定六个 metric，再检查并 insert，唯一键作为最后防线。

捕获读取由平台身份授权，事务内明确设置 app.user_id 和来源 app.tenant_id，并且所有查询仍带来源 tenantId；不要为捕获构造假的租户成员上下文，不调用必须有成员的租户服务。

租户初始化 GET/POST 不要通过平台模板表 join 取名称或应用记录来绕过 RLS。最小方案是只按租户对象现有 `sourceTemplateVersionId` 分组，使用来源 ID 作为不透明键，删除 proposed response 的 templateName。对象来源不可经普通对象更新 DTO 修改，且应用唯一键已保证同一租户该版本只有一次应用。若非要名称，应另做受限元数据投影，不能放开模板版本 JSON 或跨租户应用表读取；本轮不需要它。

### 5. 旧模板和前端不会丢配置

在 schemaVersion 1 上增加可选扩展即可；不需要迁移全部历史 JSON。建议对象新增 `workflow?`、`automations?`、`pool?`，顶层新增 `goalRules?`；沿用 `dashboard?`。pool 只存业务配置，不存来源 version；新租户 poolConfigVersion/work goal version 均从 1 开始。目标不存原 id、tenantId、memberIds 或 timezone。

checksum 对不存在的扩展字段保持完全省略；不能把旧对象补成 `workflow:null, automations:[], pool:{...}` 或顶层补 `goalRules:[]` 后再计算旧 checksum。先以持久化旧形状校验，再在 hydrate 内给缺省行为。新字段必须进入 checksum，动作数组保持顺序，避免 canonicalization 改变执行顺序。

`template-draft.ts:templateDraftFromDetail` 与 `toTemplateConfiguration` 当前都逐项重建结构，而且已经不保留 dashboard；扩展须贯通 API DTO、presenter、web API types、TemplateDraft、反序列化/序列化、编译和 checksum，不能只在后端 JSON 上加字段。模板变更摘要应能显示 workflow/automations/pool/goals 变化，不能显示“无变化”但实际有新流程。

capture 只修改本地草稿，用户确认后仍走已有 expectedVersion 保存，再现有发布分析/发布。预览返回的结构同时要带既有 publishedCode/publishedFieldKey/publishedType 锁定元数据，或前端通过当前 detail 合并元数据，不能把原始 configuration 当成完整 detail 直接传给转换函数。

保留现有 dashboard 后，如果替换流程移除了它引用的 object code，应报告具体阻断，不能悄悄删除 dashboard。按 code/fieldKey 复用模板身份时，优先当前草稿，其次已发布历史中的匹配身份，避免先删除再捕获绕过身份约束。相同字段键的类型变更仍由现有历史检查阻止。

## 固定接口建议

保持平台路径：

`POST /api/v1/platform/business-templates/:templateId/capture-preview`

请求：`{expectedVersion, sourceTenantId}`。

返回：`{configuration, sourceTenant:{id,name,code}, excluded:{unpublishedObjects,memberOverrides,selectedGoalRules}, summary:{objects:[{id,code,name,fieldCount,stateCount,automationCount,poolEnabled}],goalRuleCount}, blocking:[{code,message,objectId?,fieldKey?,path?}], warnings:[{code,message,path?}]}`。

preview 为只读，expectedVersion 验证目标模板草稿；一致事务读取来源当前 ACTIVE publications、即时 pool 及 goals，不读 object/field/workflow 草稿替代 publication。若有不移植值/图引用缺失，返回可定位 blocking 且禁止确认保存；不把问题降为普通 warning。

调整租户路径为：

`GET /api/v1/workspaces/:tenantCode/object-definitions/template-initialization`

返回：`{groups:[{templateVersionId,objects:[{id,name,code,version,poolConfigVersion}]}]}`。

`POST /api/v1/workspaces/:tenantCode/object-definitions/template-initialization`

请求：`{templateVersionId,objects:[{id,expectedVersion,expectedPoolConfigVersion}]}`。

成功：`{published:[{id,code,name}]}`。集合/版本变更用 409；图校验错误沿用 PUBLICATION_BLOCKED 422，并返回对象及路径定位。GET/POST 均要求 TENANT_ADMIN，固定路由声明放在 `object-definitions/:objectId` 前，避免参数路由截获。重复提交已经发布的旧对象列表返回冲突要求刷新，不需额外幂等表。

## 最终实施划分

1. 扩展现有模板 DTO/类型/策略和纯配置映射；capture 从发布快照构造便携配置；新增字段贯穿编辑器与 checksum。
2. 在原模板应用事务写入 workflow/actions/settings.automations/pool/goals，来源 migration 保持局部，保持全新 ID 与旧幂等规则。
3. 在现有对象服务加初始化列表/批量发布，提取必要的共享验证/提交 helper，前端只增加预览确认及发布入口。

设计审阅未修改产品代码，未运行测试。实施时最有价值的额外反例是：ACTOR.memberId、MEMBER trigger.equals、只变更 poolConfigVersion、目标公司已有 goal、普通租户管理员因模板表 RLS 不可读、旧 checksum、保存字段后 dashboard/流程原样保留。
