# Phase 4 verification

**Environment**

- This branch, `codex/workspace-ui-work` from `e41eefa`, ran on :3730 (web) and :3731 (API) against `crm_ui_work`, a clone of the phase-3 test database. Shared dev data is untouched.
- I tested as admin 刘洋 and as employee 孙悦 (tenant `nebula-demo`); you signed in to each account yourself in the browser pane.

**Test data created in the clone** (left in place as evidence):

- **Workbench `home`:** 商机阶段 set back to half width; published as v11.
- **Tasks:** two tasks assigned to 孙悦 by 刘洋 from 团队动态:
  - 整理星河教育报价单, due today;
  - 回访云帆贸易确认采购数量, due tomorrow.

  孙悦 completed both, with results.
- **Follow-ups:** all on 跟单商机 #6 (数字化项目 孙悦-2):
  - **刘洋** created 电话确认需求清单 (10:00 today, overdue), 发送报价方案 (20:30 today) and 约客户上门演示 (Tuesday 15:00);
  - **孙悦** created 核对采购数量回电 (yesterday, overdue) and 整理演示环境账号 (tomorrow), and completed both.
- **Daily reports:** for 2026-10-24, from 刘洋 (restored from a local draft) and from 孙悦.
- **AI:** one conversation from 刘洋, 「最近有哪些需要跟进？」, with one completed turn and one stopped turn.

## Acceptance steps and results

| # | Step | Result |
| --- | --- | --- |
| 1 | Published workbench at 1440: components in saved order; 1/4 = 279px, 1/2 = 572px, full = 1158px | ✅ |
| 2 | Same page at 900: two columns, 1/4 → 382px (two per row), 1/2 and full take the row; 390: one column; no horizontal overflow | ✅ |
| 3 | Configurator 预览草稿 renders the saved draft with the runtime renderer; with unsaved canvas edits it says the preview is the last saved draft | ✅ |
| 4 | Old canvas note about widths removed (after 1–3) | ✅ |
| 5 | Admin workbench: 团队待处理 shows 1 follow-up overdue, 0 tasks overdue, 9 members without today's report, and lists 刘洋 with 1 overdue; links to 团队动态 | ✅ |
| 6 | 今天要处理 (admin): 已逾期 1 / 今日 1 / 未来7天 1; labels 「已逾期 · 今天 10:00」 (red), 「今天 20:30」 (amber), 「10/27 15:00 周二 15:00」 | ✅ |
| 7 | Employee workbench: no 团队待处理; 我的任务 2 项进行中 with 「刘洋 安排」, 「今天 23:59」 / 「明天 23:59」; same width layout as admin | ✅ |
| 8 | 安排任务 from 团队动态 → toast 「已给孙悦安排「…」」, list updated | ✅ |
| 9 | 安排跟进 on a record (admin and employee) → toast per item; empty state on a record now points to 安排跟进 | ✅ |
| 10 | Employee completes a follow-up from 跟进待办 → toast and a success note linking to the record to log the result in 动态 | ✅ |
| 11 | 已逾期 tab with nothing overdue → 「目前没有逾期事项」; 已完成 shows 「原定 2026-10-23 16:00」 | ✅ |
| 12 | Employee completes a task with a result → toast; 已完成 filter shows status and 「结果：…」; the report's 当天记录 updates at once (bug found and fixed here) | ✅ |
| 13 | Report: type, then click a sidebar link → 「放弃未保存的日报？」 with 继续编辑 / 放弃修改; stays on the page | ✅ |
| 14 | Report: type, reload → 「有一份未保存的日报草稿（10-24 16:43 暂存在本机）」 → 恢复草稿 → 保存日报 → toast, 「已保存 · 10/24 16:44」, local copy removed | ✅ |
| 15 | Read-only: admin opens 孙悦's report from 团队动态 → read-only view with the system record, nothing editable (`canEdit` is false only for other members' reports) | ✅ |
| 16 | Failure: stop the API, switch the task filter → 「任务读取失败：服务暂时不可用，请稍后重试。」 with 重试, report unaffected | ✅ |
| 17 | Failure: save the report with the API down → error with request ID, 「你的修改仍在这里，也已暂存在本机。」, text kept; restart → 重试 and save succeed | ✅ |
| 18 | 团队动态: categories with team totals; 跟进待办 shows bars per column; member name opens the detail drawer with member vs team for every metric | ✅ |
| 19 | 团队动态 at 1280 and 390: no horizontal page overflow (task filters wrap; bug found and fixed in the shared section header) | ✅ |
| 20 | Employee opens /team → 页面不存在; no link in the sidebar | ✅ |
| 21 | AI: conversation search and per-row time; real turn streams with tool status 「已查询 3 项 CRM 数据」, elapsed time, sources, 复制回答 | ✅ |
| 22 | AI: Esc while generating → 「回答已停止」; after reload the turn shows 已停止 with 重试 | ✅ (see known issue 1) |
| 23 | AI: clipboard blocked (browser pane) → inline 「无法写入剪贴板，请选中回答文字手动复制」 | ✅ |
| 24 | AI, follow-ups, work at 390: no horizontal overflow | ✅ |

