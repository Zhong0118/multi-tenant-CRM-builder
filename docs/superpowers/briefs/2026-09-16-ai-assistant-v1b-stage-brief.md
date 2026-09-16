# AI Assistant V1B — Confirmed Edit Stage Brief

> 日期：2026-09-16  
> 类型：Stage Brief  
> 状态：PLANNED  
> 所属：CRM Lean Roadmap  
> 依赖：AI Assistant V1A 已完成并有实际使用价值  
> 预计开销：0.5–0.8 × Workflow V1

## 1. 目标

让用户用自然语言提出修改意图，但 AI 不能直接修改数据库。固定模型：User Request → AI Proposal → Server Pre-Validation → Human Preview → Confirm → Revalidate Actor/Permission/Scope/Version → Typed Domain Command → Audit。

核心原则：没有明确确认，就没有业务写入。

## 2. V1 写能力

首批只考虑 `update_record`、`create_followup`、`add_activity_note`。第二批候选但不默认纳入：`create_record`、`assign_owner`、`execute_transition`。

## 3. 禁止 Raw DB Access

AI 永远没有 `execute_sql`、`raw_database_write`、`run_as_admin`、`run_as_system`。Typed Tool 必须进入现有 Domain Service/Command，AI 没有超级用户身份。

## 4. Human Confirmation

Preview 必须展示明确影响，例如“客户 A：状态 新线索 → 已联系”。Confirm endpoint 必须重新解析 Actor、Tenant、effective permission、update scope、field permission、record version 和业务规则。Proposal 通过不等于 Execute 授权。

## 5. AiOperation Trace

推荐引入轻量 AiOperation，记录用户请求、AI proposal、谁确认/拒绝、执行结果、关联 Audit。候选字段包括 id、tenantId、requestedByMemberId、confirmedByMemberId、status、requestText、proposalJson、toolSummaryJson、timestamps、failureCode、executionId。真正业务变化仍由业务表 + AuditLog 记录，不复制完整 Record before/after。

## 6. 批量与原子性

V1 设置硬批量上限，建议最多 20 records/confirmed operation，最终数值在 Design 时确认。禁止模型自动无限循环；不允许隐藏 partial success；多记录原子事务策略在 Design 时根据 tx-aware commands 决定。若无法可靠保证语义，宁可缩小到单记录/小批量。

## 7. 高风险动作

V1 不开放 delete、archive、permission change、tenant/member admin、大规模 owner transfer、自动 workflow transition、destructive bulk mutation。

## 8. Prompt Injection

Prompt 不承担授权。Tool Schema 不允许 tenant/member/role/admin override。即使用户要求“忽略权限”，服务端也只能以真实 Actor 执行。

## 9. 预计改动面

可能涉及 ai module、records/follow-ups/activities/audit、web AI UI、database（若新增 AiOperation）、contracts、migration、tests。若 AiOperation 落库，必须有 Tenant/RLS/索引/保留策略。

## 10. Acceptance Outline

至少证明：不确认不写；Proposal 无法直接 execute；确认时重新校验 permission/version；员工不能更新超 OWN scope；HIDDEN/READ_ONLY 不能借 AI 修改；跨 Tenant update 不可能；批量上限有效；执行后有 Domain Audit；AiOperation 能关联 request→confirmation→audit；旧 Proposal 不会静默执行；无 raw SQL/admin bypass；reject 无副作用。

## 11. Promote 条件

V1A 已完成且用户确认有价值；Engineering Gate 至少有基本保护；Typed Commands 对首批写操作足够成熟；Human Confirmation 仍是硬边界。

## 12. 完成后的退出条件

AI 可以帮助用户准备修改，但仍保持“人做最终决定，后端做最终授权”。V1B 完成不意味着进入 Agentic CRM。

---

## 激活本阶段时必须补的文档

本 Stage Brief **不是 Implementation Plan**。

当本阶段从 `PLANNED` Promote 为 `ACTIVE` 时，必须基于当时最新 `main`：

1. 重新核对 `HANDOFF.md`、Lean Roadmap、相关实现和最近提交；
2. 写正式 Design Spec：`docs/superpowers/specs/YYYY-MM-DD-<task>-design.md`；
3. 用户审核 Design Spec；
4. 再写 Implementation Plan：`docs/superpowers/plans/YYYY-MM-DD-<task>-implementation.md`；
5. 才能进入开发；
6. 完成后写 Acceptance：`docs/audits/YYYY-MM-DD/<task>-acceptance.md`。

如果本阶段被拆成多个独立 Task，则每个 Task 分别走上述生命周期，不允许一份大 Plan 包揽所有子项目。
