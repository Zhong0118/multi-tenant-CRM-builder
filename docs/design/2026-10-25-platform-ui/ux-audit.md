# Platform management and wrap-up: UX audit (phase 5)

- **Baseline:** `origin/main` at `1a67aa0` (phases 1–4).
- **Scope:**
  - the 管理中心 (overview, companies, templates, operation records, 日志中心, system settings);
  - the company audit;
  - the account pages (workspace selection, waiting, invitations, account security);
  - not-found and error states across the app.
- **Evidence:** `before/` and `after/` in this folder. Screenshots come from the real pages on `crm_ui_platform`, a clone of the phase-4 test database, as the super administrator `admin`, company admin 刘洋 and employee 孙悦.

## Findings and changes

### Platform overview
| Problem | Change |
| --- | --- |
| Every count card had a coloured top edge, including 已暂停/已关闭 in red at 0 | Colour only when the count needs attention; zero stays neutral |
| 「0 家暂停公司 · 查看公司日志与暂停原因 →」 offered an action for nothing | Zero items read quietly (「没有暂停的公司」) and are not links |
| 「近期平台变更」 was a link with no content | Shows the latest real log entry (company, actor, action, time). If the log cannot be read, it says so; no placeholder figures |
| Recent companies table: separate code column | Name and code in one cell, as on the company list |

### Company list
| Problem | Change |
| --- | --- |
| Boxed search form with a status select that duplicated the status summary below it | One toolbar: status tabs with counts on the left, search on the right. Search keeps the status filter, and clearing the search keeps the status |
| Table scrolled sideways at 1440 (8 columns, `scroll.x` 1240) | 6 columns: 公司 (name + code), 状态, 公司管理员 (in-post count + first invitation), 业务配置, 下一步, 创建时间. Fits 1440 and 1280; scrolls inside its panel below that |
| First admin phone shown in full in the list | Masked (`139****5678`); the full number stays on the company detail, where the platform admin corrects it |
| 「首位管理员 未创建邀请」 next to 「活跃管理员 2」 | 「2 位在职 · 无邀请记录」 |
| Search with no results said only 「没有符合条件的公司」 | Names the keyword and offers switching to 全部 |

### Company detail
| Problem | Change |
| --- | --- |
| Setup rail showed 「邀请首位管理员：尚未发出邀请」 unchecked while 「管理员已接受（2 位）」 was checked (seeded company without an invitation row) | The step is complete when admins exist: 「已有公司管理员，无邀请记录」. Ledger says 「无邀请记录（已有在职管理员）」 |
| The business-table overview (10 rows) sat above the company facts and status actions | Facts and status actions first, the read-only table overview after them (its own text already pointed 「在上方暂停公司」) |
| An application from months ago still said 「请由公司管理员审核、调整并发布这些对象草稿」 | Earlier applications read as provenance: 「来源：模板 v1，生成了 6 张业务表草稿」. The full result appears only right after applying |
| Expired invitation: 重新邀请管理员 was a secondary button although it is the next step | Primary |
| Enabling, pausing or closing gave no confirmation once done | Toast 「公司已启用 / 已暂停 / 已关闭」; reason field cleared. Errors stay on the panel with the request ID |
| Unknown company ID showed the generic error page | In-shell 「页面不存在」 with 返回总览 |

### Templates
| Problem | Change |
| --- | --- |
| Status tags without meaning for companies; version in a separate column | Status plus one line saying what it means: 「公司可用 v2」, 「草稿有改动，公司可用 v1」, 「尚未发布，公司不可用」, 「不再提供给新公司」 |
| 对象数 only; 已应用公司 0 as a bare number | 「6 张业务表 · 30 个字段」; 「未应用」 / 「2 家」 |
| A pager with a single page | Hidden on one page; 「共 N 个模板」 otherwise |
| Editor header said 「v2 当前发布身份」 / 「尚无发布身份」 | 「公司可用 v2」 / 「尚未发布，公司不可用」 |
| **Bug:** leaving the template editor with unsaved tables or fields discarded them silently | The shared leave guard (as the daily report): 「放弃未保存的模板修改？」 with 继续编辑 / 放弃修改; the browser prompt on reload or close |

An empty template can still open 发布模板 to see its blocker; that behaviour is covered by an existing test and kept.

### Operation records (操作记录)
| Problem | Change |
| --- | --- |
| A notice panel repeated the description; 「标准销售流程 · V2」 with 「应用业务模板」 under it; antd green tag 已完成 | One sentence per row: 「应用「标准销售流程」v2」. The result column says 「已生成 · 6 张业务表草稿」, using the shared `StatusTag`. The API only records successful applications, so no other states are invented |

