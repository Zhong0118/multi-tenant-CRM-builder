# Phase 2 verification

**Environment**

- This branch on :3720 (web) and :3721 (API), against `crm_ui_settings`, a clone of the phase-1 acceptance database. Shared dev data is untouched.
- Signed in as admin 刘洋 and employee 孙悦 (tenant `nebula-demo`) in the browser pane.
- Data changed during checks, all in the clone and all reverted:
  - a table exception for 孙悦 on 课程业务表, saved and then restored to the employee default;
  - two invitations to fictional numbers (139 0000 9998/9999), created and then revoked.

## Acceptance checklist

| Scenario | Result |
| --- | --- |
| Settings home: each page says 保存即生效 or 发布后生效; one line explains the difference | ✅ 1440, 390 |
| Settings home: unpublished tables shown as an attention row linking to 业务表 | ✅ (1 table pending in the clone) |
| Settings home: statuses stay visible on phones; a failed status reads 状态读取失败 | ✅ 390; failure covered by a unit test |
| Members: `MemberIdentity` avatars, 我 for the viewer, 已停用 marker, phones as 188 0000 1001 | ✅ 1440, 900, 390 |
| Members: role and disabled state visible on phones (were hidden) | ✅ 390 |
| Members: search by name or phone across the whole roster; role and status filters; result count; 清除筛选; empty result | ✅ 「周」 → both 周岚; 已停用 → 郑凯 |
| Members: 访问权限 column — 查看和设置 for active employees, 全部业务表 for admins, 停用期间无法访问 | ✅ |
| Members: selection bar with 设置访问权限 / 批量管理 / 取消选择 | ✅ |
| Members: Chinese checkbox labels (选择 林员工, 不能选择自己) | ✅ |
| Invite: dialog stays open on 邀请已发送 with the registration link (closed instantly on `main`) | ✅ |
| Invitations: name, phone and expiry (7 天后过期); revoke confirmation; toast 邀请已撤销; 已撤销 status | ✅ |
| Access page: legend for 员工默认 (designer, publish) vs 成员例外 (here, immediate) | ✅ |
| Access page: one row per table with source tag and effective 新建 / 查看 / 修改; 全部 / 有例外 filter | ✅ 10 tables in one screen (was 3,970px) |
| Access page: details compare default vs effective for the table and each column | ✅ |
| Access page: 设置表例外 → 保存例外 saved, tag 成员例外, changed cell highlighted, result shown in the row | ✅ |
| Access page: 恢复为员工默认 asks first, names the default the member returns to, then restores | ✅ |
| Access drawer: column name and default on separate lines; 列权限 heading; terms match the page | ✅ |
| Widths 1440 / 1280 / 900 / 390: no horizontal overflow on settings, members, access | ✅ |
| Reduced motion: the row-expand animation and chevron rotation are off under `prefers-reduced-motion` | ✅ CSS rule |
| Employee 孙悦: 设置 and the access page are 404; no 设置 in the sidebar; 成员 shows the admin-only result with 返回工作台 → `/workspace/nebula-demo` | ✅ |

## Automated checks

- `pnpm test:unit` (web): 1,016 / 1,016 in 117 files, including new tests for whole-roster search, filters, failed-load retry, success toasts, checkbox labels, the settings home, and the access page's confirm-before-restore.
- `tsc --noEmit`: clean.
- ESLint (`src`): no errors; one existing warning in `dashboard-builder.tsx`, which this branch doesn't touch.
- `next build`: succeeds.

## Findings for the backend agent

1. **No member search.** `GET /members` accepts only `page` and `limit` (≤100). The page loads the whole roster in pages of 100 while a search or filter is on; a `q`, `role` and `status` query would let large companies search without that.
2. **No avatar URL** on members (unchanged from phase 1); avatars are initials.

## Known limitations

- Search loads at most 50 pages (5,000 members).
- Two members with the same name still share an avatar colour by chance; their phone numbers now tell them apart.
- Invitations list every status, so revoked invitations stay visible; the tab's count shows pending ones only.
- Business-table designer, workbench and relationship pages are linked to but not restructured (phase 3).
