# AI Assistant V1A — Ask / Analyze Stage Brief

> 日期：2026-09-16  
> 类型：Stage Brief  
> 状态：PLANNED  
> 所属：CRM Lean Roadmap  
> 预计开销：0.4–0.7 × Workflow V1

## 1. 目标

加入一个只读、受当前用户权限约束的 AI Assistant。用户可用自然语言总结负责客户、分析商机、整理跟进记录、找长期未跟进客户、汇总业务对象。V1A 不修改任何业务数据。

## 2. 产品定位

这不是 Agent，而是现有 CRM Read API 的自然语言客户端。安全不变量：AI 能看到的数据集合必须是当前登录用户正常 CRM 读取集合的子集。

## 3. V1 工具范围

候选 Read Tools：`search_records`、`get_record`、`aggregate_records`、`list_activities`、`list_followups`。是否全部首发，在 Design 时基于当前 API 决定。大数据分析优先 aggregate → Top-N search → detail，不把海量 Record 塞进模型。

## 4. ActorContext

LLM Tool Schema 不能出现可由模型填写的 tenantId/memberId/role/userId，这些必须由服务端从 Session/Workspace 自动注入。Prompt Injection 没有 actor override 参数路径。

## 5. Read Security

所有数据进入模型前必须经过 Tenant Context → Published Schema → Effective Access → readScope → Field Permission → RLS → Sanitized Result。必须“先裁剪，再交给 AI”，禁止把全量原始数据交给模型后靠 prompt 保密。

## 6. Provider 边界

采用 provider abstraction，不把业务代码绑定具体模型厂商。Stage 只要求 tool-capable chat、timeout/error mapping、usage metadata。具体 SDK、模型名、streaming 策略在 Design 时决定。API Key 只在服务端。

## 7. Chat / Memory 范围

V1A 不做长期 AI Memory。是否持久化短期 thread 在 Design 时决定。无论是否持久化，每次 Tool Call 都重新走权限层，thread 不得跨 Tenant/成员复用。

## 8. 明确不做

不写数据、不执行 SQL、不做 autonomous agent loop、background jobs、自动 Follow-up、External RAG、Vector DB、文档知识库、Email/SMS/Feishu、AI 自主 Workflow、长期记忆、跨 Tenant 分析。

## 9. 预计改动面

可能涉及 `apps/api/src/modules/ai/**`、复用 records/activities/follow-ups、`apps/web/src/features/ai/**`、contracts、config/env、tests。V1A 本身不要求 AiOperation 写操作表。

## 10. Acceptance Outline

必须证明：admin ALL 正常；employee OWN 只能 OWN；HIDDEN fields 不进入 Tool Result；任意 recordId 不能越权；Tenant A 读不到 B；aggregate 和 search 共享权限边界；Tool Schema 无 actor override；不存在 write tool；大结果集有硬 limit/budget；provider error 不泄露 secret。

## 11. Promote 条件

权限 hardening 已收口；AI Assistant 总体设计仍被认可；重新读取最新 Records/Activities/Follow-ups API；选择或允许接入支持 Tool Calling 的 Provider；明确 V1A 仍只读。

## 12. 完成后的退出条件

用户可以安全地问“帮我总结现在我能看到的 CRM 数据”。V1A 完成后不自动进入 V1B，先由用户验证实际价值。

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