### 日志中心 (platform audit)
| Problem | Change |
| --- | --- |
| Native-select filter form with raw action codes, a code-heavy table, and a drawer that dumped `before` / `after` JSON | Same grammar as the company audit: entries grouped by day (今天 / 昨天 / date, Beijing time) read as sentences: actor, action, company · object · outcome (「待跟进 → 已完成」) |
| Filters as codes | Searchable 公司 select, 动作 and 对象 from the real facets with counts, 操作者类型, date range, 清除. Choosing a company resets the action and object filters to that company's facets |
| Detail | Facts: 操作者 (name · type), full time, 公司, 对象 (label + copyable full ID), 原因 (「未填写」 when empty), copyable 请求编号, IP. A changes table with readable field names and values: statuses, roles, times, short IDs. It reads 「创建时的内容」 for creations and 「删除前的内容」 for deletions. The complete stored JSON stays under 原始数据 |
| Labels | 仪表盘 → 工作台, 跟进任务 → 跟进待办, matching the product |

### Company audit
| Problem | Change |
| --- | --- |
| System keys showed raw: `status OPEN → DONE` | The same readable form as the platform audit: 「状态 待跟进 → 已完成」, times in the company time zone. Business fields labelled by the server are shown as stored |
| **Bug:** at 390 the chevron of every entry dropped onto its own line (antd's icon display beat the hiding rule) | Fixed in the shared stylesheet; applies to both audits |

### System settings
| Problem | Change |
| --- | --- |
| Four large service cards, a policy panel and a notes panel. Nothing said whether anything here can be changed | Marked 只读, and the header says why: services come from the server environment, policies ship with the release. 运行状态 is a list with the check time (Beijing time), the environment, and 「N 项需要留意」 / 「全部就绪」. 账号与数据保留 is a two-column list. The notes panel is gone |

### Account pages
| Problem | Change |
| --- | --- |
| Workspace selection, waiting, invitations and security rendered in the old teal palette with a 「C」 mark | Same theme, toasts context and reduced-motion rule as the app: `WorkspaceThemeScope`. Brand mark 百杰 CRM |
| A platform admin with no company had no way back to the 管理中心 | 管理中心 in the account bar. The empty workspace list explains the account and offers 进入管理中心 |
| Empty workspace list was an info alert linking 「返回等待页」 | A state panel: what happens next, and 查看公司邀请 |
| Invitation tags in gold / cyan antd colours | Shared `StatusTag` (待接受 warning, 已接受 success, others neutral), and the expiry date on each card |
| Declining an invitation happened in one click | Confirmation (「拒绝后不能再接受」), then a link back to the invitations |
| Unavailable invitation was a warning alert with no way out | Blocked state panel with 查看我的邀请 |
| Login-history read failure appeared at the top of the page, with no retry | Shown above the history with 重试 for the same page. Revoking a session is a toast; the password-change result stays as an alert, because it says other devices were signed out |

### Not-found, no permission and failures
| Problem | Change |
| --- | --- |
| A signed-in member opening a page their role cannot see, or a missing record, got a bare 404 outside the app with 「返回登录」 | Inside the workspace and the 管理中心 the navigation stays. The panel says 「页面不存在，或你没有访问权限」 (the API answers 404 for both, so it names both) with 返回工作台 / 返回总览. Unknown addresses under those paths do the same |
| **Bug:** an employee opening 公司审计 got 「页面没有加载成功」 (the API's 403 was thrown as a load failure) | 「仅公司管理员可查看公司审计」 with 返回工作台, from the member's role; members uses the same panel (`RouteForbidden`) instead of antd's 403 illustration |
| A failed load inside a section showed the app-wide error page; 重新加载 re-rendered without re-reading data | Section error panel with 重试 (re-reads server data) and the error number. The app-wide page also re-reads now |
| Root 404 offered only 「返回登录」 | 我的工作区 and 返回首页 |

### Consistency
- **Status:** `StatusTag` everywhere I touched; antd colour tags removed from the platform and account pages.
- **Feedback:** success is a toast; errors stay where they happened, with the request ID.
- **Focus:** one global `:focus-visible` outline. Drawers return focus to the entry that opened them.
- **Reduced motion:** the existing workspace rule now covers the account pages too.
- **Dates on the platform:** Beijing time on both server and browser, so no hydration drift.

## Kept from phases 1–4
The following code is untouched, and each feature was rechecked as company admin:
- member search pagination;
- business-table and field permissions;
- disable and restore;
- public pool;
- cross-table automation;
- message spacing;
- list wrapping and pagination;
- workbench order and widths;
- daily-report drafts and version-conflict protection;
- AI precision and failure feedback.

See `verification.md`.
