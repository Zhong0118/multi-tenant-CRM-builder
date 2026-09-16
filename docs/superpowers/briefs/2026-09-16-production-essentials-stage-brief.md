# Production Essentials — Stage Brief

> 日期：2026-09-16  
> 类型：Umbrella Stage Brief  
> 状态：PLANNED  
> 所属：CRM Lean Roadmap  
> 预计总开销：0.6–1.0 × Workflow V1  
> 注意：本阶段预计拆成多个独立 Task，不应由一份 Implementation Plan 一次完成。

## 1. 目标

把当前可开发、可验收的 CRM 提升到具备基本生产安全、可恢复、可观测能力。不是做完整 DevOps 平台，也不是补齐 Full Roadmap 的全部 Platform 功能。

## 2. 为什么必须保留

真正上线至少要回答 Secret 管理、HTTPS/Cookie/CORS、数据库恢复、日志脱敏、系统故障发现、附件从 DB bytea 迁出、生产/开发配置隔离等问题。

## 3. 建议拆成 5 个独立 Task

P1 Production Configuration & HTTP Security：production env schema、secret 约定、HTTPS、secure cookie、CORS/origin、必要的 proxy/header 边界。

P2 Logging & Redaction：structured logs、request/error correlation、password/token/cookie/authorization/PII redaction、retention。

P3 Monitoring & Alerting：health/readiness、API errors、latency、DB/Redis connectivity、必要 worker health、最小告警入口。

P4 Database Backup & Restore Verification：backup、retention、restore drill、最小 RPO/RTO、migration 前备份规则。重点是实际证明恢复得回来。

P5 Private Object Storage：生产附件从 PostgreSQL bytea 迁到私有对象存储，授权下载、tenant isolation、metadata、delete/compatibility。

## 4. 明确不做

不做 Template Upgrade、完整统计中心、Native Excel、Import/Export Center、Virus Scan、Kubernetes、多地域容灾、active-active、全自动 migration rollback、SIEM、企业级 APM 全家桶。

## 5. 安全原则

Secrets 不进 git/客户端/log；AuditLog 与 Application Log 分工；备份要加密、最小权限、生命周期；Object Storage 不能 public bucket，下载继续经过 Session → Tenant → Record Permission → Attachment Permission。

## 6. 与 Engineering Gate 的关系

Engineering Gate 解决“坏代码不要轻易进 main”；Production Essentials 解决“进生产后系统安全、可观察、可恢复”。不能合并成一个巨大阶段。

## 7. 预计改动面

不同 Task 会涉及 API bootstrap/config/logging、database、infra/deployment docs、object storage adapter、attachment repository/service 等。具体文件必须等每个子 Task 激活后再检查。

## 8. Acceptance Outline

最终至少证明：production secret 与开发分离；HTTPS/Cookie/CORS 真实环境检查；敏感 header/token 不进日志；有 health/readiness；核心故障有可观察信号；数据库备份成功并真实 restore；附件私有存储且跨租户不可访问；runbook 足够让另一个人完成基础恢复。

## 9. Promote 条件

不建议一次 Promote 整个 Umbrella Stage。建议逐项激活 Production Configuration → Logging → Monitoring → Backup/Restore → Object Storage，实际顺序按上线时间调整。每个子 Task 单独 Design/Plan/Acceptance。

## 10. 完成后的退出条件

产品具备“可以开始认真谈上线”的最低工程基础，而不是“所有 Platform 能力都做完”。

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
