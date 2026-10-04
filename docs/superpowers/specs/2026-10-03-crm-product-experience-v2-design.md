# CRM Product Experience V2 — Stage Design

Date: 2026-10-03

Status: SLICE 1 IMPLEMENTED AND MERGED — SLICES 2＋3 AUTHORIZED / ACTIVE — SLICE 4 PLANNED

Base main SHA: `70884f5eff78669e369cd36e6fbd8d9f9ac9d089`

Branch: `docs/crm-product-experience-v2-design`

Scope contract: [Stage Brief](<../briefs/2026-10-03-crm-product-experience-v2-stage-brief.md>)

本文件保留阶段方向；2026-10-03 后续用户要求检查全局和优化 V2 计划，现补充 [第一切片实施计划](../plans/2026-10-03-crm-product-experience-v2-implementation.md) 与 [项目审计](../../audits/2026-10-03/project-review.md)。Slice1已通过PR #24合并；当前用户批准Slice2＋3联合实现。

**版本说明：** 本阶段是 CRM Product Experience V2；AI Assistant UI V2 已合并，Full Roadmap V2.2 Sales Execution 是另一未批准阶段。后文浏览器证据来自初稿走查，本轮自动化复核不冒充新一轮浏览器验收。

## 1. Current Product Experience

### Baseline and method

最新 origin/main 经 fetch 后确认为上述 SHA；全新 docs worktree 从该点创建。浏览器使用该 worktree 原样 Web/API、本地 3100/3101 与用户批准的新隔离数据库 55434/crm_v2_browser。既有演示夹具有 6 个发布对象、96 条记录、2 Admin / 8 Employee；本轮登录陈静、赵晨。既有受限 runtime 角色没有变化。无旧 worktree runtime、真实库或部署环境作为产品基线。

Workflow V1、Action Engine V1、Sales Workbench Lite、AI V1A/V1B 均为既成能力。V1B COMPLETED — MERGED AND VERIFIED；Production Essentials PLANNED。此检查只认识页面体验，不重新进行这些能力的审计。

1440 / 900 / 390 是 CSS viewport **宽度**，检查高度为900。以下矩阵表示实际浏览情况，不表示全功能测试通过。

| Product surface | Tenant Admin | Employee | 1440 / 900 / 390 的实际观察 |
| --- | --- | --- | --- |
| Workspace 首页 / Workbench | 已发布销售运营工作台、配置入口、指标/趋势/排行/记录 | 同一已发布工作台的权限投影 + 我的跟进 + 新建/打开快捷入口 | 三宽度真实查看；900侧栏仍为224px，内容约676px；员工390工作面长约2066px |
| Follow-up | 分配给当前 Admin 的空态 | 初始空态及一条今日事项；完成/改期/转交/取消入口 | 三宽度真实查看；空态引导从记录详情安排下一步，但无直接业务入口 |
| Record List | 16条线索、负责人筛选、管理动作 | 2条本人线索；也查看 Activity 对象 | 三宽度真实查看；桌面表格、手机已有卡片，不需要从零设计移动列表 |
| Record Detail | 商机字段、管理动作、Follow-up/关联/附件/活动 | 同一有权商机，添加一个今日事项与一条NOTE | 三宽度打开；直接URL仍保留列表背景并打开抽屉；内容是多个功能区的连续栈 |
| Object Designer / Fields | 基本设置、字段账本、单选字段配置抽屉、实时预览 | 非员工工作面，未越权访问 | 1440有预览、900隐藏预览；390有明确转桌面提示；另观察已打开抽屉后缩窄，不能把过渡坐标作为缺陷依据 |
| Permissions | 对象员工默认权限、字段访问、赵晨成员访问页 | 仅作为已有授权投影使用，不修改权限 | 三宽度查看；对象默认发布生效与成员覆盖保存立即生效已写明，需保留其差异 |
| Dashboard | 已发布展示 + 组件编辑器 | 仅有权已发布展示 | 三宽度查看；编辑器900组件库先于画布、390画布动作约y=1252，编辑任务被较长配置头和组件库推后 |
| Workflow | 流程页、空配置与未保存的状态/动作输入、执行动作入口 | 无现成发布流程夹具，未声称查看员工运行态 | 1440/900查看配置，390同Object转桌面；状态/动作仅客户端尝试，未保存/发布 |
| AI Assistant | 新会话空态、建议、输入区 | 同一权限感知入口 | 三宽度查看；1440会话栏、900/390会话按钮；未调用Provider、未重设计AI功能 |

