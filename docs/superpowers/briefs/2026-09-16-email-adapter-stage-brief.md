# Email Adapter — Optional Stage Brief

> 日期：2026-09-16  
> 类型：Optional Stage Brief  
> 状态：OPTIONAL / BACKLOG-READY  
> 所属：CRM Lean Roadmap  
> 预计开销：0.1–0.2 × Workflow V1

## 1. 目标

为未来 Email 需求保留统一、可替换的发送边界：业务代码 → Email Port → Provider Adapter，而不是业务 Service 直接依赖某厂商 SDK。

## 2. 为什么是 Optional

近期重点是 Workflow、Workbench、AI Assistant、Production Essentials。Email 只有出现真实触达需求时才做。SMS 尚未接入、Feishu 暂不需要，都不是 Email 的前置任务。

## 3. V1 范围

最小能力：provider-neutral EmailSender/Port、一个 Provider Adapter、server-only API key、plain text/basic HTML、subject/to、timeout、provider error mapping、basic send audit/log metadata、development/test fake adapter。首批调用方只允许真实已批准场景。

## 4. 明确不做

不做营销 Campaign、模板设计器、批量群发、open/click tracking、unsubscribe center、bounce processing、inbound email、email-to-record、automation trigger、AI 自动发邮件、SMS、Feishu。

## 5. 安全边界

Provider API Key 只在服务端；日志不打印完整正文/secret；Recipient 必须来自业务层明确输入；不允许 LLM 直接决定并发送；未来 AI 即使能草拟邮件，发送也应独立确认。

## 6. Provider Strategy

Stage Brief 不锁定厂商。Design 时根据部署环境选择 SES/Resend/SendGrid/其他，Adapter interface 不暴露 provider-specific field 给业务层。

## 7. 预计改动面

可能涉及 `apps/api/src/modules/notifications/email/**`、config/env、tests，可选 worker（只有决定异步发送时）。低频邀请/通知可以同步+timeout，不应为了 Email 提前建设完整 Worker 平台。

## 8. Acceptance Outline

至少证明：Provider secret 不进客户端；Fake adapter 可测试；单一 Provider 可发送；timeout/failure 正确映射；业务层不 import vendor SDK；不跨 Tenant 泄露 recipient/context；日志不泄露 secret；未经明确调用不发送。

## 9. Promote 条件

只有出现明确业务场景时 Promote，例如“公司邀请必须发 Email”。如果没有真实需求，长期保持 OPTIONAL 是正确状态。

## 10. 完成后的退出条件

系统拥有干净的 Email 能力边界，但不会因此提前演变成通知/营销/Automation 平台。

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
