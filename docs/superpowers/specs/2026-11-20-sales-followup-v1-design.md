# 销售跟进 V1 设计规格

已批准修订 · 2026-11-21。销售从客户表找到要联系的人，记录谈话，确认纪要与下次跟进，在原页面核对结果。实现顺序为 **B 契约与服务端 → A 客户表 → C 整理本次沟通**，三个批次在同一版本交付。所有已发布业务表共享视图能力，界面改动限记录列表、记录详情及所需的共享契约、API 和数据模型。看板、日历、嵌套分组编辑器、冻结列、拖动填充、自然语言筛选、AI 字段、业务队列、外部同步及语音均后置。

## B1　页面、API 与 AI 共用的筛选规则

在 `packages/contracts/src/records` 定义版本化类型、运行时结构校验和一张操作符注册表，导出字段类型、操作符、值形状与中文标签。Web 从注册表选择控件；API 按当前发布字段及权限校验；`search_records` 与 `aggregate_records` 从同一注册表生成模型输入说明，继续调用 RecordsService。只有 API 把规则翻译为数据库条件。

```ts
type FilterRule = FilterGroup & { version: 1 }
type FilterGroup = { match: 'all' | 'any', conditions: (FilterCondition | FilterGroup)[] }
type FilterCondition = { fieldKey: string, operator: FilterOperator, value?: FilterValue }
```

`FilterOperator` 是下表各操作符的并集。`FilterValue` 由操作符判定：文本、有限数值、布尔值、日期字符串、枚举、非空数组或闭区间 `{from,to}`。空值操作省略 value。待跟进条件的 value 为 {assignee: "$me" | "any"}，缺省为本人。系统字段使用保留的 `$` 前缀；成员占位值为 `$me`，执行时由会话解析为当前**租户成员 ID**。

| 字段 | 操作符 | 值及语义 |
| --- | --- | --- |
| TEXT / TEXTAREA / PHONE / EMAIL | contains、notContains、eq、empty、notEmpty | 匹配字面文本，沿用现有包含查询的大小写口径；等于是整值匹配 |
| SINGLE_SELECT / MULTI_SELECT | in、notIn、empty、notEmpty | 活动选项 key 数组。多选取交集非空；notIn 表示无交集 |
| MEMBER / 系统负责人 `$owner` | in、empty、notEmpty | 本租户可选成员 ID 或 `$me` 的数组；记录负责人使用系统列 |
| NUMBER / MONEY | eq、gt、lt、between、empty、notEmpty | between 包含两端。金额用十进制字符串比较；兼容旧单边上下限时保留 gte、lte |
| DATE / DATETIME | on、before、after、between、relative、empty、notEmpty | 明确日期用 YYYY-MM-DD；某天及闭区间按租户日历计算，时间戳用起日零时至末日次日零时之前。before 和 after 排除指定整天 |
| BOOLEAN | eq、empty、notEmpty | true 或 false。false 有值 |
| ATTACHMENT | empty、notEmpty | 契约保留判空操作。现有发布策略禁止发布附件字段，因此本版筛选面板不会出现此类型；记录详情中的附件沿用既有权限 |
| 系统条件 `$followUp` | dueThroughToday | 默认所有角色仅本人；any 表示可见范围内任何人，员工仍限本人的可见待办 |

- 根空 all 表示无字段条件。空 any、空子组、未知版本/键/操作符、错误值、失效或隐藏字段统一返回现有 `invalidRecordFilter()` 错误，不返回字段名。建议上限为合计 16 个叶条件、含根最多 3 层、每个多选值最多 20 项。否定比较仅匹配有值的字段，缺值由 empty 显式选择；0、false 不算空。保留已有相对日期枚举 today / this_week / this_month / past_7_days / past_30_days。
- 列表、条数、聚合及导出共用同一规则语义。在既有租户、有效对象、记录可见范围外层作 **AND**，用户的 any 仅组合内部条件。数据库侧参数化构造谓词，再排序分页；同字段允许多条件。系统负责人具有与手动筛选相同的权限范围，工具不接受调用者身份覆盖。
- 旧链接、已有 AI 和浏览器的扁平输入在入口转换为 v1，所有相对日期统一按租户时区。保留含界范围、关键词、公海范围等旧查询条件。API 可解析嵌套；V1 面板编辑一层。读取已有嵌套规则时展示分组摘要并保留原树，禁止静默压平。