证据限制：browser accessibility tree、computed styles、bounds 和当前 main 源码均直接检查；截图工具持续超时，**没有像素级截图视觉验收**。加载文案真实出现；空态、有数据态真实观察；错误态从现有实现阅读，不声称逐页故障模拟。动态缩放中详情抽屉曾保留前一宽度，重进手机路由使用390宽度；本阶段记录响应策略需一致，不据此创建bug条目。

### What is already good

- 已有全局 teal、中性文字/背景、语义色、字体及半径 tokens；Ant Design 和共享 PageHeader 可复用。不要再造另一套组件库。
- Shell 已有深色导航、选中态、折叠/宽度调整、移动导航和账号区域。问题不是“缺导航”，而是分组优先级与跨页公共语言还未闭环。
- Record List 有搜索、字段筛选、个人命名视图、排序、分页、导入/导出及手机卡片。保留能力，整理其显示层级。
- Employee 已有个人跟进、时间桶、完成入口；Dashboard 已有按权限投影、发布版本与趋势范围的说明。不要通过重排误导统计含义。
- Field Drawer 的四段结构、实时预览以及AI页的克制主操作，比一些配置/业务页面更成熟；它们都是参考，不是全面重做对象。

### Pages most behind

最需要体验提升的是 **Record Detail、Record List、Follow-up / Employee Workbench 和 Dashboard Builder / Workflow 的配置工作面**。Field Drawer 与 Object Designer 已有较好的分节/预览基础，不应被笼统列为全部落后。AI页作为参考；Workspace Admin 展示本身已有清楚的指标/分析/列表层级，主要需要保持一致性。

## 2. Top Experience Problems

共8个体验问题，其中前5个最影响完成度；不是缺陷审计，不采用P0/P1分级。

| # | Experience problem and observed evidence | Primary category | Product consequence |
| --- | --- | --- | --- |
| **1** | 标题24px（首页/记录）、18px（跟进）、20px（Dashboard Builder）；局部CSS保留多种半径/辅助色/间距，共享PageHeader未贯穿业务页 | **Global Design System** | 页面切换像不同迭代的后台拼接，整体完成度低于已有功能成熟度 |
| **2** | Record List常驻“我的筛选”、应用/删除、命名输入/保存，再到搜索/筛选/计数；少量员工记录也承担完整管理条 | **Single-page IA + interaction** | 第一眼关注配置控件而非记录，手机尤其拥挤 |
| **3** | 详情把字段、Follow-up表单、关联、附件、历史与NOTE表单排成连续栈；空区仍占篇幅 | **Single-page IA + interaction flow** | 理解当前状态、安排下一步、回看历史需要长距离滚动 |
| **4** | Employee首页的时间范围先于我的跟进，运营组件后还有12个新建/打开快捷入口与重复业务表入口 | **Single-page IA** | “今天做什么”未成为主任务，已有个人能力被运营布局稀释 |
| **5** | Object/Field/Dashboard/Workflow及成员权限使用各自保存与发布表达；Dashboard元配置多行、900/390画布延后 | **Interaction flow + admin IA** | 用户持续重新理解“保存影响什么”，注意力被设置分散 |
| 6 | 900保留224px侧栏；业务卡片/AI会话切换已有适配，Object390转桌面、Dashboard390继续长编辑表单；缩窄已开抽屉策略未形成统一约定 | **Global responsive system** | 中等屏编辑面积不足，小屏可做/不可做的边界不一致 |
| 7 | 跟进待办、记录跟进事项、跟进记录、动态“跟进活动”是不同现有能力，但名称/动作缺少足够上下文 | **Interaction flow / terminology** | 用户容易把下一步任务与历史事实混为一谈，不该靠合并领域修复 |
| 8 | 空跟进仅文字指引，无就地导航；关联/附件/活动各有独立空态；已有错误与重试实现，但反馈语言/占位尺寸未形成跨页约定 | **Global state language + local recovery** | 空数据被体验为停顿，多个空区压过主信息 |

