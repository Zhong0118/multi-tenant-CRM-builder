# AI Assistant V1A — Acceptance

> 日期：2026-09-21
> 类型：产品阶段验收草稿（Ask / Analyze）
> 状态：PR C 本地实现中；**V1A 仍 ACTIVE**。COMPLETED 须等 PR C merge + post-merge main 六门 SUCCESS + 浏览器 walkthrough。

本文件只记录**已经发生**的事实。未做的 walkthrough / 未 merge 的 PR C 不预填。

## 1. 已合并切片

| 切片 | PR | merge SHA | 状态 |
|---|---|---|---|
| PR A — AI Foundation | #14 | `64a22cde18eb5888f64b503c8873f627596b1e8d` | MERGED AND VERIFIED |
| PR B — Read Runtime | #16 | `466d9af80280c9d26f4c194c9f4787da57817137` | MERGED AND VERIFIED |
| PR C — Workspace UI + Closeout | 未开 | 本地 `feat/ai-assistant-v1a-workspace-ui` | 完成 pending merge |

PR B post-merge main CI：https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/35559049090 （六门 SUCCESS）。

## 2. Critical AI cases（已在 PR B）

`pnpm --filter @crm/api test:e2e:critical` = **7/7**，含：

- Employee `critical:search-own-leads`：OWN 可见、他人不可见、无 hidden `secret`、SSE 无 raw values
- 跨租户 / 同租户另一员工打不开他人会话

## 3. Browser walkthrough

**未完成。** 本机未在对话中配置可用 OpenAI secret；不得伪造 real-provider walkthrough。

若后续走查受阻于本地凭证，状态为：

`REAL_PROVIDER_SMOKE_BLOCKED_BY_LOCAL_CREDENTIAL`

## 4. Non-goals（保持）

无 write tools、无 V1B、无 RAG、无 CI yaml 改动、无第二套视觉框架。

## 5. Known limitations

- V1A COMPLETED 尚未成立
- Web Unit 历史上存在 unrelated `window is not defined` teardown flaky（create-template-form / logout-button）
- Source Card 只使用 `AiSourceSummary`，点击走当前 CRM route 再验权限
