# Daily workspace and AI assistant: UX audit (phase 4)

- **Baseline:** `origin/main` at `e41eefa` (phases 1–3).
- **Scope:** the workbench at runtime (published page and draft preview), the administrator and employee workbenches, 跟进待办, 任务与日报, 团队动态 and the AI assistant.
- **Evidence:** `before/` and `after/` in this folder. Screenshots come from the real pages, as admin 刘洋 and employee 孙悦, on `crm_ui_work`, a clone of the phase-3 test database.

## Findings and changes

### Workbench runtime layout
| Problem | Change |
| --- | --- |
| The published workbench grouped components by type (metrics, trends, distributions, rankings, lists) and ignored each component's saved width. Phase 3 left a note on the canvas saying so | Components now render in their saved order on a grid that follows each saved width: four columns on wide screens (1/4, 1/2 and full row), two columns when the content area is under 880px (half and full widths take the whole row), and one column under 560px. The grid uses container queries, so a collapsed sidebar or a preview panel gets the right layout too |
| 预览草稿 showed a summary list, not the page | The preview renders the saved draft with the same renderer as the published page, so the layout matches. Data uses the viewer's permissions. With unsaved canvas edits, the preview says it still shows the last saved draft |
| Old restriction note on the canvas | Removed after the runtime layout was implemented and verified (1440: 1/4 = 279px, 1/2 = 572px, full = 1158px) |
| Disabled members in rankings showed a raw member ID | Shown as 其他成员; the API cause is recorded for the backend (see verification) |

Audience, data permissions, publish semantics and widget queries are unchanged.

### Administrator workbench
| Problem | Change |
| --- | --- |
| The first screen was the admin's own follow-up summary; nothing said what the team needed | 团队待处理 first: follow-ups past due, tasks past due, members without today's report and today's completed items, from the same team-activity API as 团队动态. Each count links to 团队动态, and up to five members with the most overdue items are listed |
| Own follow-ups and tasks scattered | 今天要处理 (below) also appears on the admin workbench |

### Employee workbench (今天要处理)
| Problem | Change |
| --- | --- |
| Follow-ups, tasks and pending contacts in separate blocks with no sense of urgency | One agenda: counts for 已逾期 / 今日 / 未来7天 / 全部待办 at the top, follow-ups grouped by due bucket on the left, open tasks (top 5) and pending contacts on the right |
| Due times as bare dates | Due labels in the company time zone: 「已逾期 · 今天 10:00」, 「已逾期 3 天」, 「今天 20:30」, 「明天 18:00」, 「周二 15:00」, coloured danger / warning / neutral; the full date and weekday on hover |
| A busy-looking card even with nothing to do | One quiet line when there is nothing to handle |

### Follow-ups, tasks and daily reports
| Problem | Change |
| --- | --- |
| Dates, statuses and feedback differed per page | Shared `DueLabel` and `StatusTag` across follow-ups, tasks and the report reference; toasts after create, complete, cancel, reschedule and reassign; errors stay on the page with the request ID |
| Completing a follow-up recorded no result, and nothing said where to put it | After completion, a success note links to the record's 动态 to log the result (the follow-up API has no result field; see verification) |
| Cancelling a task happened in one click | Confirmation first |
| Task list had no 已取消 filter and no retry on failure | Both added |
| Daily report: unsaved edits lost on reload, switching date or leaving | Edits are kept in this browser while unsaved, and a newer local copy is offered back (恢复草稿 / 丢弃). Switching date or following an in-app link asks first, and reload or close triggers the browser prompt |
| Save state unclear | 「有未保存的修改（已暂存在本机）」 / 「已保存 · 10/24 16:44」 / 「还没有保存」; 保存日报 is disabled until something changes; a 409 offers 重新载入 |
| Another member's report could look editable | Read-only when the API says `canEdit: false` |
| Empty state on a record said 「从业务记录详情安排下一步」 even on the record itself | Says to use 安排跟进 above |

### Team activity
| Problem | Change |
| --- | --- |
| 16 metrics in one wide table, hard to compare | Category cards (沟通 / 客户 / 跟进待办 / 工作任务 / 日报 / 全部指标) with team totals; choosing one shows only its columns, with a bar in each cell scaled to that column's largest value |
| No way to see one member across all metrics | The member name opens a drawer: every metric with the member's value next to the team total, plus 安排任务 and 看日报 |
| Task filters ran off the screen on phones | Shared section header wraps its controls on phones |

All numbers come from the existing team-activity API with the same definitions.

### AI assistant
| Problem | Change |
| --- | --- |
| Long conversation lists could not be searched; rows had no time | Search by title and latest question, with a no-match line; each row shows its time (HH:mm today, otherwise the date) |
| Long answers ran the full panel width | Reading width capped at 76 characters |
| No way to copy an answer | 复制回答 on finished answers; if the browser refuses the clipboard, an inline message says so (it is not hidden) |
| Stopping needed the mouse | Esc stops generation; the input hint says 「Esc 停止生成」 while an answer is generating |
| Aggregate sources showed raw numbers (`1234567.5`) | Digit grouping (1,234,567.5) |

Kept: streaming output, stop, confirmation before execution, elapsed time, tool status with per-tool failures, retry and message anchors.

## Kept from phases 1–3

Member search pagination, permission descriptions, draft protection in the designers, message card spacing and icon fixes are untouched.
