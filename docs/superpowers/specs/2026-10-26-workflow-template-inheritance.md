# 完整流程模板继承设计（2026-10-26）

## 目标与边界
把已经在一家公司配置并发布的通用业务流程保存为平台模板，新公司继承完整可发布草稿。保留现有模板版本、应用幂等、空公司限制和管理员发布机制；不复制业务记录、人员、成员例外权限、统计历史，不自动覆盖既有公司。两个功能各自独立 PR，本地测试验收后合并，暂不部署。

用户已批准开发；这是完整业务流程模板，不是整个公司的数据库克隆。已有工作台模板继续保留，复制业务流程不替换工作台配置。

## 模板内容
- 每个 ACTIVE 且已发布业务表的已发布字段/选项/校验、列表/搜索/排序、员工默认权限；未发布的更改不复制。
- 已发布状态流程（states/transitions/actions）和跨表自动化规则（trigger/mappings/allowedRoles/owner）。引用保持稳定 object code/field key/state key，实体 ID 重新生成。
- 当前即时生效公海配置：启用、领取/跟进期限、标签、来源表+状态的成交保护规则。模板内全图验证来源表和状态存在且合法。
- 公司 ALL_EMPLOYEES 每日目标（6个指标、目标、提醒时间、工作日、enabled）；不复制 selected-members 规则，预览明确提示其数量。目标按目标公司的时区计算。
- 工作台：保留现有模板 dashboard；本轮流程复制不导入来源公司工作台，不丢掉现有dashboard序列化。
- 只保留员工默认权限，不复制 member overrides。业务字段中的具体 MEMBER 默认值或映射 LITERAL 成员 ID 必须阻止保存/发布并明确字段，不能带入另一公司。ACTOR、SOURCE_OWNER 等动态来源可保留。记录 ID 字面引用现有动作协议已不支持。

## 平台交互
在已有模板编辑页增加“从公司复制流程”按钮。平台管理员选公司，读取预览（只读），看到包含哪些表、字段、状态、规则、公海/目标及被排除项目，再确认替换当前模板业务表草稿。保留模板名称、代码和dashboard。dirty 时先保存或放弃，不暗中覆盖未保存编辑。
后端 preview 接口返回完整可保存配置以及来源摘要、警告；模板草稿仍走既有 save expectedVersion 与 publish analysis。按现有模板中的 code / fieldKey 保留模板对象/字段 ID，避免重新读取相同来源导致身份校验误判；新对象/字段生成新 ID。
普通模板编辑器必须读写保留 workflow/automations/pool/goals/dashboard，修改字段后跨图验证给出具体错误，不能静默丢失流程。

## 新公司继承
现有创建公司只创建首个管理员邀请，没有成员，不能伪造发布者或借用来源成员。
- 应用模板原子写入所有业务表草稿、字段/权限/列表、workflow草稿与动作、automation settings、公海配置及全体员工目标；生成全新 ID。
- workflow 的 created/updated member 引用允许在模板初始化时为空，并有 sourceTemplateVersionId 来源记录；约束要求无成员创建者的行必须有模板来源。管理员后续修改时写入当前成员，不伪造作者。增加最小 migration，保留普通创建现有约束/逻辑。目标表不需要成员引用。
- 管理员进入“业务表管理”，可看到“发布初始化流程”按钮和待发布表摘要。该操作只处理同一次模板应用、从未发布且无记录的草稿，所有期望版本匹配后一次事务内验证/发布。用户已单独发布的表作为已发布依赖，不覆盖它。若待发布表的任何配置错误，整套不写入发布指针。
- 校验用所有待发布候选+公司现有已发布目标组成统一映射，解决客户与订单互相引用的首次发布顺序问题。复用 analyzePublication/compilePublication、跨表依赖和公海保护校验；避免复制独立发布逻辑而不共享。
- 对每张表记录当前管理员的真实发布者和审计，旧记录不搬入公海。
- 工作台继续独立确认并发布，与当前模板机制一致。

## 固定 API
平台 POST /api/v1/platform/business-templates/:templateId/capture-preview，body {expectedVersion,sourceTenantId}，只读返回 {configuration,sourceTenant:{id,name,code},excluded:{unpublishedObjects,memberOverrides,selectedGoalRules},summary:{objects:[{id,code,name,fieldCount,stateCount,automationCount,poolEnabled}],goalRuleCount},blocking:[{code,message,objectId?,fieldKey?,path?}],warnings:[{code,message,path?}]}。configuration 使用带publishedCode/publishedFieldKey/publishedType的现有模板response形状，便于UI保留历史身份；保存时使用既有draft serializer去掉response-only属性。
公司 GET /api/v1/workspaces/:tenantCode/object-definitions/template-initialization 返回 {groups:[{templateVersionId,objects:[{id,name,code,version,poolConfigVersion}]}]}。不读取平台模板名称。
POST 同路径 body {templateVersionId,objects:[{id,expectedVersion,expectedPoolConfigVersion}]}；成功返回 {published:[{id,code,name}]}。事务内重新检查全部候选集合/版本/资格；409表示集合或版本变化；422表示整图校验阻断。

## 验证
- RED先证明现有模板丢失workflow/automation/pool，再修复；兼容无新字段的旧模板与checksum。
- 完整流程source→模板发布→新公司创建（尚无成员）→新管理员激活→整套发布→员工领取→询单字段→跟进→创建订单→订单确认→客户成交保护，不重复执行、不提前保护。
- 快照只用已发布内容；未发布表/成员权限排除明确；跨租户固定成员默认/映射阻断；相互依赖可发布；一处invalid全回滚；相同version重复应用不重复对象。
- 保存模板基本信息/字段后流程和dashboard不丢；旧公司修改及业务记录哈希保持不变；员工与非平台管理员不能平台capture。
- 新目标按新公司时区和新员工受众；指定成员目标没有跨公司迁移。

## 设计复核后的约束（优先于上文同名接口草案）
实施必须合入 docs/superpowers/specs/2026-10-26-workflow-template-review.md 的边界修正：使用 object-definitions 路由；不向租户管理员开放平台模板表/名称；配置包含不可移植 ACTOR.memberId 和 MEMBER trigger.equals 时阻断；初始化每对象确认 expectedPoolConfigVersion，匹配事务内全部待发布集合（无任何历史发布、无任何包含软删除的记录）；全部图验证后再写发布。
workflow provenance 外键+作者CHECK，仅内部模板hydration可置空，正常编辑保留创建者/来源、更新实际修改者。
空公司还要求没有任何目标规则，协调固定六个metric锁与save规则，已有同模板应用先返回幂等结果。
旧checksum必须保持旧JSON形状，新可选扩展不缺省补值；编译/摘要/DTO/presenter/前端序列化全部贯通，并修复既有模板编辑时dashboard丢失。
最终接口及返回以设计复核报告“固定接口建议”为准。该报告随新feature分支复制到docs/superpowers/specs/2026-10-26-workflow-template-review.md，成为本设计组成部分。

## 既有业务表代码兼容
运行时 OBJECT_CODE_REFERENCE_PATTERN 允许历史下划线代码，而模板对象 DTO/前端校验目前只允许连字符。流程捕获不得重命名来源业务表来通过校验，避免破坏自动化/保护引用。模板对象配置的存储、保存和发布应接受现有运行时 reference pattern；模板自身 code 和新建对象输入继续沿用现有命名要求。前端捕获后的整体配置合法性检查应识别有效历史代码；新增/手动改名仍可保持 canonical 新代码约束。补旧 underscore 来源双表关联继承的回归。若历史 identity 已发布仍按原身份不可改规则约束。
