# AI Assistant V1A — Acceptance

> 日期：2026-09-22
> 类型：产品阶段验收（Ask / Analyze）
> 状态：**AI Assistant V1A = COMPLETED**。PR A/B/C MERGED AND VERIFIED。browser walkthrough VERIFIED。post-merge main 六门 SUCCESS。**AI Assistant V1B = PLANNED**。

本文件只记录**已经发生**的事实。未观察到的项不预填为通过。

## 1. 已合并切片

| 切片 | PR | merge SHA | 状态 |
|---|---|---|---|
| PR A — AI Foundation | #14 | `64a22cde18eb5888f64b503c8873f627596b1e8d` | MERGED AND VERIFIED |
| PR B — Read Runtime | #16 | `466d9af80280c9d26f4c194c9f4787da57817137` | MERGED AND VERIFIED |
| PR C — Workspace UI + Closeout | #17 | `b3bc59acba4e16dbee556ead0670386344822eec` | MERGED AND VERIFIED |

PR B post-merge main CI：https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/35559049090 （六门 SUCCESS）。
PR C post-merge main CI：https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/35696132661 （六门 SUCCESS）。

## 2. Critical AI cases（已在 PR B）

`pnpm --filter @crm/api test:e2e:critical` = **7/7**。

## 3. Real provider 配置（不写 secret）

| 项 | 值 |
|---|---|
| AI_PROVIDER | openai |
| AI_MODEL | deepseek-flash |
| AI_BASE_URL | `https://www.micuapi.ai/v1` |
| AI_TIMEOUT_MS | 45000 |
| AI_API_KEY | SET（仅 gitignored worktree `.env`） |

```text
APPROVED DEVIATION:
optional server-only AI_BASE_URL retained
```

Human 选择 B：正式保留可选、仅服务端、仅 deployment 级的 `AI_BASE_URL`。walkthrough provider：

| 项 | 值 |
|---|---|
| adapter family | openai |
| runtime provider identity | openai-compatible |
| model | deepseek-flash |
| endpoint host | www.micuapi.ai |

未使用 Fake Provider。不写 API key。未新增第二套 adapter，未改变 permission pipeline。

identity 修正后的最小真实 smoke（赵晨，conversation `01a0c49e-6598-79b4-8da4-8583cfea72d2`）：turn completed；持久化 assistant `provider_key=openai-compatible`、`model_key=deepseek-flash`。未导出 raw payload。

## 4. Permission fixture（仅本地 nebula-demo，未提交）

通过 Admin UI（陈静）新建并发布对象 `ai-permission-check`：

- 字段：`name` EDIT、`public_note` EDIT、`secret_note` Employee HIDDEN
- employeeAccess：`canRead/canUpdate/canCreate`，`readScope=OWN`，`updateScope=OWN`
- Record A `9df660ec-222b-4067-b91c-d6d342b9767c` owner=赵晨，`secret_note=HIDDEN-SHOULD-NOT-APPEAR`，有 Activity「赵晨记录A的活动备注」、Follow-up「明天跟进赵晨记录A」
- Record B `e978e7f0-ac62-4f4a-ac8d-2421a0b29feb` owner=钱宇

员工列表核验：共 1 条，含「赵晨可见记录A」，不含「钱宇记录B」，列中无「内部备注」/ hidden 值。

## 5. Browser walkthrough（续）

租户：`nebula-demo`。员工：赵晨 `18800001003`。

### OWN + HIDDEN real-provider

问「列出我能看到的 ai-permission-check 记录并总结」：

- 自己 Record A「赵晨可见记录A」出现
- Record B「钱宇记录B」不出现
- `secret_note` / 「内部备注」/ `HIDDEN-SHOULD-NOT-APPEAR` 不出现在 answer、Tool Activity、Sources
- describe_object 只列出 `name`、`public_note` 两个可见字段

问 Record B UUID `e978e7f0-ac62-4f4a-ac8d-2421a0b29feb`：

- 不返回钱宇记录内容
- 不返回 hidden 值
- 出现 partial warning；工具返回 `DATA_UNAVAILABLE`

### TIMELINE Source

问「总结记录 9df660ec-222b-4067-b91c-d6d342b9767c 最近的活动记录」：

- 回答含活动内容「赵晨记录A的活动备注」
- Source 链接 `/workspace/nebula-demo/objects/ai-permission-check/9df660ec-222b-4067-b91c-d6d342b9767c`
- 点击后详情打开；员工页无 hidden 值、无「内部备注」列

### Stop / Retry

- 多 tool 问题发送后点 Stop → UI「回答已停止」
- 刷新同一 conversation → 仍「回答已停止」，Retry 可用
- 点 Retry → 同一会话完成（「回答已完成」）
- Stop 后立即再发送：turns POST **200**，**未出现** `AI_MEMBER_TURN_IN_PROGRESS` / 409

### Conversation UX

- rename：「权限检查会话」，refresh 后名称保持
- delete 当前会话：rail 去掉该标题，URL 变为 `/workspace/nebula-demo/ai`，回到 empty state
- Older history：**NOT OBSERVED — INSUFFICIENT LOCAL HISTORY**（未为凑数消耗真实 token；已有 deterministic UI/API tests）

### Mobile ~390px 补项

- 无横向 overflow
- Stop bounding box 可见并可点（y≈780）
- Retry bounding box 可见并可点
- 「会话」打开 Drawer

### Keyboard smoke

- Composer focus（placeholder）
- Tab 到「发送」aria-label
- Enter 发送后 Stop 可 focus + Enter 停止
- Retry 可 focus
- 「会话」按钮可 focus

## 6. Walkthrough findings

| 级别 | 项 | 处理 |
|---|---|---|
| Important | 「+ 新建会话」曾被 live conversationId 写回 URL | 已改为仅 `conversation.ready` 写 URL |
| Important | 会话操作 Dropdown 被 chat 层挡住 / rail overflow 裁切 | `getPopupContainer=document.body`；rail `z-index:2` |
| Observed | 本地未迁 AI 表时 conversations 500 | 对本地库 `prisma migrate deploy` |
| Observed | 首次 OWN 发布时 readScope 仍 ALL，员工能看到钱宇记录 | Admin UI 改 OWN 后重新发布，员工列表变为 1 条 |
| Scope | 可选 `AI_BASE_URL` | APPROVED：`providerKey=openai-compatible`，不持久化 URL/key |

## 7. Non-goals（保持）

无 write tools、无 V1B、无 RAG、无 CI yaml 改动。fixture 仅本地，未提交。

## 8. Known limitations

- Web Unit 历史上存在 unrelated `window is not defined` teardown flaky
- Source Card 只使用 `AiSourceSummary`
- 本机 walkthrough 使用米醋 OpenAI 兼容网关，不是官方 api.openai.com
- older-history：**NOT OBSERVED — INSUFFICIENT LOCAL HISTORY**；由 deterministic pagination / scroll tests 覆盖

## Post-merge status

PR C #17 已 merge。merge commit / `origin/main` = `b3bc59acba4e16dbee556ead0670386344822eec`。post-merge run `35696132661` 六门 SUCCESS。本节**不回填、不重算**走查证据。**AI Assistant V1A = COMPLETED**。**AI Assistant V1B = PLANNED**。
