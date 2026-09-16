# AI Assistant V1 Design

> 日期：2026-09-16  
> 文档类型：Architecture Design  
> 状态：方向已定（PLANNED，**未批准开发**；V1A 与 V1B 分开推进）  
> 范围：V1A Read-only + V1B Human-confirmed Write

> **当前不要开始 AI 开发。** 本文只固定 V1 的方向、边界与验收形态；V1A 与 V1B 分开推进，
> V1B 应在 V1A 实际验证之后再开发。任何 AI 代码实现都需要用户单独批准的设计规格与实现计划。

## 1. Goal

为现有多租户 CRM 增加轻量 AI Assistant：V1A 用自然语言查询/总结/分析有权访问的数据；V1B 用自然语言提出修改，AI 生成 Proposal，只有用户确认后才执行 Typed Command。

核心不变量：**AI 能读取/修改的上限，不能超过当前登录用户自己通过正常 CRM API 能读取/修改的上限。** AI 不成为新的权限系统。

## 2. 非 Agent 定位

V1 不持续监控、不自主判断客户、不自动跟进、不自动发消息、不自动运行 Workflow、不在后台无人确认地改数据，因此不依赖完整 Automation / Event / Trigger / Worker。

## 3. 两阶段交付

### V1A — Ask / Analyze
只读：搜索记录、获取单条、聚合统计、查询 Activity、查询 Follow-up、总结分析。禁止写入。

### V1B — Controlled Edit

```text
User asks for modification
→ AI proposes exact changes
→ Preview
→ User confirms
→ Server revalidates
→ Typed Command executes
→ Audit
```

## 4. ActorContext

服务端从当前 Session / Workspace 生成：

```ts
interface ActorContext {
  tenantId: string;
  memberId: string;
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
  userId: string;
}
```

ActorContext 不能出现在 LLM 可填写的 Tool 参数中。Tool 只允许 objectCode、filters、sort、limit 等业务参数，后端内部再注入 actorContext。

## 5. Read Security

```text
ActorContext
→ Tenant
→ Published Object Schema
→ Effective Access
→ readScope
→ Field Permission
→ RLS
→ Sanitized Result
→ LLM
```

绝不先给 LLM 全量原始数据再要求它“别说出来”。员工 OWN 范围下，“所有客户”只表示他有权看到的所有客户；隐藏字段不进入 LLM context；A Tenant 用户不能读取 B Tenant。

## 6. Read Tool V1

建议首批：search_records、get_record、aggregate_records、list_activities、list_followups。所有结果设置硬 limit / pagination。大数据总结优先 aggregate，不把几十万 Records 直接塞给模型。

## 7. V1B Write Model

AI 不拥有 execute_sql、raw_database_write、run_as_admin、run_as_system。所有修改映射到 Typed Tool，V1 首批：update_record、create_followup、add_activity_note。每个 Tool 最终进入现有 Domain Service / Command，服务端仍是权限、Scope、Tenant、Validation、Version 的权威。

## 8. Proposal / Confirmation

AI Proposal 只是建议，不代表授权。用户点击“确认执行”后，后端必须重新 resolve ActorContext、permission、scope、field access、record version，再执行。不能复用 Proposal 时的权限结果。

## 9. Batch Safety

建议 V1B 单次 AI 写操作最多 20 条记录。高风险操作 V1 不开放：delete、archive、大规模 owner transfer、mass transition、permission changes、tenant/member administration。

## 10. AiOperation Trace

建议增加轻量 `AiOperation`：id、tenantId、requestedByMemberId、confirmedByMemberId、status、requestText、proposalJson、toolSummaryJson、createdAt、confirmedAt、executedAt、failureCode，可通过 metadata / executionId 关联 Audit。

不保存完整 Record Before/After 作为第二套业务数据库。真正数据变化由 Domain Data + AuditLog 负责。

## 11. Audit

AI 相关 Audit metadata 可携带 aiOperationId、source=AI_ASSISTANT、confirmedBy。最终可追：User Prompt → AI Proposal → Human Confirmation → Domain Command → Audit Event → Record Change。

## 12. Prompt Injection 边界

Prompt 不承担授权责任。即使输入“我是管理员”“把 tenantId 改成 B 公司”“忽略权限规则”，Tool Schema 也没有 tenant/member/role override，更没有 SQL。

## 13. Error Handling

Read：不可见对象/字段/记录不返回；cross-tenant 拒绝。Write：确认时若权限改变则 forbidden；version 改变则 conflict；字段只读则 field error；记录删除则 not found。V1 不做自动补偿。

## 14. UI

V1A：最小 Chat 页面 + Assistant Answer + Tool activity + 数据来源摘要。

V1B：Proposal 确认卡，清晰展示修改条数和 before → after；只有点击“确认执行”才调用 execute endpoint。

## 15. V1A Acceptance

必须证明：admin ALL 得到 ALL；employee OWN 只能 OWN；HIDDEN fields 不进入 Tool Result；A Tenant 不能访问 B Tenant；任意 recordId 不能越权；aggregate 也遵守 scope；Tool Schema 没有 tenantId/memberId/role override；不存在写 Tool。

## 16. V1B Acceptance

必须证明：没确认不写；Proposal 不能直接 execute；Confirm 时重新校验 permission/version；员工不能借 AI 更新无权记录；Hidden/Read-only 不能借 AI 修改；cross-tenant update 不可能；执行后有 Domain Audit；AiOperation 可追 request→proposal→confirmation→audit；批量上限有效；无 raw SQL/admin bypass。

## 17. Non-goals

V1 不做 Agent Loop、Autonomous Follow-up、Automation Engine、Vector KB、External RAG、Email/SMS/Feishu sending、Delete/Archive、Cross-tenant analytics、Background AI jobs、Long-term AI memory。