**今天待跟进。** 复用 [Sales Workbench 时间边界](../../../apps/api/src/modules/follow-ups/follow-up-workbench-time.ts) 与 [跟进可见范围](../../../apps/api/src/modules/follow-ups/follow-ups.repository.ts)。单次请求固定 now 和租户时区，复用 today/overdue 分桶：逾期为 `dueAt < now`，今日剩余为 `now <= dueAt < tomorrowStart`。以 SQL EXISTS 关联同租户、同记录的 OPEN 跟进，二者并集即 `dueAt < tomorrowStart`，同一记录始终只占一行。预置对员工与管理员一律按当前成员筛任务，与个人工作台一致。管理员可另存“团队今日待跟进”并选任何人；员工打开时仍与自己的跟进可见范围取交集。下次跟进列取同范围最早 OPEN 到期时间，升降序均空值置后，以稳定记录 ID 打破平局，分页前排序。新增 record_follow_ups (tenant_id, record_id, status, due_at) 的 OPEN 部分索引。覆盖跨午夜、夏令时、恰在 now/次日零时、已完成/取消、他人任务及一客多任务。

## B2　服务端视图、预置与旧数据

扩展 [ViewDefinition](../../../packages/database/prisma/schema.prisma)，复用原来的列和排序。移植时在主线 `0048_admin_activity_delete` 后依次应用 `0049_record_views` 和 `0050_ai_record_drafts`，事务内回填后建立约束。拟增加以下列：

| 列 | 约定 |
| --- | --- |
| scope、ownerMemberId | DEFAULT 为对象设计器的既有默认视图；SHARED 归租户；PERSONAL 归成员。仅 PERSONAL 必须有 owner，以 (tenantId, ownerMemberId) 复合外键关联成员 |
| filterRule、columnWidths | JSONB，默认空 all 和空映射。宽度按列 key 存整数 CSS px，建议 88–640；投影时裁剪不可见列及其宽度 |
| queryOptions、revision | queryOptions 保留命名视图的关键词及已有公海等列表范围；不保存页码。revision 作乐观锁，两人同时编辑时提示重载或另存 |

- 保留旧行的 code=default、设计器 PUT、已发布快照及默认列/排序来源；既有发布、复制、模板导出和清理路径明确限定 DEFAULT。运行时视图引用已发布的元数据。预置初始继承发布列/排序，显式自定义后再覆盖。运行时采用稳定 code 和已有对象内唯一约束，用户名称可改；员工可将共享视图另存为个人视图。
- 接口位于现有 workspace 下的 `objects/:objectCode/record-views`。GET 列表/详情、POST 新建、PATCH 带 expectedRevision、DELETE 归档。记录列表接受 viewId，在服务端装载，临时编辑使用显式规则预览。个人视图仅本人读写，活动成员可读共享视图，只有租户管理员可写共享。对象和字段权限在每次读、保存、执行时复核。若共享规则引用了用户不可看的字段，返回无敏感字段的“该视图条件不可用”，禁止执行或靠移除条件扩大结果；仍可切换至有权限的“全部”。
- 迁移替换旧的宽泛 `view_definitions_tenant_access`，保持 ENABLE / FORCE RLS。按 `app.tenant_id`、`app.user_id` 与活动租户成员身份对各 scope 配置 SELECT、写入 USING/WITH CHECK，禁止更改归属/对象绕权。DEFAULT 保留既有配置及模板初始化的受信路径；运行时普通成员无 DEFAULT 写权限。新增 AI 草稿与关联同样使用复合租户外键、FORCE RLS 和最小授权。以受限 `crm_app` 直连集成测试验证跨租户、同租户不同成员和管理员的读写矩阵。
- 三条共享预置为 **全部（按权限）／我负责的／今天待跟进**，对应空 all、`$owner in ["$me"]`、`$followUp dueThroughToday`。对所有已发布业务表按稳定 code 幂等创建，迁移回填已有表，新表首次发布补齐；管理员可归档，重新发布不会复活，也不覆盖已修改视图。验收夹具使用带阶段、金额的业务表。
- **浏览器导入。** 检测当前公司／成员／对象的原保存键，只在首次发现时显示“把本机保存的 N 个筛选方案导入为个人视图”。用户选择导入后直接转换可导入项；用来源指纹作为稳定导入键，避免超时重试重复建视图。只清除服务端已确认成功的条目。已停用条件、不可见字段、无损转换失败项显示原因并保留本机原条目；用户可选择稍后从视图管理手动重试。原有个人显示列作为新视图的初始选择，保持无权限列隐藏。