## 3. Design Principles

1. **Extend the current product, do not restart it.** 现有API、字段、记录、权限、工作流、行动、跟进与AI语义不变。整理顺序和可发现性，不删除能力。
2. **Task before configuration.** 每个页面先回答“我在看什么、现在最应该做什么”。记录工作面以记录为主，员工首页以行动为主，管理员编辑器以当前编辑任务为主。
3. **Density through hierarchy.** 保留B2B信息密度，用列对齐、字重、节奏和轻分隔提高阅读效率；不靠堆Card、扩大所有留白。
4. **One public language, contextual interiors.** Shell/Header/toolbar/状态共享；表格、详情、Dashboard画布与AI会话保留各自适合的布局，不强行统一为Card页面。
5. **Progressive disclosure without feature loss.** 保存视图、复杂筛选、关联/附件及危险动作可进入明确的二级入口；主路径少干扰，能力仍可发现、可键盘到达。
6. **Explain consequences where the action lives.** 草稿保存、发布、成员覆盖立即生效的不同含义贴近操作按钮。保留确认、校验、乐观锁、权限投影与已有审计行为。
7. **Responsive by task.** 手机优先读记录、处理跟进与查看概览。复杂配置保留桌面专长，但提供一致、明确的能力边界，不假装把三栏编辑器简单堆起来就是移动适配。

## 4. Visual Language

**Character:** modern B2B CRM SaaS；clean、calm、professional、information-dense but readable、clear hierarchy、consistent spacing。

- **Color:** 保留当前primary teal `#167568`及其hover/active、浅teal selected状态；白工作面、浅中性canvas、深色导航。teal用于选中/主动作，不满屏铺绿。语义红/橙与业务选项色保留；“避免purple AI aesthetic”不等于移除已有字段选项的紫色。
- **Typography:** 沿用已有IBM Plex / 中文fallback字体链，不引入新品牌字体。页面标题以24px左右为方向，区块标题16–18px、正文14px、辅助12–13px；AI紧凑工具头可以保留自身角色，而非强行变成24px。行高足够阅读，金额/日期/编号使用tabular numerals。
- **Spacing:** 以4/8为基础节奏，常用8/12/16/24/32；页面外边距桌面约24、小屏约16。读者能从间距看出“同组”与“不同区”，不让每页任意决定。
- **Surfaces:** 表格轻横分隔、无厚重网格；业务区平面分节。边框用于结构，Card仅用于确实独立的内容单元；常规控件6–8px、阅读面8–12px为方向，不追求巨大圆角。弹层可有必要的轻阴影，普通页面不依赖阴影建立层级。
- **Actions:** 一个页面/编辑阶段有可辨识的主操作；辅助动作弱化，危险动作隔离。保留必要的上下文操作，不能为了“一个按钮”隐藏任务核心。
- **Motion:** 仅必要导航/弹层反馈，尊重reduced motion；不增添装饰动画。

具体token数值与breakpoint不是本Stage冻结的实现细节。第一切片应优先应用已有tokens，只有真正缺失的语义才补公共规则。

AI成熟度参考仅取其简洁头部、清楚主操作、克制空态与屏宽变化后的会话入口，不采用新AI配色，不改变Proposal/Preview/Confirm、历史、工具执行或Provider。

