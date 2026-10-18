# 通用公共池流转实施计划

> 执行：subagent-driven-development，按独立文件边界实现并统一复核。本地功能分支 codex/generic-pool-lifecycle，不提交远程、不部署。

**Goal:** 各业务表独立启用分阶段公共池，支持领取、联系确认、30 天跟进续期、回收及关联成交保护。
**Architecture:** 扩展现有记录和公共池配置，不复制业务记录；既有记录阶段为空，显式操作才入新流程。服务端约束和事务决定归属，表内视图展示。
**Tech Stack:** NestJS / Prisma / PostgreSQL / Next.js / Ant Design。
**Spec:** docs/superpowers/specs/2026-10-18-record-pool-lifecycle-design.md

## Global Constraints

- 旧数据不要自动进公海；不清空、不回填既有记录阶段，不修改既有字段权限。
- 默认联系期限 24 小时，跟进期限 720 小时；按表可修改，不追溯已有到期时间。
- 只有新增有内容的记录活动续期；普通编辑和未来待办不续期。待联系须明确确认联系。
- 成交依据为同租户关联记录的已发布业务流程状态；不猜表名，不凭自由文本宣布成交。
- 隐藏字段、OWN 范围、只读权限、租户隔离和并发版本检查持续生效。
- 保留上一轮未指定筛选修改；docs/user-guide/ 不属于本任务，不动。
- 当前工作目录开发，不额外工作树；不 push、不部署、不自动提交其他人的文件。

## 共享接口

PoolConfig 兼容现有 enabled/ownershipTtlHours/version，新增可选 lifecycleEnabled、contactTtlHours、followUpTtlHours、labels、protectionRules。无配置等同旧流程；显式启用新流程才应用多阶段规则。

```ts
type PoolStage = 'LEAD_POOL'|'CUSTOMER_POOL'|'PENDING_CONTACT'|'FOLLOWING'|'PROTECTED';
type PoolLabels = {leadPool:string;customerPool:string;pending:string;following:string;protected:string};
type PoolProtectionRule = {sourceObjectCode:string;statusKeys:string[]};
// 记录响应新增可选/null字段：
// poolStage, poolOrigin, poolClaimedAt, poolLastFollowUpAt, poolProtectedAt,
// poolReason, poolQuality ('INVALID'|'DUPLICATE'|'LOST'|null), protectionNeedsReview
// GET list/export 新增 poolStage；保持 scope=mine|pool|all。
// ownership 新增 CONFIRM_CONTACT、UNPROTECT_RELEASE；RELEASE支持 reason/quality，管理员可选poolStage将旧记录显式释放到两种公共池。
// import新增 importToPool?:boolean；与ownerMemberId互斥，只在显式启用新流程且管理员确认时允许。
```

实际关联表是记录之间的无向关联，不存在“客户关联字段定义”。保护规则选择来源业务表及其已发布流程状态，通过现有记录关联识别客户/渠道；设置页必须明确这一点。未指定归属时禁止直接自动保护并给出可操作错误，管理员先分配再确认成交。

### Task 1: 核心流转与数据库

Files: packages/database/prisma/schema.prisma；新迁移 0028_record_pool_lifecycle；apps/api/src/modules/records/record-pool*、record-ownership*、record-command.ts、records.repository.ts、records.service.ts、dto；必要的 objects runtime schema；对应测试。

- [ ] 写状态转换失败测试：待联系到期、原池回收、跟进续期、保护不回收、员工不能释放他人、旧数据阶段为空。
- [ ] 最小追加字段/配置；不 UPDATE 旧业务记录。迁移扩展现有清租期触发器与回收函数，兼容旧模式。
- [ ] 实现配置、视图查询、联系确认、释放原因/质量、分配资格、活动续期和导入目标；权限在事务内复核。
- [ ] 提供旧数据/重启影响只读预览和当前权限信息，显式入池操作，数量只统计可见数据。
- [ ] 单元测试、真实 PostgreSQL 流转与竞态测试；更新 OpenAPI DTO。避免在业务库跑测试。

### Task 2: 表内视图与管理配置

Files: apps/web/src/features/records/record-pool.tsx、record-pool-api.ts、record-list.tsx、record-query-state.ts、record-api.ts、record-detail-drawer.tsx、record-import.tsx；object-types；相关样式和测试。

- [ ] 写交互测试：选择阶段后查询正确、联系确认动作、带原因释放、权限隐藏、配置期限、导入目标互斥。
- [ ] 扩展现有组件：按表开启新版流程，24/720 默认值，五个视图及全部/旧记录入口，显示阶段与期限。
- [ ] 设置保护来源表及已发布流程状态，不以表名猜测；配置缺失清晰提示。字段级权限继续服从当前 schema。
- [ ] 旧公共池/未指定记录显式归类，管理员管理质量和解除保护，倒计时以服务端时间为准，失败可重试。
- [ ] 前端测试、类型检查、受影响 lint；使用已有过渡和 Ant Design，不引入新依赖。

### Task 3: 关联成交保护

Files: 新迁移 0029_record_pool_protection；必要新独立 protection helper/service；record-relations、workflows 集成；测试。

- [ ] 对已确认/签约的同租户关联记录进行保护，在同一事务完成；关系新增、状态变更、撤销/删除均覆盖。
- [ ] 规则按来源 objectCode + statusKeys 匹配实际已发布流程，不硬编码客户/订单；多依据时一份失效不解除保护。
- [ ] 最后依据失效保留保护并标记 protectionNeedsReview；管理员明确解除后回池，员工不能解除。
- [ ] 未指定或公海记录需管理员先分配才能成交保护，避免自动给订单创建人。
- [ ] 并发回收/确认、租户隔离、重复事件幂等和事务回滚测试。

### Task 4: 整体验收与交付

- [ ] 合并接口、生成契约；逐项对照方案，审查跨层权限与写入路径。
- [ ] 独立测试库迁移前后旧记录内容/归属一致；新增数据演练全流程；API/Web测试与构建。
- [ ] 本地开发库先备份再应用仅追加迁移，核对旧数据不动；本地网页验证入口和操作。
- [ ] 更新验收文档，列出已实现和配置条件，保留可直接本地试用状态；不推送服务器。
