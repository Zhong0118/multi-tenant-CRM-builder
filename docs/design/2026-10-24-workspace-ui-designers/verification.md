# Phase 3 verification

**Environment**

- This branch on :3730 (web) and :3731 (API), against `crm_ui_designers`, a clone of the phase-2 test database. Shared dev data is untouched.
- Signed in as admin 刘洋 and employee 孙悦 (tenant `nebula-demo`) in the browser pane.

**Test data changed in the clone** (left in place as evidence):

- 跟单商机:
  - rules 成交后生成合同 (automatic, when 商机阶段 becomes 已成交) and 记录一次拜访 (manual);
  - 推进说明 read-only for employees;
  - published as v10.
- 合同: rule 登记回款 (manual, admins only), published.
- 流程验收表:
  - state 跟进中（拜访） and action 开始跟进 (新建 → 跟进中), published as v3;
  - record #3 created and moved to 跟进中 by 孙悦.
- 跟进活动 #17, created by 孙悦's run of 记录一次拜访.
- Workbench `home`: 商机阶段 set to full width, published as v10.
- 课程业务表: description changed through the API to force a version conflict, then reset (the draft revision moved on).

## Acceptance steps and results

| # | Step | Result |
| --- | --- | --- |
| 1 | Open 跟单商机 at 1440: section rail grouped 结构 / 权限 / 规则 / 发布 with hints | ✅ |
| 2 | 字段与表单 says it sets the form order and links to 列表展示与搜索; the list section says its column order is separate | ✅ |
| 3 | 列表展示与搜索: numbered columns, ↑↓, header preview with sort and search summary | ✅ |
| 4 | 员工权限: set 推进说明 to 只读 → row says 未保存, rail dot, 发布变更 disabled | ✅ |
| 5 | Save → 已保存草稿 只读 + 待发布, live column still 可编辑; reload keeps it | ✅ |
| 6 | 发布与停用 → 检查并发布 → 确认发布 → v10 at the top of the history, status 与员工使用的版本一致 | ✅ |
| 7 | Employee: 推进说明 shown read-only (仅管理员可编辑) in the edit form | ✅ |
| 8 | 流程: add state and action; the map updates live and flags the state with no way out; save clears the unsaved mark (bug found and fixed here); reload keeps it; publish | ✅ |
| 9 | Employee: new record in 新建 offers 标记赢单 and 开始跟进; running it moves to 跟进中（拜访） with history | ✅ |
| 10 | Rules saved as drafts → relationships 待发布草稿 · 2 张表有修改; after publishing both tables, 当前生效 shows ①②③ | ✅ |
| 11 | Selecting ① highlights the map rule and opens trigger, result, roles and field mappings; option values show labels | ✅ |
| 12 | Employee: 记录一次拜访 preview → 确认创建并关联 → 跟进活动 #17 created and linked (关联 1, 执行记录 1), as the map's 执行结果 says | ✅ |
| 13 | Workbench: width change shows on the canvas; save draft (草稿已保存，尚未发布); publish (第 10 版) | ✅ (see known issue 3) |
| 14 | Version conflict: change the draft elsewhere, save stale basics → message with request id, 重新载入配置, typed name kept; reload loads the other change and clears the mark | ✅ |
| 15 | Unsaved edits: switching section, clicking 业务表 breadcrumb or sidebar link, reload/close all ask first | ✅ (unit tests + browser) |
| 16 | Publish blockers: grouped, counted, field label beside key, 去修改 opens the section/field, 重新检查 | ✅ (unit test; no real blocker in the test data) |
| 17 | Widths 1440 / 1280 / 900 / 390: no horizontal page overflow on the designer sections, relationships and workbench (the permission matrix and table preview scroll inside their own box on phones) | ✅ |
| 18 | Employee: designer, relationships and workbench configurator are 404 | ✅ |
| 19 | Reduced motion: rail, chevrons, map buttons, library and card transitions off under `prefers-reduced-motion` | ✅ CSS rules |

## Automated checks

- `pnpm test:unit` (web): 1,036 / 1,036 in 118 files. New tests cover:
  - section rail, unsaved guards (section switch and in-app links), the permission matrix and its title-column warning;
  - publication history and its failure state;
  - the workflow map, transition summaries and dirty reporting;
  - publish-blocker locate and recheck;
  - relationship numbering and rule results;
  - canvas width.
- Existing designer tests were kept; the ones that opened disable/restore from 基本设置 now open 发布与停用.
- `tsc --noEmit`: clean. ESLint: no errors (one existing warning in `dashboard-builder.tsx`). `next build`: succeeds.

## Findings for the backend agent

1. **Every field reported as changed on every publication.**
   - Reproduce: publish 跟单商机, then immediately `POST …/object-definitions/{id}/publication-analysis` with the current version. All five fields come back as `UPDATED`, and every row in the publication history says 修改字段.
   - Likely cause: `analyzeFieldChanges` (`apps/api/src/modules/objects/object-configuration.policy.ts:755`) compares `JSON.stringify(toPublishedField(field))` with the stored published field, and PostgreSQL `jsonb` reorders object keys.
   - The UI shows what the API returns.
2. **Money stored as JSON numbers in the demo data.**
   - Reproduce: 跟单商机 records have `data.amount` as a JSON number (`71000`) while the API contract and the money control use decimal strings. As an employee, open #6 → 编辑: 预计金额 is blank although the record shows 71,000.00.
   - Records code is outside this phase; the data or the API should normalise to strings.
3. **Runtime automation preview has no display metadata.**
   - Reproduce: the employee's preview of 记录一次拜访 shows 活动类型 `visit` and 发生时间 `2026-10-24T06:59:14.565Z`.
   - The preview response has `fieldLabels` but no field types or option labels, so the panel cannot format them. Suggest `displayValues` or field metadata in the preview response.
4. **No rule-level execution statistics.** Executions exist per record (`…/automations/history`), so the overview states what a run produces but cannot show how often each rule ran.

## Known issues

1. **Published workbench ignores widths.** `layoutDashboardWidgets` groups components by type (metrics, trends, distributions, rankings, lists) and no renderer reads `width`. The canvas says so in a note and points to 预览草稿. Making widths take effect is workbench runtime work (phase 4).
2. **Phones:** the permission matrix and the 列表 header preview scroll sideways inside their box; drag reordering of fields and workbench components is easier on a computer (the 上移/下移 buttons work everywhere).
3. **Same-name members** and avatar limitations from phases 1–2 still apply.