## 5. Global Shell Direction

- 保留工作区身份、深色侧栏、teal选中、折叠/宽度调整及账号入口。导航从任务理解分组：**工作**（首页、跟进、AI）、**业务数据**（授权对象）、**管理**（仅Admin）；沿用现有路径和授权过滤，不新增可见能力。分组名称清晰但不增加大块装饰标题。
- 顶部租户/账号是全局上下文；页面Header负责当前页标题、简短说明、状态和动作。对象代码、版本、发布日属于次级信息，不争夺页面标题。
- Page Header、toolbar、section heading、反馈语言形成公共模式；可复用现有PageHeader而非新建大型UI框架。第一刀至少在Record List及现有共享Header消费者体现，不宣称一刀重排所有内页。
- 900宽度用实际内容宽度决定侧栏密度/折叠，避免让配置区只剩窄画布；保留用户手动选择并明确导航入口。390保持现有可打开导航，关闭后焦点回到触发按钮。
- 不引入新的global search、导航计数、跨对象聚合或新路由体系。账号/租户身份不能在视觉简化中消失。

## 6. Employee Experience Direction

### Workbench

首屏以“我的工作”为行动层：已有逾期/今日/未来7天桶、任务内容、所属记录、到期时间和完成入口。工作台名称及发布信息仍可查看；运营趋势范围贴近它真正影响的趋势区，不放在行动摘要之前。

已发布Dashboard仍展示其原配置、受众和统计含义，不私自删除用户配置的组件或把趋势范围推广成所有指标的筛选。管理员与员工入口可有不同优先级，但共享同一视觉语言。

把12个新建/打开按钮整理成可理解的业务入口；保留每个有权动作，减少与侧栏/底部业务表导航重复。不要添加“推荐下一步”等新算法或AI能力。

### Follow-up and Activity

Follow-up作为未来任务队列，以到期/任务/记录关系建立行层级。完成是常用主动作，改期/转交/取消作为清楚的辅助动作；既有输入与确认保留。空态能引导到授权业务记录，而不是创建脱离记录的新任务。

详情内“下一步跟进”与“活动历史”用清楚名称区分。动态业务对象“跟进活动”仍是用户配置的对象，既有NOTE活动与Follow-up仍各走原API；本轮不合并其数据模型。

从首页或待办进入记录，保持返回上下文；详情处理后更新既有队列与记录视图，保持当前筛选。具体URL/state处理方式留给切片设计，不新增后端。

## 7. Record Experience Direction

### List

标题 + 主新建入口后，建立一条清楚的工作工具栏：当前视图、搜索、常用筛选与结果数。命名保存/删除进入视图管理二级入口；保留个人视图“仅此浏览器”的准确说明，不暗示跨设备同步。高级筛选仍明确可发现，已应用条件可快速识别与清除。

排序、分页、批量操作、导入/导出、负责人控制及权限差异继续可用。主标题链接与行操作形成清楚的点击区域；不将所有字段一律隐藏。长备注避免占据列表首要宽度；依据现有发布列配置保留字段访问，不擅自改管理员配置。

1440重点是行扫描与列对齐；900减少控制条换行并保持表格局部横向滚动；390沿用已有记录卡片，标题/状态/关键字段优先，其他已配置字段有明确查看路径，顶部控制不照搬桌面管理条。

### Detail

保留现有URL打开详情、列表背景和读/编辑权限行为。第一层摘要是记录标题、状态、关键字段及负责人；其次是**下一步跟进**和**活动历史**。关联/附件提供带数量或有内容提示的二级区，空状态不占整段主路径；数量只能来自已有数据，不增加计数API。

详情与完整编辑仍是不同任务。追加活动/安排跟进先有清楚入口，再展开表单，不让读者始终面对全部编辑控件。已有工作流动作、执行结果和错误仍就地保留，不能被tabs或折叠隐藏到不可发现。

