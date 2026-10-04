# CRM Product Experience V2 — Stage Brief

Date: 2026-10-03

Status: SLICE 1 IMPLEMENTED AND MERGED (#24, 9cd2523) — SLICES 2＋3 AUTHORIZED / ACTIVE — SLICE 4 PLANNED

Repository: Zhong0118/multi-tenant-CRM-builder

Base main SHA: `70884f5eff78669e369cd36e6fbd8d9f9ac9d089`

Docs branch: `docs/crm-product-experience-v2-design`

## Stage intent

把当前 CRM 从“功能已经很多，但部分页面仍像工程后台”，提升为“视觉统一、操作顺畅、信息架构清晰的现代 B2B CRM SaaS”。保留已有功能和 teal / green identity。此次交付是阶段方向，不是全部未来工作的实现合同。

Workflow V1、Action Engine V1、Sales Workbench Lite、AI Assistant V1A 和 V1B 均接受为已完成基线；V1B = COMPLETED — MERGED AND VERIFIED。本轮接受为既有基线；2026-10-03 后续整体审计按用户新请求核验实现与测试，但不重复实现。Production Essentials = PLANNED，本阶段不推进它。

## Evidence and inspection boundary

先执行 `git fetch origin`，从上述最新 main 创建全新干净 docs worktree，没有沿用 V1B / AI UI / 旧 feature branch。Web 与 API 从该 worktree 的原样代码运行于本地 `127.0.0.1:3100` / `3101`。依赖锁定安装、contracts/database build、API build 和既有 20 个迁移运行成功；这些是浏览环境准备，不是功能回归验收。

用户另行批准独立可丢弃浏览环境：新 PostgreSQL 容器 `crm-v2-browser-postgres`，端口 `55434`、数据库 `crm_v2_browser`。使用既有初始化、账号注册/授权和 demo seed 命令；10 位成员、6 个发布对象、96 条记录。运行 API 使用既有受限 `crm_app` 角色。不连接真实 5432、不修改旧 5433/55433 夹具。不修改 schema、API、权限语义或应用源文件。

真实浏览器登录 Tenant Admin 陈静及 Employee 赵晨。检查宽度 1440、900、390 CSS px，高度 900。页面包括 Workspace 首页 / Employee Workbench、Follow-up、Record List、Record Detail、Activity 业务对象、Object Designer、Fields（含单选字段抽屉）、员工默认权限、成员访问权限、Dashboard 展示及配置、Workflow 编辑、AI Assistant。Admin 配置面只由 Admin 访问；Employee 不越权检查这些页面。

使用空态及有数据态：员工通过现有详情 UI 在隔离夹具中新增一条今日 Follow-up 和一条 NOTE 活动；流程编辑器仅本地添加状态/动作查看布局，没有保存或发布。没有调用 AI Provider 或重验 AI runtime。

证据来自浏览器 accessibility tree、实际文本、computed styles、bounding boxes 及当前 main UI 源码。截图多次超时，**没有完成像素级截图视觉验收**。不附伪造截图，也不把过渡中的抽屉坐标当确定缺陷。Loading 文案实际观察到；错误态只读取现有实现，未模拟全页面网络失败；未声称完成无障碍或完整回归验收。

## Top 5 experience problems

1. **共享设计语言没有贯穿所有页面。** 首页/Record List 标题 24px、Follow-up 18px、Dashboard Builder 20px；页面操作区、留白与状态表达来自多套局部样式。已有 tokens 与共享 PageHeader，问题是应用一致性，而非缺少基础。
2. **Record List 的控制层比任务本身显眼。** 标题之后常驻命名筛选选择、应用/删除、命名输入/保存，再到搜索和字段筛选、总数/更多操作。Employee 只有两条记录也承担完整管理控制层。390 下记录已有卡片，但顶部控制负担未同步收敛。
3. **Record Detail 缺少业务主线。** 同一详情抽屉依次放字段、负责人/版本、跟进事项及完整新增表单、关联、附件、跟进记录及新增表单；无数据区域也占据连续篇幅。读当前状态、安排下一步、查看历史难以快速切换。
4. **Employee Workbench 没有充分体现“今天的工作”。** 我的跟进已经存在，但置于时间范围之后；运营组件、12 个新建/打开快捷入口以及业务表入口再次重复。需要让个人行动成为首页的第一层，而非新增另一套工作台。
5. **Admin 的保存/预览/发布体验碎片化。** Object、Field Drawer、成员权限、Dashboard、Workflow 各自表达边界；Dashboard 的名称/默认/归档与发布按钮占用多行，900 下组件库位于画布之前，390 下首个画布控件在约 y=1252。Object Designer 在390明确转桌面，与 Dashboard 继续长表单的策略不一致。

问题类型与方向详见 [Stage Design](<../specs/2026-10-03-crm-product-experience-v2-design.md>)。初稿仅做体验方向；后续用户已要求整体检查 bug 和优化计划，现补充独立 [项目审计](../../audits/2026-10-03/project-review.md)，不要把初稿的排除项当作禁止本轮审计。

## Visual direction

Modern B2B CRM SaaS：clean、calm、professional、information-dense but readable。沿用当前 teal `#167568`、深色导航、白色工作面与浅中性底色；统一标题、正文、辅助文字、间距、控件与状态语义。用对齐、字体权重、轻分隔建立层级，不靠所有区域套 Card。AI 页的克制层级与明确主操作可作成熟度参考，不改变 AI 功能或复制其会话布局。

避免 purple AI aesthetic、glassmorphism、重阴影、巨大圆角、厚重表格边框与过度动画。

## Candidate slices

| Candidate | 解决什么 / 涉及什么 | 大概价值 | 依赖 | Backend |
| --- | --- | --- | --- | --- |
| **1. Product Frame + Record List — FIRST** | Shell 导航分组、共享 Page Header / toolbar / spacing / states；Admin/Employee 记录列表筛选、动作、密度、移动端 | 高频工作面与所有页面外框同时变得统一，收益不是纯主题换色 | 无 | NO |
| 2. Record Detail + Follow-up / Activity | 详情摘要、下一步、历史、关联/附件的渐进披露；跟进待办动作层级和上下文回路 | 改善日常处理记录的连续流程 | 复用 1；不依赖 3 | NO |
| 3. Employee Workbench | 今日/逾期行动优先、运营信息次之、快捷入口去重；Admin dashboard 展示复用公共语言 | 让员工打开产品即知道该做什么 | 依赖 1；最好在 2 后统一动作入口 | NO |
| 4. Admin Configuration Coherence | Object/Fields/Permission/Dashboard/Workflow 编辑工作面、保存/发布表达及响应式边界 | 降低配置理解成本，让复杂后台更有产品感 | 依赖 1；不要求 2/3 已完成 | NO |

## Why first

Record List 是多种业务对象共同的高频入口，Admin 和 Employee 都使用。当前已有色板、组件库、表格/卡片与筛选能力，不需要新增产品能力便可取得明确收益。把公共 Shell/Header 规则与一个完整业务工作面一起交付，比仅建立 tokens 或一次重做所有页面更可控，也为后续切片提供真实可复用的语言。

## Delivery and stop boundary

初稿只交付 Brief 和 Stage Design。后续用户要求整体审计并优化 V2 计划，因此本次增加审计、复现脚本与第一切片实施计划，并同步路线图入口。业务源码保持不变；没有提交、推送、PR、merge 或 deploy，也未启动产品实现。

BACKEND CHANGES REQUIRED: **NO**，限于当前推荐范围。跨设备保存个人视图、统一 Activity 与 Follow-up 领域、新的全局搜索/计数/聚合等需求如果后续提出，标为 **BACKEND CHANGE REQUIRED**，不能伪装为前端体验整理。

开发入口：[First Slice Implementation Plan](../plans/2026-10-03-crm-product-experience-v2-implementation.md)。顺序：Task 0 修复三项已复现的记录状态 bug → Slice 1 公共框架与记录列表 → Slice 2 详情/跟进 → Slice 3 员工工作台 → Slice 4 管理配置。

当前状态：Slice1已实现并合并PR #24（9cd2523），postmerge run37199104409六门SUCCESS；用户本轮明确授权Slice2＋3联合交付，详见[联合计划](../plans/2026-10-04-crm-product-experience-v2-slices-2-3.md)。上文初稿过程为历史背景，新PR不自动合并，Slice4与部署仍未批准。
