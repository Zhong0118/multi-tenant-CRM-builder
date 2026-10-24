# Settings centre and members: UX audit (phase 2)

- **Baseline:** `origin/main` at `5325ff5` (phase 1 and the integration fixes from #50).
- **Scope:** the settings home, the member directory and invitations, bulk member actions, and one member's access page with its editor drawer.
- **Out of scope:** the business-table designer, dashboards, AI and platform pages (later phases). The designer is only linked to.
- **Evidence:** `before/` in this folder, taken from the real pages as admin 刘洋 and employee 孙悦 on a clone of the dev database.

## What each setting needs before it takes effect

Read from the code and the API, not assumed:

| Setting                                                    | Where                         | Takes effect                       |
| ---------------------------------------------------------- | ----------------------------- | ---------------------------------- |
| Invitations, names, roles, disable or restore, admin handoff | 成员                         | Immediately                        |
| Member exceptions (table policy and column access for one employee) | 成员 → 访问权限     | Immediately; no publishing         |
| Employee defaults (table policy and column access for all employees) | 业务表 designer     | When the business table is published |
| Fields, forms, list defaults                               | 业务表 designer               | When the business table is published |
| Relationships and cross-table automation rules             | 关系与自动化                 | When the business table is published |
| Workbench layout                                           | 工作台配置                   | When the workbench is published    |

Administrators always have full access to every table (`resolveEffectiveAccess` returns everything for `TENANT_ADMIN`). Defaults and exceptions apply to employees only.

## 1. Settings home

| Problem | Evidence | Change |
| --- | --- | --- |
| Nothing says which settings take effect at once and which wait for publishing | `before/settings-1440.jpg` | Each row says 保存即生效 or 发布后生效; one sentence under the title explains the difference |
| Pending publications are a grey number on the right, hidden on phones | 「10 张使用中 · 1 张待发布」 in secondary text; `.rowValue { display:none }` below 768px | An attention row at the top when tables have unpublished changes; values stay visible on phones, under the description |
| A failed status request shows nothing | `values[...]` is `undefined` on error, so the row silently loses its value | 「状态读取失败」 in the value slot |
| The members row says only 「10 人」 | | Adds in-service administrators and pending invitations |

## 2. Member directory

| Problem | Evidence | Change |
| --- | --- | --- |
| No search or filter | API takes only `page` and `limit` (≤100) | Search by name or phone, role and status filters. While a search or filter is on, the whole roster is loaded in pages of 100 and filtered in the browser; the API is unchanged |
| Disabled members look active on phones | Role column `responsive: ["md"]`, status `["sm"]`: at 390px 郑凯 looks like everyone else (`before/members-390.jpg`) | Role and status move under the name on narrow screens |
| Avatars don't match the rest of the workspace | A custom blue letter; phase 1's `MemberIdentity` is used everywhere else | `MemberIdentity` (stable colour per member, 我 for the viewer, 已停用 marker) |
| Raw phone numbers | 「+8618800001001」 | 「188 0000 1001」 for +86 numbers; others unchanged |
| Access settings hidden in ⋯ | `before/members-row-menu-1440.jpg` | A visible 「访问权限」 link for active employees; 「全部权限」 for administrators, who aren't restricted by tables |
| No confirmation after a change | Status, role, name and invitation changes only refresh the table | A toast for each successful change; errors keep the request id |
| English screen-reader labels | antd's row checkbox says 「Select row 1」 | 「选择 陈静」, 「选择本页成员」 |
| Employee 403 has no way out | `before/members-employee-800.jpg` | 「返回工作台」 |

## 3. One member's access page

| Problem | Evidence | Change |
| --- | --- | --- |
| A wall of grey text | 10 tables × (two policy lines + one line per field) = 3,970px (`before/access-1440.jpg`) | One row per table: 来源 (员工默认 / 成员例外), what the employee can do now, and how many columns differ. Details open on demand, with a 员工默认 ↔ 当前生效 table |
| Defaults and exceptions read alike | Both are sentences of the same weight | Two labelled panels under the title explain 员工默认 (designer, published) and 成员例外 (here, immediate); each table row is tagged with its source |
| Choosing 「使用员工默认」 deletes the exception with no confirmation | The radio's `onChange` saves `INHERIT` at once | 「恢复为员工默认」 is a button with a confirmation that lists what is removed |
| Editing an exception appears inline under the text | Switches appear below the field list | 「设置例外」 opens the editor in the row; save and cancel sit together |
| The drawer's labels collide | 「线索名称员工默认：可编辑」, unstyled 「列权限」 heading (`before/access-drawer-1440.jpg`) | Name and default on two lines; a proper section heading |

## Kept as is

- All API calls, query keys, permissions, the final-admin protection, the offboarding preview and handoff, batch limits (100), and invitation semantics.
- The four integration fixes from #50 live in records, the pool and follow-ups. This phase does not touch those files.
