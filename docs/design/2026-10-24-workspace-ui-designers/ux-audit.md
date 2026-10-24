# Business-table configuration and complex editors: UX audit (phase 3)

- **Baseline:** `origin/main` at `ece2926` (phases 1–2, server-side member directory from #52).
- **Scope:** the business-table designer (fields and forms, list display and search, employee defaults, publication and lifecycle), the workflow designer, cross-table automation and the relationships overview, and the workbench configurator.
- **Evidence:** `before/` and `after/` in this folder, from the real pages as admin 刘洋 on `crm_ui_designers`, a clone of the phase-2 test database.

## Inventory: configuration pages not covered in phase 2

| Page | Route | State before this phase |
| --- | --- | --- |
| Business-table designer | `/settings/objects/{id}` | Seven tabs in a 1040px column; blocked entirely below 768px |
| ・字段与表单 | tab | List + editor; nothing says the list order is the form order |
| ・列表展示与搜索 | tab | One long form; column order with 上移/下移 text buttons; no picture of the result |
| ・员工权限 | tab | Comparison table, then five stacked switches; column access only inside each field's editor |
| ・流程 | tab | Rows of inputs; no view of how states connect |
| ・跨表自动化 | tab | Rule cards (kept, see below) |
| ・发布记录 | tab | Only the current version, raw ISO time (`2026-09-22T08:28:02.136Z`); the API's full history was unused |
| Relationships overview | `/settings/relationships` | A list of rows; the details panel below has no visible link to the row |
| Workbench configurator | `/settings/dashboards/{code}` | One-column canvas even for 1/4-width components; filter controls unstyled; teal colours left from before phase 1 |

## What changes, and when it takes effect

Taken from the code and the API:

| Action | Changes | Employees see it |
| --- | --- | --- |
| Save in any designer section | The draft only | After the table is published |
| Publish (after the check) | Draft becomes v(n+1) | Immediately |
| Disable a table | Hidden from employees, read-only for admins; data kept | Immediately |
| Restore a table | Back to the version published before it was disabled; the draft is not published | Immediately |
| Member exception (phase 2) | One employee's access | Immediately, no publishing |
| Workbench: save draft / publish | Draft / new online version | After publishing |
| Workbench: name, audience, defaults, archive | Workbench metadata | Immediately |

## Findings and changes

### Designer shell
| Problem | Change |
| --- | --- |
| 1040px column for a complex editor | `editor` page width; a section rail on ≥1200px grouped 结构 / 权限 / 规则 / 发布, each with a one-line hint |
| Phones blocked ("请在桌面端完成") | Browsable on phones: tabs scroll, fields stack above the editor, a note says drag ordering and complex rules are easier on a computer |
| Only field edits were protected | Every section reports unsaved edits: a dot on the rail, 发布变更 disabled, a confirmation before switching section, before following an in-app link, and on reload or close |

### Fields and forms vs list display
| Problem | Change |
| --- | --- |
| Form order and column order look like the same thing | Field list: 「表单顺序：…表格的列顺序在 列表展示与搜索 中单独设置」; list section: 「这里的列顺序与表单顺序无关」 with a link back |
| List settings are a long form with no result to look at | Two columns: numbered column list with ↑↓ icon buttons (labelled), and a live header preview with sort and search summary beside search and sort controls |

### Employee defaults
| Problem | Change |
| --- | --- |
| Live, saved and edited values in different places | One matrix: 当前生效 vN · 已保存草稿 · 修改为, for table actions and every column; 未保存 / 待发布 marks per row |
| Column access only per field | Column access edited in the matrix too (saved with the table actions, same API) |
| Hiding the record-name column silently hides the table | Inline warning |

### Publish and disable
| Problem | Change |
| --- | --- |
| History shows only the current version, raw time | Every publication with local time, source draft revision and the fields it added, changed or retired |
| Disable/restore buried in 基本设置 | Moved to 发布与停用, beside the publication status and a table of what each action changes and when |
| Publish blockers name a key, not a place | Field label beside the key, 去修改 opens the right section (and field), 重新检查, and a note on why 确认发布 is disabled |

### Workflow
| Problem | Change |
| --- | --- |
| No view of states and transitions | Flow map: each state with the actions that leave it (起点 / 终点 marked); states nothing reaches, and non-terminal states with no way out, are flagged |
| Every transition's full editor always open | One-line summaries (route, roles, required fields, steps); one opens at a time, from the list or the map; a server error opens the transition it points at |
| Save left the section marked unsaved | Compared on what the form edits, not raw JSON (found during verification) |

### Automation and relationships
| Problem | Change |
| --- | --- |
| Map is a list of rows; details unrelated | Source table → numbered rules (①②③) → target table; a 规则说明 list with the same numbers: trigger, result, roles, field mappings; choosing either highlights both |
| No statement of what a run produces | 执行结果 line per rule (record created and linked, owner, once vs every confirmation), also on the rule cards in the designer |
| Fixed values shown as raw keys (「draft」) | Option labels (「拟定中」) |

### Workbench configurator
| Problem | Change |
| --- | --- |
| Canvas ignores widths | 4-column canvas following each component's saved width, with a sketch per type. A note says the published workbench currently lays components out by type and does not use width (see verification: known issues) |
| Tools crowd every card | Icon tools (labelled) shown on hover, focus or selection; always shown on touch screens |
| Library, canvas and properties order | Library left, canvas centre, properties right; stacked library → canvas → properties below 1120px; one column on phones |
| 筛选条件 unstyled | Styled filter rows |

## Kept as is

- All API calls and payloads, version checks, the draft / publish / disable / restore semantics, pool rules, automation semantics, workbench recovery drafts.
- The rule editor drawer and the field editor (their content), the per-record automation panel.