具体使用sections、tabs还是可展开区，以及是否扩大桌面抽屉，在切片2中基于真实长记录决定。本Stage不批准新增独立详情应用或改记录域。手机入口应稳定全屏适配，宽度变化与打开时策略一致；Focus/返回/滚动上下文是该模式的一部分。

## 8. Admin Experience Direction

Object Designer现有步骤和实时预览可保留；改进的是当前编辑焦点、工作面宽度及公共状态/动作。Fields账本维持紧凑与可排序，Field Drawer延续分节优点。不要把管理员所有工作改成向导或可视化大画布。

- **Object / Field:** 标明正在编辑哪个对象、草稿/发布状态与保存范围；“保存字段”与“保存对象草稿”的关系贴近动作，保留稳定字段键/类型锁定说明。
- **Permissions:** 区分对象员工默认、字段访问级别、成员覆盖。用有效权限摘要帮助阅读，但只呈现已有服务端投影；不在前端另造权限计算引擎、不添加新权限语义。默认发布生效，成员覆盖保存立即生效，不统一成同一种“发布”。
- **Dashboard:** 将名称/受众/默认/归档元配置收为明确二级区域；保存草稿/预览/发布形成稳定动作带。900重点保证画布与当前属性可到达，组件库不长期压过整个编辑任务；390复杂编辑策略与Object一致，由切片4明确采用受限查看/桌面提示还是合理单栏编辑，不在Stage悄悄移除现有编辑能力。
- **Workflow:** 状态、可执行动作、顺序执行动作层级清楚，控制标签在输入处可读。保留所有已有required字段、角色、状态、动作配置、校验/发布行为；不新增图编辑器、自动布局或改Action Engine。

发布影响与阻断/警告必须保留。不得通过视觉简化跳过发布检查或让草稿看起来已对员工生效。

## 9. Responsive / Accessibility

### Responsive contract direction

| Width | Direction |
| --- | --- |
| 1440 | 全尺寸业务工作面，列表紧凑易读；Admin可并排编辑/预览或画布/属性，不牺牲主体宽度 |
| 900 | 按可用内容宽度收敛导航和辅助面；重要编辑/处理区域先出现，secondary controls转明确入口，不把全部三栏串成长页面 |
| 390 | 核心读记录/处理跟进/查看概览可用；卡片/详情主操作适配，导航可开关，表单不超屏；复杂Admin编辑的能力边界一致并保留返回路径 |

已有body隐藏横向overflow，因此body宽度等于viewport不能单独证明内部未裁切。后续切片应检查真实工作面和弹层，而非只用页面scrollWidth；本Stage不把缩放中的瞬态坐标当完成验收。

### Accessibility and state language

- 有意义的heading层级、nav/group标签、表单label和可读动作名；不只用颜色表达状态。保留ARIA/键盘路径、表格语义和现有非拖拽排序替代。
- Focus可见，弹层focus管理与关闭返回明确；移动触控主操作目标约44px，不要求密集桌面表格所有行控件无限增大。遵循WCAG AA对比度方向，但未声称本轮全项通过。
- Empty区分无记录、筛选无结果、无事项、无配置及无访问权限；提供当前用户有权且相关的下一步。权限空态不能泄露隐藏记录。
- Loading保留预期内容结构和上下文，不用全屏阻塞替代每个局部查询。Error说明未完成什么、哪里可重试，保留安全错误与request ID；表单保留用户输入。
- 保存/更新冲突及已有工作流错误继续明确显示；不能用乐观视觉掩盖服务器拒绝。具体状态视觉在每个slice落地，不扩为全库安全/测试审计。

## 10. Candidate Implementation Slices

以下是4个候选边界，**不是详细Implementation Plan，也不自动激活后续阶段**。