## A　客户表与提议入口

2026-11-22 移植时沿用主线蓝色工作区、侧栏、客户表和完整详情页。客户表保留现有分页、选中、批量及公海操作，最近沟通摘要可打开原有的历史抽屉。下面的线框说明视图与客户的操作关系。

```text
客户
[今天待跟进 ▾] [搜索客户…] [筛选 2] [排序] [列] [更多] [+ 新建]
[负责人 · 我 ×] [阶段 · 报价 / 谈判 ×]
客户名称             负责人      阶段        下次跟进          行操作
远山科技             陈林        报价        今天 14:00        打开  整理本次沟通  ⋯
```

- 仅一行主工具栏，视图名称旁在脏态显示“已修改 · 保存 / 另存为”，员工改共享视图时仅提供可执行的另存操作。手机保留主线记录卡片，视图与搜索分行，显示设置使用图标按钮。chips 独占条件摘要行，点击定位对应条件，× 移除。切换或关闭有未保存修改的视图时可保存、放弃或返回。
- 点“筛选”弹出面板，顶端选“满足所有／任一条件”；每行“字段／比较方式／值／删除”，底部可添加、应用或取消。更换字段清理不适用的操作符和值。成员可选“我”，选项多选，日期有具体日、区间和相对预设。“阶段”仅取业务对象已配置的可见阶段字段或工作流状态；客户名称为主列；系统下次跟进不产生逐行请求。
- 表头显示字段类型图标和可键盘调整的拖宽柄，松手更新视图草稿。行操作在悬停或键盘聚焦时显现，触屏在“更多”中可达。记录详情的活动区域提供同一“整理本次沟通”入口。有读权限但无写权限时保留只读体验。动作使用既有主题过渡与减少动态效果设置。
- 无对象权限显示访问受限。获准且无筛选、可见记录为零时显示“暂无可见客户”；有条件时零命中提供“清除条件”。绝不通过全租户计数揭示权限外的记录。

## C　整理本次沟通

专用接口前缀为 `/api/v1/workspaces/:tenantCode/objects/:objectCode/records/:recordId/communication-drafts`。行内和详情共用同一记录上下文。使用当前身份、实际目标及已发布字段校验，模型没有写工具。

1. **POST 草稿**，输入 `{ requestId, text }`，原文 1–4000 字。按 V1A 先取可见记录字段、最近可见活动和该记录本人 OPEN 跟进，再经过 AiSanitizer 和既有上下文大小限制。服务端提供固定时钟、租户时区、可编辑字段及活动选项；系统字段、隐藏、只读和流程控制的状态从可建议字段中排除。专用 provider 方法按严格 JSON schema 返回草稿，测试环境复用 fake。模型输入中的原话与 CRM 内容均按数据处理。
2. **模型输出及卡片数据**如下。未知字段或无效选项不能成为可执行建议。服务端核对 evidence 对应原话片段，补上 itemKey、字段元数据、受权限裁剪的旧值和记录版本。日期表达由服务端按租户日历解析：建议“下周”取下一自然周周一，“月底”取当月最后一天，均显示原话与“建议”并可改；未给出时刻建议当地 09:00，含糊到无法定位则让用户选择日期。确认请求发送带偏移的 ISO dueAt。

```ts
type CommunicationOutput = {
  note: string
  followUp?: { title: string, suggestedDate: string | null, evidence: string }
  fieldChanges?: { fieldKey: string, value: string | number | boolean | string[] | null, evidence: string }[]
}
```

