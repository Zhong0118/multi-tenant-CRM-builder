# Sales Workbench Lite — Stage Brief

> 日期：2026-09-16  
> 类型：Stage Brief  
> 状态：PLANNED  
> 所属：CRM Lean Roadmap  
> 预计开销：0.3–0.5 × Workflow V1

## 1. 目标

把已经存在的 Follow-up 能力真正变成员工首页的“今天该做什么”。本阶段不是重新开发任务系统，而是 Dashboard 上的个人执行视图。

员工进入工作空间后能直接看到：我的 Follow-up、今天到期、已逾期、近期需要处理。

## 2. 为什么保留这一阶段

现有 Follow-up 已具备 assignee、dueAt、overdue、completed、cancelled、reassignment、Record 关联，缺的是入口与聚合，因此 ROI 高且不需要新 Task Domain。

## 3. V1 范围

只做个人工作台：我的待办、今天、已逾期、近期（时间窗口在 Design 时确认）。最小交互包括点击进入关联记录、完成已有 Follow-up、展示 due time/object/record title、状态刷新。优先复用现有 Dashboard。

## 4. 明确不做

不做 Team Task Center、主管任务看板、无负责人池、自动升级、SLA、自动派单、轮询分配、任务依赖、子任务、新 Task 数据模型、AI 自动提醒、Event/Trigger Automation。

## 5. 数据与权限原则

“我的”必须由服务端根据当前 Actor 自动解析，客户端不能通过任意 memberId 读取其他员工待办。所有查询继续经过 Tenant/RLS。关联 Record 当前不可见时不得通过 Workbench 泄露字段，默认 fail closed。

## 6. 架构倾向

优先：Dashboard Component → Follow-up query service → Current Actor → Tenant/permission boundary → Follow-up + safe record summary。尽量不引入新表、新队列、新状态机。

如果现有 Dashboard 发布模型与个人数据不同步，应采用“组件配置发布、组件数据按 runtime Actor 查询”。

## 7. 预计改动面

可能涉及 `apps/api/src/modules/follow-ups/**`、dashboards、web dashboard/follow-up features、contracts（仅 API shape 变化时）和测试。是否新增 Dashboard component type 在 Design 时决定。

## 8. Acceptance Outline

至少证明：员工 A 只显示自己的 Follow-up；员工 B 不看到 A；Tenant A 不看到 Tenant B；今日/逾期/近期分类正确；完成任务后首页更新；关联记录不可见时不泄露；窄屏可用。

## 9. Promote 条件

Engineering Gate Lite 已完成或用户明确允许先开发；重新检查 Dashboard component architecture 与 Follow-up API；确认 V1 仍只做个人工作台。

## 10. 完成后的退出条件

员工首页能够回答“我今天应该做什么？”，且没有新建第二套 Task System。

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
