# CRM Lean Roadmap

> 日期：2026-09-16  
> 文档类型：Execution Roadmap  
> 状态：ACTIVE（方向已定；具体阶段仍须逐个 Promote，不得提前实现）  
> 关系：与 `2026-09-15-crm-process-roadmap.md` 并存，不替代其长期需求记录

## 1. 定位

现有 `2026-09-15-crm-process-roadmap.md` 继续作为 **Full Capability Roadmap**，保存完整产品能力地图；本文件作为 **Lean Execution Roadmap**，只管理近期真实执行。

原则：Full Roadmap 管完整需求；Lean Roadmap 管近期执行；同一时间只激活一个主要产品 Task；没有真实需求的能力进入 Backlog，不作为前置依赖。

## 2. 当前已完成基础

当前已经拥有多租户/RLS、Dynamic Object/Record、Effective Access、Dashboard、Follow-up、Activity、Relation、Audit、Workflow Core、Action Engine。近期目标不是补齐所有 CRM 功能，而是把已有能力变成好用的员工入口，并增加受权限约束的 AI Assistant。

## 3. Lean Roadmap

| 阶段 | 状态 | 内容 | V1 相对开销估计 |
|---|---|---|---:|
| Security Closeout | **COMPLETED**（Workflow 侧 PR #2；Record 侧 PR #3） | Workflow + Record required/HIDDEN metadata hardening（含 publish 期"默认值永不生效"拦截）；**残留**：`MEMBER` 默认值存在性无法在分析期校验、`action-engine.ts` 嵌套 fieldErrors 过滤（各自独立任务） | 0.1–0.2× |
| Engineering Gate Lite | PLANNED | CI、main protection、关键回归检查 | 0.2–0.4× |
| Sales Workbench Lite | PLANNED | Dashboard 中的我的跟进 / 今日 / 逾期 / 近期事项 | 0.3–0.5× |
| AI Assistant V1A | PLANNED | 只读 Ask / Analyze | 0.4–0.7× |
| AI Assistant V1B | PLANNED | Proposal → Preview → Confirm → Typed Write → Audit | 0.5–0.8× |
| Production Essentials | PLANNED | 安全、日志、备份、监控、对象存储、生产配置 | 0.6–1.0× |
| Email Adapter | OPTIONAL | 保留统一邮件接口，按需求接 Provider | 0.1–0.2× |

近期完整路线预计约 **2.1–3.6 个 Workflow V1 工作量**。

## 4. Sales Workbench Lite

不新建 Team Task System。复用现有 Follow-up、dueAt、overdue、completed、reassignment、Dashboard。V1 只保留：我的 Follow-up、今日、已逾期、近期需要处理。暂不做团队任务中心、主管异常队列、无负责人队列、自动升级、复杂派单、新任务模型。

## 5. AI Assistant V1A — Ask / Analyze

AI V1A 是受当前登录用户权限限制的 CRM 数据助手，不是 Agent，不自主行动。只读工具候选：search_records、get_record、aggregate_records、list_activities、list_followups。

所有 Tool 调用由服务端自动注入 tenantId/memberId/role/session ActorContext，LLM 无权指定或修改。所有读取继续经过 Published Schema、Effective Access、readScope、Field Permission、RLS。规则：**先裁剪，再交给 AI**。

## 6. AI Assistant V1B — Controlled Edit

固定流程：

```text
User Request
→ AI Change Proposal
→ Server Permission / Scope Validation
→ Preview
→ Human Confirm
→ Revalidate Permission + Version
→ Typed Command
→ Audit
```

V1 首批只考虑 update_record、create_followup、add_activity_note。后续再考虑 create_record、assign_owner、execute_transition。明确不开放任意 SQL、delete_record、无限批量修改、system/admin impersonation、后台自动执行、AI 自主触发 Workflow。

## 7. AI Operation Trace

AI 的真实业务写入仍进入现有 Audit；另外增加轻量 AI Operation 记录，用于记录 tenantId、requesting member、用户请求、AI proposal、状态 PROPOSED/APPROVED/REJECTED/EXECUTED/FAILED、confirm actor、关联 Audit IDs、时间。它不是业务数据副本，不保存完整修改前后 Record JSON。

## 8. Automation 的近期处理

完整 Automation 退出近期 Roadmap。Automation 仍保留在 Full Roadmap：Event → Condition → Action。只有出现真实需求时才启动。Worker/Retry/Idempotency 是自动执行可靠性基础，不是 AI V1A/V1B 前置条件。

## 9. Data Quality & Integration 的近期处理

Duplicate Rule、Merge、迁移、SMS、Feishu、多 Adapter、复杂通知全部回 Full Roadmap。近期仅保留 Email Adapter interface（Optional），是否真正接 Provider 由需求决定。

## 10. Production Essentials

近期保留：CI、main protection、Secret/Production Config、HTTPS/Cookie/CORS、Audit/Log、日志脱敏与保留、Monitoring/Alerting、Database Backup + Restore Verification、Private Object Storage、基础故障恢复。

回 Full Roadmap Backlog：Template Upgrade、独立统计中心、Import/Export Center、Native Excel、Attachment Virus Scan、完整 Migration Rollback Tooling。

## 11. 近期推荐顺序

```text
Engineering Gate Lite
→ Sales Workbench Lite
→ AI Assistant V1A
→ AI Assistant V1B
→ Production Essentials
→ Optional Email Adapter
```

（Security Closeout 的 Workflow 侧已随 PR #2 完成，Record 侧随 PR #3 完成；仍开放的 `action-engine.ts` 嵌套 fieldErrors 过滤与 `MEMBER` 默认值存在性校验是随时可插入的独立小任务，不占用上面的主要产品 Task 序列。）

如果业务更急于展示 AI，可允许 Engineering Gate Lite → AI Assistant V1A → Sales Workbench Lite，但 V1B 仍建议在 V1A 实际验证后再开发。

## 12. 目标

用较小工程量得到：**安全、可配置、可用、可解释的 AI CRM MVP。**
