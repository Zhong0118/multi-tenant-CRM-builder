# Workspace UI foundation: UX audit (phase 1)

- **Baseline:** `origin/main` at `42e5974`. It already contains the #43 layout overhaul: shell, `Page`/`PageHeader`/`PageToolbar`/`SettingRow`, the record list and record page, settings and account pages. This phase builds on that structure rather than replacing it.
- **Scope:** design tokens and theme scope; shell and page layout patterns; the record list (density, columns, toolbar, preferences); member identity; and the record detail page.

## 1. Theme and tokens

| Area | Today | Problem | Change |
|---|---|---|---|
| Palette | One teal palette (`#167568`), declared twice: CSS variables in `globals.css` and AntD tokens in `providers.tsx`, both global | Success uses the same teal as the brand, so "selected", "primary" and "done" read alike. The login and register pages share the workspace palette, so any change leaks there | Blue enterprise palette scoped to the Workspace and Platform shells (`[data-ui="workspace"]`): CSS variables via `:root:has(...)`, so drawers and modals in portals follow, plus a nested AntD `ConfigProvider` with the same values. Login, register, landing and account pages keep their current look |
| Status colours | `success` = brand teal; warning amber; danger red | Green isn't available for "done / valid" | Separate green, amber, red and info-blue scales with soft backgrounds, each checked at ≥4.5:1 on white |
| Surfaces | Page `#f3f6f8`; sidebar `#eceef1`; most content white | Large white areas, weak separation between page, panel and control | Light blue-gray page, slightly deeper navigation, white work surfaces, a subtle-surface step for headers and rails |
| Shape | Controls 8px; reading and data panels 12px | One radius for very different elements | Controls 6px, panels 10px, overlays 12px, status 4px |
| Missing tokens | No spacing, shadow, motion or focus tokens; values repeated in modules | Inconsistent spacing and focus rings | `--space-*`, `--shadow-*`, `--motion-*`, `--ease-*`, `--focus-ring`, type-size tokens |
| Hard-coded colours | `#167568` / `#dceee9` in records, follow-ups and dashboard config CSS | Ignore the theme | Replaced with tokens |

## 2. Record list (`features/records/record-list.tsx`)

**Structure today:** `PageHeader` (title, count, ⋯, new) → view row (stage or scope segmented, saved views | search, "列") → condition row (owner, quality and three option quick filters, chips, 筛选 | 清除, 保存视图) → table **and** phone card list (both always rendered; CSS hides one) → sticky footer (total or bulk bar | page size, pagination).

| Problem | Evidence | Change |
|---|---|---|
| Only one reading mode | Every field column is `ellipsis: true`; notes, addresses and URLs are always cut to one line | Three densities — **紧凑** (one line), **舒适** (up to 3 lines, default), **完整** (full, keeps line breaks) — independent of column width, plus an optional per-column override |
| No way to read cut-off text without hover | `ellipsis` falls back to `title` tooltips only | Long values render as a focusable cell; Enter or tap opens one shared reader with the full text and a copy button |
| Field types all look alike | Money and numbers right-aligned, but dates, URLs, phones and multiselects share one rule | Per-type rendering: numbers and dates never wrap; URLs break safely; phone and email get copy; multiselect wraps (紧凑: `+N`); member shows avatar and name; empty shows `—`, distinct from `0` and `否` |
| Width rules are arbitrary | Default 160px (title 240px), clamp 72–640px for everything; `scroll.x = max-content` lets content decide table width | Per-type default, minimum and maximum widths; `tableLayout="fixed"` and an explicit scroll width from the column widths, so long content wraps instead of widening the table |
| Column settings are thin | "列" popover: checkboxes only. Order follows the order things were ticked | One **显示** panel: density, per-column visibility, move up/down, per-column density, restore defaults |
| Preferences not isolated per member | `crm.records.columns.{tenant}.{object}` and `crm.records.column-widths.{tenant}.{object}` have no member. Two accounts in one browser share them (owner visibility and saved views are already per member) | One versioned key per tenant, member and table. Legacy unscoped keys are **not** migrated (ownership can't be established); the per-member owner-visibility key is. Without a member id, preferences last only for the session |
| Re-render cost | Columns are rebuilt on every render; each search keystroke re-renders every row; table and cards are both in the DOM | Search input owns its own state; columns and cell renderers memoised; cards render only on narrow screens |
| Duplicate class | `.conditionRow` is defined twice in `record-list.module.css`, so the filter popover's rows inherit the toolbar row's border and padding | Popover rows get their own class |
| Raw member ids | A MEMBER value or owner whose member isn't in the roster renders the raw UUID (MEMBER field) or "已指定" | Shown as "其他成员", never an id (see §3) |

## 3. Member identity

- **Today:** names are plain strings from `displayName`.
- **Roster:** loaded for administrators only, and only `ACTIVE` members.
- **Disabled members:** owner cells show "已指定", and MEMBER fields show the raw id.
- **No avatars:** the API has no avatar URL, so every avatar is a text avatar.

**New `MemberIdentity`:**
- a stable colour derived from the member id;
- the first character of a Chinese name or the initial of a Latin name;
- the full name always shown beside the avatar;
- 未指定 for unassigned, and a "已停用" marker as text;
- 其他成员 when the member isn't visible to the viewer.

Used in the list owner column and MEMBER cells, the owner filter, the member pickers in record forms and filters, and the detail page.

**Roster change:** the administrator roster now also loads `DISABLED` members, to label them. Pickers still offer only active members.

**Backend dependency:** employees receive no roster, so they can't see colleagues' names on records they can read. This needs an employee-visible member directory endpoint. That's for the backend agent; the frontend does not guess names.

## 4. Record detail page

**Today:**
- a 48px top bar;
- a fixed 360px left sheet with ownership and **every field**, so long notes wrap in a narrow column;
- on the right, a highlights strip (repeats owner and update time) above six collapsible sections of equal weight: 跟进, 动态, 关联, 附件, 流程, 自动化;
- workflow actions sit in the fifth fold.

**Change:**
- Top bar: back to the table, title and `#no`, ‹ n/N ›, 编辑, ⋯.
- Main column (wide): the record's fields in a two-column grid, with long text spanning the full width. The edit form replaces this block in place, so editing gets the wide column.
- Activity (跟进, 动态, 关联, 附件, 自动化) in tabs below the fields. The chosen tab is remembered; relation and attachment counts stay on the tabs.
- Right rail: ownership, pool stage, deadlines and claim/release actions, then the workflow panel with current state and transitions.
- Below 1024px everything becomes one column: fields, ownership, workflow, activity.

**Preserved:** list context and ‹ › paging, unsaved-change handling in `RecordForm`, version-conflict messages, delete confirmation, and pool preview for records in the public pool.

## 5. Layout patterns

`Page` widths today: `full`, `settings` (1040px), `form` (720px), `bleed`. Adding:
- `reading`: detail and audit reading, up to 1280px;
- `editor`: complex configuration that may use the full desktop width.

Pages adopt these in their own phases. This phase only uses them where it already works: the list and the record page.

## 6. Out of this phase

- Settings, member directory and permissions: phase 2.
- Designers: phase 3.
- Dashboards, tasks and AI: phase 4.
- Platform pages, audit and account pages: phase 5.

Those pages pick up the new tokens automatically, but their layouts are not restructured here.
