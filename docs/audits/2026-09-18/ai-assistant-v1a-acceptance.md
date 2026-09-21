# AI Assistant V1A — Acceptance

> 日期：2026-09-21
> 类型：产品阶段验收草稿（Ask / Analyze）
> 状态：**V1A 仍 ACTIVE**。COMPLETED 须等 PR C merge + post-merge main 六门 SUCCESS + 本文件 walkthrough 证据。PR C 尚未开 PR。

本文件只记录**已经发生**的事实。未观察到的项不预填为通过。

## 1. 已合并切片

| 切片 | PR | merge SHA | 状态 |
|---|---|---|---|
| PR A — AI Foundation | #14 | `64a22cde18eb5888f64b503c8873f627596b1e8d` | MERGED AND VERIFIED |
| PR B — Read Runtime | #16 | `466d9af80280c9d26f4c194c9f4787da57817137` | MERGED AND VERIFIED |
| PR C — Workspace UI + Closeout | 未开 | 走查时起点 `83a8a9ea0ef36733191263e624ac71826c4e846d`；随后本地增加 `AI_BASE_URL` | pending merge |

PR B post-merge main CI：https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/35559049090 （六门 SUCCESS）。

## 2. Critical AI cases（已在 PR B）

`pnpm --filter @crm/api test:e2e:critical` = **7/7**（走查前本地亦跑过）。

## 3. Real provider 配置（不写 secret）

| 项 | 值 |
|---|---|
| AI_PROVIDER | openai |
| AI_MODEL | deepseek-flash |
| AI_BASE_URL | `https://www.micuapi.ai/v1` |
| AI_TIMEOUT_MS | 45000 |
| AI_API_KEY | SET（仅 gitignored worktree `.env`） |

适配器通过可选 `AI_BASE_URL` 走 OpenAI 兼容网关。未使用 Fake Provider。

## 4. Browser walkthrough（2026-09-21，localhost:3000 / :3001）

租户：`nebula-demo`。角色：员工 赵晨 `18800001003`。本地 Postgres `:5432` 先补了 `0018_workflow_actions` + `0019_ai_conversations`；补之前 `GET /ai/conversations` 为 500（`ai_conversations` 不存在）。

### Desktop ≥1200（1280×800）

观察到：

- CRM Sidebar + Conversation Rail + Chat 三列
- Header「AI 助手 / 只读」
- Empty State 快捷问题
- 第一次发送创建会话，URL 变为 `?conversation=01a0c2ac-271a-71a1-9566-a958a5f74416`
- USER 气泡立即可见
- Assistant 流式完成后「回答已完成」
- Tool Activity「已完成的查询」可展开：`list_objects` / `describe_object` / `search_records` / `aggregate_records`
- Source Cards 链到 `/workspace/nebula-demo/objects/leads`
- 刷新同一 conversation URL 后消息恢复

未在桌面抓住 Stop 按钮（网关返回太快，Stop 未稳定出现）。未测 rename / delete / 加载更早消息锚点 / 长 2000 字破版。

### Permission smoke

问「帮我看看最近的销售线索」：

- UI 列表「我的销售线索」= 0 条
- AI 回答「当前账号可见的线索为 0 条」
- 数据库：赵晨 `owner_member_id` 下 0 条；标题含「新线索 赵晨」的记录实际挂在管理员 `+8618800001001`

问他人线索 UUID `1a2335fd-5dff-4f1a-8848-ccb999e7b234`（钱宇）：

- 页面未出现「新线索 钱宇」
- 出现 partial warning：「部分 CRM 数据暂时无法读取，本次回答可能不完整」
- 未观察到 hidden field 值（演示 `leads` employeeAccess 字段均为 EDIT，本租户无 HIDDEN 样本）

浏览器可见 SSE/JSON：turns POST 200；UI 无 raw tool JSON、无 provider `text-delta` 事件名。未导出完整 SSE 原文到验收文档。

### Source Card smoke

点击 `leads 0 条` → `/workspace/nebula-demo/objects/leads`，页面仍是「还没有记录」（当前员工权限再验）。未点到 TIMELINE+recordId（本轮无 timeline source）。

### Tablet ~900px

- 无横向 overflow（`scrollWidth === innerWidth`）
- Conversation Rail `display: none`，出现「会话」按钮
- CRM 侧栏收成图标，未形成三列挤压
- Composer 仍可用

### Mobile ~390px

- 无横向 overflow
- 「会话」打开 Drawer，内有「+ 新建会话」和今日会话
- Composer CSS 为 `position: sticky`
- Stop / Retry 本轮未在 390 宽稳定点到

### Accessibility

- 完成时 `aria-live` 文案「回答已完成」（非整 token 朗读）
- Tool toggle 可点；未用屏幕阅读器做完整键盘走查

### Error smoke

- 迁移前 list conversations 500 → 页面「连接已中断」（transport）
- 他人 UUID 回合 → partial warning
- Stop「回答已停止」：**本轮未点到 Stop**

## 5. Walkthrough findings

| 级别 | 项 | 处理 |
|---|---|---|
| Important | 「+ 新建会话」调用 `router.replace(pathname)` 后，另一处 effect 用 live `conversationId` 把 query 写回，会话未清空 | 改为仅在 `conversation.ready` 写 URL |
| Minor | 演示员工名下无线索，OWN=0 与 AI 一致，但种子标题「新线索 赵晨」实际属管理员 | 记录，不改权限逻辑 |
| Minor | 演示模板无 HIDDEN 字段，hidden-field smoke 无法在本租户完成 | 记录 |
| Minor | 真实网关过快，Stop 按钮未稳定捕获 | 记录 |
| Observed | 本地未迁 AI 表时 conversations 500 | 对本地库 `prisma migrate deploy`，未改 CI |

## 6. Non-goals（保持）

无 write tools、无 V1B、无 RAG、无 CI yaml 改动、无第二套视觉框架。未开 PR、未 merge。

## 7. Known limitations

- V1A COMPLETED 尚未成立
- Web Unit 历史上存在 unrelated `window is not defined` teardown flaky
- Source Card 只使用 `AiSourceSummary`
- 本机 walkthrough 使用米醋 OpenAI 兼容网关，不是官方 api.openai.com