| Slice | Solves / surfaces | Value | Dependency | Backend |
| --- | --- | --- | --- | --- |
| **1. Product Frame + Record List — RECOMMENDED FIRST** | 公共Shell导航分组、PageHeader/toolbar/spacing/states与记录列表的视图/筛选/行操作/移动卡片层级；以Admin与Employee及多个对象为真实工作面 | 同时提高全局观感和高频任务流，避免只做一层新皮肤 | 无；基于当前main能力 | **NO** |
| 2. Record Detail + Follow-up / Activity | 详情摘要/下一步/历史/关联附件，待办动作及列表→详情→返回上下文 | 让一条记录的阅读与处理成为连续流程 | 复用1；不依赖3 | **NO** |
| 3. Employee Workbench | 个人行动优先、Dashboard信息次序、业务快捷入口去重及共享展示语言 | 每天打开产品就能定位工作重点，保留已发布运营能力 | 依赖1；建议2后对齐任务入口 | **NO** |
| 4. Admin Configuration Coherence | Object/Field/Permission/Dashboard/Workflow公共编辑结构、保存/发布表达和屏宽策略 | 配置后台更易理解，复杂度由产品组织而非表单堆叠承担 | 依赖1；可独立于2/3安排 | **NO** |

### First-slice choice and why

比较了三条路线：纯Design System换肤、Employee首页优先、公共框架与Record List一起落地。推荐第三条。第一条没有解决控制条负担，第二条进入记录后仍断层，第三条覆盖两角色和所有动态对象的高频入口，同时给后续切片提供经过真实页面应用的公共规则。

FIRST SLICE不是全站重做。它不重构详情/管理员编辑器，不重写AI、不重排用户已发布Dashboard、不引入新后端或巨型组件框架。第一切片现已有单独实施计划，明确文件、任务、测试与验收；执行时同时阅读两份文档。Slice1已实现并合并；Slice2＋3已获本轮明确授权。

### Backend constraint

**BACKEND CHANGES REQUIRED: NO** for these scoped directions, which only reorganize existing presentation/actions/data.

以下仅为未来边界例子，不是本阶段候选功能：跨设备保存个人视图、新的全局搜索或导航聚合计数、Follow-up与Activity合并领域、新的权限级别/草稿生命周期。若后续UX必须依赖其中任何一项，记录 **BACKEND CHANGE REQUIRED** 并重新取得授权，不在前端用伪数据或自造语义绕过。

### Delivery / review gate

初稿的“两份 Markdown、不写实现计划”只对应当时交付。用户后续要求审计与优化计划，本次增加审计与第一切片实施计划并同步相关入口；apps/**、packages/**、API、DB schema、permission semantics、AI runtime、CI 源码没有改动。未提交、push、PR、merge 或 deploy。

## 11. Development Contract Added After Audit

1. **Task 0 先修状态正确性**：保存视图后的搜索词同步、搜索防抖卸载取消、详情关闭时保持对象自定义排序。三项有组件级失败复现，不把它们算作已修复。
2. **第一切片范围冻结**：Shell/Header/Record List；详情只修返回状态，不重排内页；不顺带重做管理员编辑器和 AI 内容页。
3. **保留完整能力**：搜索、字段筛选、视图管理、分页、排序、批量、导入导出、列设置、手机卡片；仅把低频配置移至可发现的二级入口。
4. **验收按角色×视口×状态**：Admin/Employee × 1440/900/390；覆盖有数据、空结果、错误恢复、深链返回、键盘与焦点。必须真实浏览器验证，截图/几何数据与组件测试分别记账。
5. **工程验证分层**：已有单元/typecheck/build/contracts 通过不抹去新增失败复现；AI E2E 固定地址导致的 setup 失败单列，不改隔离保护凑绿。
6. **后续顺序与边界**：详情/跟进 → 员工工作台 → 管理配置；各自开工时细化实现，Production Essentials/Automation/AI 扩展不混入。

完整任务、文件与命令以 [实施计划](../plans/2026-10-03-crm-product-experience-v2-implementation.md) 为准。状态：**SLICE 1 IMPLEMENTED AND MERGED / SLICES 2＋3 ACTIVE**。
