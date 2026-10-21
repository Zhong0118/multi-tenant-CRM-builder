# 通用跨表关联与自动化 Implementation Plan

> **For agentic workers:** Use subagent-driven-development for backend and independent review; controller owns frontend and end-to-end acceptance. Steps use checkboxes for tracking.

**Goal:** 公司管理员配置跨表创建及关联；员工可确认执行，普通字段跨入条件也可自动执行；客户到开单完整本地验收。
**Architecture:** 复用 ActionEngine、Record commands、record relations 与现有发布版本。规则是源表草稿的一部分，发布后运行。新增持久化执行记录保证去重，单次源修改/目标创建/关联在同事务中。UI 用表级关系图、分步表单、字段映射预览。
**Tech Stack:** NestJS / PostgreSQL / Prisma / Next.js / React / antd / CSS modules；不增加图形或工作流引擎依赖。
**Spec:** docs/design/2026-10-20-cross-table-automation-proposal.md（用户已确认）

## Global Constraints
- 本地开发和测试，不 push、不部署、不读写服务器；不改真实公司业务配置。
- 保持所有现有权限、字段停用、表停用、发布隔离及租户隔离；动作以当前员工身份执行。
- 源客户保留，创建新订单并建立记录 ID 关联；创建时复制，非双向同步。
- 历史记录不补跑、导入不触发、不递归链式触发；同事件重试不重复，首次自动规则不因改版或状态回退重新开单；显式新增可支持第二单。
- 白底、清晰层级、现有主题变量、开源图标、短过渡和 reduced motion；映射/图均可键盘操作，窄屏卡片布局。
- 另一 agent 的 .worktrees/ui-direction 不修改、不合并；不修改其开发进程/数据库；根目录 .claude/launch.json 与 docs/user-guide/ 保持原样。

## Task 1: 配置与运行后端
**Files:** 新增 apps/api/src/modules/automations/*；修改必要的 objects schema/publish/dependency gates、records command/store、AI command integration、app module；packages/database schema + additive migration + tests。
**Interfaces:** 源表规则 CRUD 通过 /object-definitions/:objectId/automations；关系总览按公司；记录 runtime/preview/execute/history 通过 /objects/:objectCode/records/:recordId/automations。实施者先固定 typed DTO 合同供 UI 消费。字段映射复用 SOURCE_FIELD/LITERAL/NOW/ACTOR 与 SOURCE_OWNER，补填 INPUT 字段只用于手动动作。
- [ ] 先补失败测试：字段 old!=condition/new==condition 触发；重复/回退/改版不重复；另一个公司不可配置或执行；失败源更新回滚。
- [ ] 草稿规则存储与发布快照（旧快照无规则兼容）；当前目标校验、必填/类型/选项校验、停用依赖显示。
- [ ] ActionEngine 创建并关联共用路径；手动动作的 INPUT 补填，expectedVersion + requestId 去重；自动更新统一入口覆盖普通/批量/AI，批量每项 savepoint。
- [ ] 只读 preview 使用同样权限/校验而不写记录；运行历史包含目标 ID/执行人/时间，错误可理解且不泄密。
- [ ] 聚焦单测和 DB 集成，含并发去重/目标无权/停用/源回滚/历史不变；本地 commit。

## Task 2: 管理端图形与员工操作
**Files:** apps/web/src/features/automations/*；新增 settings/relationships/page.tsx；在 object-designer 与 record-detail-drawer 添加薄入口。
**Interfaces:** Task 1 DTO 与路由；沿用 object API 读取字段及 published schema。
- [ ] 测试先行：映射保存 roundtrip；必填不足禁用/可见错误；员工禁止管理；两张表小图可选择规则。
- [ ] 关系总览使用源表/目标表卡片+有文字的连线；支持搜索和聚焦。规则编辑三步：触发、目标映射、预览；当前生效与待发布分开。
- [ ] 按目标字段生成映射行和类型提示；手动补填字段用已有 RecordFieldInput；确认执行后展示目标链接/错误并刷新原记录。
- [ ] 桌面与390px UI 验证、键盘/ reduced motion；focused tests/typecheck。

## Task 3: 全流程验收与复核
**Files:** local-only demo fixture/test scripts；docs/audits/2026-10-21/cross-table-automation-acceptance.md。
- [ ] 单独本地演示公司/测试数据：管理员配置客户→开单并发布，员工执行生成订单、关联回客户。
- [ ] 验证普通字段自动触发、重复点击/状态回退无重复、第二次显式开单、缺失必填/无权失败回滚、隐藏字段不泄漏、导入不自动开单。
- [ ] 全量 API/Web tests、typecheck/build/contracts、隔离数据库 integration；独立代码评审后修复。
- [ ] 留本地运行入口与账号操作说明，记录 UI 分支的合并交集；不同步远程。