## Automated checks

- `pnpm test:unit` (web): 1,050 tests passing in 119 files. New or updated tests cover:
  - widths and saved order on the published workbench;
  - due labels;
  - the agenda and its isolated task column;
  - follow-up feedback;
  - task, report and draft recovery, including the report reloading after a task changes;
  - team-activity groups;
  - conversation search and time;
  - Esc to stop;
  - copying an answer (success and failure);
  - aggregate number formatting.
- `tsc --noEmit`: clean. ESLint: no errors (one existing warning in `dashboard-builder.tsx`). `next build`: succeeds.

## Findings for the main agent (backend, unchanged here)

1. **Rankings show a member ID for disabled members.**
   - **Reproduce:** publish a workbench with a 排行 component counting records owned by a disabled member (郑凯 in the demo data). The API returns `displayName` equal to the member ID.
   - **Cause:** `apps/api/src/modules/dashboards/dashboards.repository.ts:726-736` joins `tenant_members` with `tm.status = 'ACTIVE'`.
   - **Here:** the UI shows 其他成员.
2. **No API for leads waiting to be assigned.** 团队待处理 cannot include them, and no count is made up.
3. **Follow-ups have no result field.** Completing a follow-up records no result, so the UI points to the record's 动态. A result on completion would let the agenda and reports show it.
4. **Follow-up and task list responses carry no time zone.** The company time zone is read from the follow-up workbench response (`timezone`) and cached. A tenant time zone in the session or in each list would remove the extra request.
5. **The AI states due times in UTC.**
   - **Reproduce:** ask 「最近有哪些需要跟进？」. A follow-up due at 10:00 Asia/Shanghai is described as 「到期 2026-10-24 02:00」.
   - **Cause:** the tool results give ISO times without the tenant time zone, and the model formats them as given.
6. **An AI source title shows an object code.**
   - **Reproduce:** the same question; one source card reads `opportunities` (1 条记录) instead of 跟单商机.
   - **Cause:** the source summary's `objectName` is the code for that tool.
7. **Network failures print 「请求编号：req_unknown」.** When no response arrives, `apps/web/src/lib/api/api-error.ts` falls back to `req_unknown`. It is harmless but could be omitted when there is no real request ID (shared code, left as is).

From phase 3, still open: money stored as JSON numbers in the demo data; runtime automation previews showing option keys and ISO times; no rule-level execution statistics.

## Known issues

1. **Stopping before the server confirms the turn.**
   - **What happens:** if Esc is pressed before `turn.started` arrives, the page has no turn ID, so the stop notice has no 重试. After a reload, the server's stopped turn appears with 重试.
   - **Possible fix:** reconcile against the refetched conversation. That changes the turn state machine, so it was left out of this phase.
2. **Without the API, the workspace shows the app-wide 「页面加载失败」 page,** because the layout checks the session on the server. Section-level errors (16, 17) appear once the page is loaded.
3. **Same-name members** (two 周岚 in the demo data) and the avatar limits from phases 1–2 still apply.