3. **可编辑卡片**使用受控 props `{ items, selectedKeys, itemResults, busy, onSelect, onEdit, onConfirm, onRetry }`。item 是 note、followUp 或 fieldChange，由调用方提供稳定键、编辑草稿、元数据与校验信息。纪要多行输入；待办编辑标题和日期；字段显示“旧值 → 新值”，选项从发布元数据读取。默认勾选纪要及存在的待办，字段修改默认不勾。只在某个已选项缺少必填值时阻止该项提交。共享卡片负责渲染和交互，记录动作与既有聊天卡各自适配服务端结果。
4. **POST `:draftId/confirm`**，输入 `{ items: [{ itemKey, editedValue }] }`，仅提交选中项。**GET `:draftId`** 可恢复逐项结果。服务端将最终编辑值重新校验，分别产生 ADD_ACTIVITY_NOTE、CREATE_FOLLOW_UP 和一个合并所有勾选字段的 UPDATE_RECORD 提议（values 最多 50 个字段），复用 [AiProposalService 确认链路](../../../apps/api/src/modules/ai/ai-proposal.service.ts)。隐藏／只读字段、伪造的键和跨记录目标在服务端拒绝；成功项返回 auditId 和结果，失败项返回安全原因。成功审计沿用原命令，失败尝试逐项记录受控状态、原因及请求号，和成功审计明确区分。
5. **草稿归属、并发与重试。** 新增成员私有的 `ai_record_drafts`，绑定租户、记录、对象、发布版、起始记录版本、操作者、请求键和到期时间。同一成员、记录、请求键只创建一个草稿。现有 AiOperation 必须挂聊天回合；扩展为“聊天父项或记录草稿父项二选一”，旧数据保留原关联。草稿项在库中唯一 `(tenantId,draftId,itemKey)`，绑定实际幂等 proposalId，已成功项不可改写。至多三项按纪要、待办、字段更新的顺序分别提交，各自在执行时复核身份、权限、原始发布版及记录版本。字段更新整体成功或失败，置于最后；移除草稿内部版本串联。每项业务结果与成功审计原子提交，外部修改产生冲突。重复请求、断线和部分失败通过稳定键恢复结果，绝不重放成功项或用任意最新版本覆盖他人修改。聊天历史查询与原有确认重试保持原语义。
6. **失败与回显。** 先在当前租户和成员范围登记请求键与草稿 ID，再调用模型。Provider 超时、不可用或输出无效时，响应仍带草稿 ID、可执行的手工纪要项和安全错误码，前端保留原文；响应丢失则以同一请求键恢复。点“直接存为纪要”只确认这条 note，沿用同一 itemKey、记录权限及审计。批次结果按项返回，Web 立即更新或失效重取活动、待办、详情和列表相关查询，保留失败项的编辑。

记录草稿项只能通过所属草稿的确认入口执行；聊天的通用确认端点校验来源，避免绕过草稿锁和顺序。同一 itemKey 已成功时返回原结果；校验失败后如需调整内容，仅为尚未成功的项创建新尝试，仍按逻辑 itemKey 去重。对归属于本人的草稿，失败项写入失败审计事件并保留请求号，不记录隐藏字段名或原话。无权访问他人草稿时沿用现有通用拒绝响应。

## 验收与证据

每批先补能复现目标行为的测试，再实现。批后运行 `pnpm typecheck`、相关包单元测试及使用隔离库的 `pnpm --filter @crm/database test:integration`。契约变化另跑 `pnpm contracts:check`；关键 HTTP 权限及提议路径另跑 API E2E。每次界面改动先在同一场景拍基线，再拍新界面，保存在 `docs/audits/2026-11-22/sales-followup-main/`，记录视口、角色、夹具、期望与实际。下表列出验收标准。逐项实测、截图及真实模型验证状态见[本地验收记录](../../audits/2026-11-22/sales-followup-main/README.md)。

| 验收 | 必须观察到的结果 |
| --- | --- |
| 员工切“今天待跟进” | 昨日逾期、今日晚些时候的 OPEN 均出现；明日、已完成、取消、无权客户排除；多待办的同一客户只出现一次 |
| all / any、跨浏览器 | “负责人是我 AND 阶段是报价或谈判 AND 预计金额 > 100000”保存后另一独立浏览器登录同员工，条件、列宽与记录 ID 相同。另建 any，以仅满足其中一条的记录证明 OR。嵌套、深度/叶数、非法规则、旧 JSON 及权限外层 AND 用 API 测试覆盖 |
| 团队共享 | 管理员创建含 $me 的共享视图，两员工分别登录，得到各自结果；查不到对方个人视图，不出现隐藏字段和隐藏条件值；部分导入失败仍可恢复 |
| 沟通入档 | 行内、详情均可进入；贴“预算还没批，下周再联系”，将建议日改为该周周三。当前页直接见纪要、待办和正确日期，审计逐项可核对 |
| 只读字段与部分失败 | 员工的候选不含只读字段；从该浏览器会话构造无权更改，由 API 拒绝并核对业务值未变。模拟第二项失败、双击、断线重试，成功项仅写一次 |
| Provider 故障 | 本地 fake 模拟超时或不可用，原文仍在，点“直接存为纪要”追加一次活动且无待办。浏览器使用隔离测试部署的 `NODE_ENV=test / AI_PROVIDER=fake`；真实模型单独标记“未验证” |

按已批准的 B → A → C 实现计划，在功能分支分批实施；推送与开 PR 前另行确认。
