# Phase 5 verification

**Environment**

- **Branch:** `codex/workspace-ui-platform` from `1a67aa0`. origin/main was rechecked at wrap-up and is unchanged.
- **Servers:** web :3730, API :3731.
- **Database:** `crm_ui_platform`, a clone of the phase-4 test database. Shared dev data and other agents' worktrees, ports and databases are untouched.
- **Accounts:** I tested as:
  - super administrator `admin`;
  - company admin 刘洋 (`nebula-demo`);
  - employee 孙悦.

  You signed in to each account yourself in the browser pane.

**Test data:** none written.

- I created a business table in the template editor and typed a daily-report draft, only to exercise the leave guards. Both were discarded without saving, and the local draft copy was removed.
- No company status, invitation or template was changed.

## Acceptance steps and results

| # | Role | Step | Result |
| --- | --- | --- | --- |
| 1 | Super admin | Overview at 1440: count cards coloured only when the count needs attention, 「没有暂停的公司」 as quiet text, 「最近一次变更」 showing the newest real log entry | ✅ |
| 2 | Super admin | Company list: status tabs with counts, search keeps the status, masked phones, 「2 位在职 · 无邀请记录」 for nebula-demo; no horizontal scroll at 1440 and 1280 | ✅ |
| 3 | Super admin | nebula-demo detail: invitation step complete with 「已有公司管理员，无邀请记录」; facts and status actions above the table overview; earlier template application as provenance | ✅ |
| 4 | Super admin | Draft company `sss`, invitation expired: 重新邀请管理员 is the primary action, 「当前不能启用公司」 explains why | ✅ |
| 5 | Super admin | Unknown company ID and unknown `/platform/...` address → in-shell 「页面不存在」 with 返回总览 | ✅ |
| 6 | Super admin | Templates: 「公司可用 v2」 / 「尚未发布，公司不可用」, content and application counts, no pager on one page | ✅ |
| 7 | Super admin | Template editor: add a table, click a sidebar link → 「放弃未保存的模板修改？」; 继续编辑 stays, 放弃修改 leaves | ✅ |
| 8 | Super admin | 操作记录: one sentence per application, 「已生成 · N 张业务表草稿」 | ✅ |
| 9 | Super admin | 日志中心: entries by day as sentences with outcome; company filter narrows to 1835 entries and resets action/object facets; detail drawer shows facts, readable changes and folded raw JSON | ✅ |
| 10 | Super admin | Keyboard: focus an entry, Enter opens the detail with focus inside, Esc closes and returns focus to the entry | ✅ |
| 11 | Super admin | System settings: 只读, check time in Beijing time, 「1 项需要留意」 (SMS in development mode), policies separate; no editable controls | ✅ |
| 12 | Super admin | /workspaces without a company: blue theme, 百杰 CRM mark, 管理中心 link, 「还没有加入公司」 with 进入管理中心 | ✅ |
| 13 | Super admin | Account security in the workspace theme; session tags use `StatusTag` | ✅ |
| 14 | Super admin | 11 platform and account pages at 1280, 900 and 390: no horizontal overflow; 日志中心 at 390 keeps time on the entry line (chevron bug fixed) | ✅ |
| 15 | Super admin | API stopped → 「页面加载失败」 with an error number; API restarted → 重新加载 shows the company list | ✅ (see known issue 1) |
| 16 | Company admin | 公司审计: readable sentences; detail shows 「状态 待跟进 → 已完成」 instead of `status OPEN → DONE` | ✅ |
| 17 | Company admin | 15 workspace pages at 1440 and 390 load without errors or overflow: workbench, members, tables, relations and automation, record lists, follow-ups, tasks and reports, team, AI, audit, statistics, import/export, settings | ✅ |
| 18 | Company admin | Member search 「周」 → 2 members, 「共 2 位成员」, URL `?page=1&q=周` | ✅ |
| 19 | Company admin | Published workbench keeps saved order and widths (1/4 = 276px, 1/2 = 567px, full = 1147px at this content width) | ✅ |
| 20 | Company admin | Unknown workspace address → in-shell not-found with 返回工作台 | ✅ |
| 21 | Employee | /team, /settings, /settings/objects → in-shell 「页面不存在，或你没有访问权限」, sidebar kept, 返回工作台 | ✅ |
| 22 | Employee | /audit → 「仅公司管理员可查看公司审计」 (was 「页面没有加载成功」; fixed); /members → 「仅公司管理员可管理成员」 | ✅ |
| 23 | Employee | Own pages (workbench, follow-ups, tasks and reports, AI, two record lists, statistics) at 1440 and 390: no errors, no overflow | ✅ |
| 24 | Employee | Daily report: type, click a sidebar link → 「放弃未保存的日报？」; 放弃修改 leaves and removes the local draft | ✅ |
| 25 | Employee | Account security: workspace theme, no 管理中心 link | ✅ |

## Automated checks

- **`vitest run` (web):** 1,075 tests pass in 121 files. New or updated tests cover:
  - audit change derivation and value formatting;
  - the platform audit entry and drawer;
  - the company audit's readable system fields;
  - operation records and the read-only settings;
  - the overview's quiet zero counts and latest change, including the unavailable case;
  - the setup rail without an invitation row;
  - template states and the hidden pager;
  - the template editor leave guard;
  - login-history failure and retry;
  - decline confirmation.
- **`tsc --noEmit`:** clean.
- **ESLint:** no findings on the changed files.
- **Prettier:** clean on every file that was Prettier-clean at the base, and on all new files.
- **`next build`:** succeeds.

## Findings for the backend (unchanged here)

1. **Only successful template applications are recorded.**
   - The operations API (`PlatformOperationDto.status`) has only `SUCCEEDED`, so a failed application leaves no trace on 操作记录.
   - The page states what it records and shows no other states.
2. **nebula-demo has two admins but no first-admin invitation row** (seeded data). The UI now says 「无邀请记录」 instead of implying an invitation is missing.
3. **The audit API returns `before` / `after` snapshots, not a field diff.**
   - The platform audit derives changes in the browser. Unlabelled keys keep their code.
   - The company audit's `changes` carry no label for system keys such as `status`, and the UI labels those.
   - Server-side labels for system keys would remove both mappings.
4. **Employees get 403 from `/workspaces/{code}/audit` and 404 from several other admin pages.**
   - The UI now shows a no-access panel for audit from the member's role.
   - A uniform 403 with a reason code would let pages tell 「不存在」 from 「无权限」; today the not-found panel names both.
5. **Still open from phase 4:**
   - disabled members in rankings;
   - no API for leads awaiting assignment;
   - no result field on follow-ups;
   - AI due times in UTC;
   - `req_unknown` on network failures.

## Known issues

1. **With the API down, every signed-in page shows the app-wide 「页面加载失败」,** because the layouts check the session on the server. Section-level error panels with 重试 apply once the layout has loaded. Same as phase 4.
2. **The breadcrumb on an unknown `/platform/...` address reads 总览.** The panel itself is correct.
3. **Same-name members** (two 周岚) and the avatar limits from earlier phases still apply.
