# Engineering Gate Lite — Stage Brief

> 日期：2026-09-16  
> 类型：Stage Brief  
> 状态：PLANNED  
> 所属：CRM Lean Roadmap  
> 预计开销：0.2–0.4 × Workflow V1

## 1. 目标

为后续 Sales Workbench、AI Assistant 和生产化开发建立最小但真实的工程守门。

目标不是“把所有工程治理一次做完”，而是做到：任何新的核心功能进入 `main` 前，都有一套稳定、自动、与本地真实验证一致的最小回归门禁。

## 2. 近期价值

这个阶段主要保护后面的高风险功能：AI 权限边界、Workflow / Action Engine、多租户隔离、Dashboard / Follow-up、Production Essentials。

## 3. V1 范围

只做最小 Gate：GitHub Actions CI、pull request 触发、main / PR 核心验证、required checks、main branch protection、明确 required E2E 与 manual E2E 边界，并保持本地验证命令与 CI 一致。

第一批候选 required checks：`typecheck`、`contracts:check`、workspace tests、production build。E2E 是否成为 required checks，要在 Design 阶段基于稳定性和数据库依赖决定。

## 4. 明确不做

不清零所有 lint 历史债务；不做自动部署、复杂 release pipeline、多环境 promotion、coverage 硬门槛、SAST 平台、性能基准平台、生产 migration 自动化。

## 5. 关键设计约束

CI 必须复用仓库真实命令，不得创建“为了绿而绿”的独立脚本。历史红灯要与新回归区分。Branch Protection 必须在 CI workflow 稳定、check 名称固定之后开启。

## 6. 安全边界

GitHub Actions 不输出 secrets；PR 不拿生产凭据；不自动访问生产数据库；CI 数据库必须隔离；required checks 不能被空跑/skip 轻易绕过。

## 7. 预计改动面

激活后可能涉及 `.github/workflows/**`、必要的 pnpm scripts、docs/HANDOFF。原则上不因 CI 修改业务逻辑。

## 8. Acceptance Outline

至少证明：正常 PR 能跑 required checks；type error、contract drift、unit failure、build failure 都能让对应 check 红；required checks 能阻止 merge；CI 不依赖开发者本机未提交文件；日志不泄露 secret；文档能让开发者本地复现。

## 9. Promote 条件

当前 Security Closeout 已完成或明确独立收口；准备进入连续产品功能开发；当前 main baseline 被重新核对；用户批准 Gate Lite 的最小 check 范围。

## 10. 完成后的退出条件

后续 Task 不再临时决定“要跑哪些检查”，而是有最小自动守门；完成后不自动进入下一阶段。

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
