# Phase 1 verification

**Environment**

- Local stack, with this branch on :3700/:3701 and unmodified `main` (`42e5974`) on :3710/:3711.
- Both stacks use `crm_ui_foundation`, a clone of the local dev database, so the shared dev data is untouched.
- Production builds (`next build` + `next start`) were used for timings and final screenshots.

**Test data (in the clone only)**

- Table "UI 验收表" (`ui-acceptance`) with all 12 field types, created and published through the admin API.
- Employee permissions: read ALL, update OWN, 邮箱 hidden, 预计金额 read-only.
- 1,000 records imported through the import endpoint, covering:
  - long Chinese and English names;
  - long URLs and multi-paragraph notes;
  - an unbroken contract string;
  - 0–7 tags each;
  - empty values, `0` and `false`.
- Owners and 跟进人 spread across members: two members named 周岚, a disabled member (郑凯), and 142 unassigned records.

## Acceptance checklist

| Scenario                                                                                                       | Admin 刘洋                                                               | Employee 孙悦                  |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| Widths 1440 / 1280 / 900 / 390: no page overflow                                                               | ✅ list and record page                                                  | ✅ list (1440)                 |
| 紧凑 / 舒适 / 完整 change the cells, not the column widths                                                     | ✅                                                                       | ✅ (紧凑)                      |
| Cut-off value: Enter opens the reader, Escape returns focus to the cell                                        | ✅                                                                       | —                              |
| Multiselect `+N` reader; badges never squeeze                                                                  | ✅                                                                       | ✅                             |
| Line breaks kept in notes (lost on `main`); long URL wraps inside its column                                   | ✅                                                                       | ✅                             |
| Drag resize (header and body together), saved per member; double-click reset; no sort triggered                | ✅                                                                       | —                              |
| Column visibility, order (↑↓), per-column density, restore defaults                                            | ✅                                                                       | ✅ (hidden 邮箱 never offered) |
| Preferences isolated per member in the same browser                                                            | ✅ separate keys; admin key unchanged after the employee changed density | ✅                             |
| Search, owner filter (identities, 已停用 marked), bulk selection bar, pagination                               | ✅                                                                       | owner filter correctly absent  |
| Return to list keeps the search; ‹ n / N › on the record page                                                  | ✅                                                                       | —                              |
| Edit in place; unsaved edits ask on cancel, back and paging; warn on unload                                    | ✅                                                                       | —                              |
| Members: avatar plus name; 未指定; 已停用; 我; 其他成员; no raw ids                                            | ✅                                                                       | ✅                             |
| Hidden field absent from list, panel and record page; read-only field marked 🔒                                | n/a                                                                      | ✅                             |
| Lead-pool table: stage tabs, stage tag tone, countdown on one line (rows 115 → 47px)                           | ✅                                                                       | —                              |
| Theme scoped: `/` and `/forgot-password` stay teal; workspace blue, also in portals                            | ✅                                                                       | ✅                             |
| Phone: cards (compact cells), wrapped footer, single-column record page in order fields → ownership → activity | ✅                                                                       | —                              |

## Performance (production build, 1,000-record table)

| Rows per page | DOM nodes (this branch / main) | Owner column toggle | Density switch |
| ------------- | ------------------------------ | ------------------- | -------------- |
| 20            | 2,310 / 2,336                  | 31ms / 60ms         | 42–47ms        |
| 100           | 7,545 / 8,464                  | 111ms / 148ms       | 129–140ms      |
| 1,000         | 66,353 / 77,357                | 1.25s / ~2.4s       | 1.09–1.23s     |

- Typing in search re-renders only the search box. The list re-renders once, after the 300ms pause.
- Rows have variable height; there is no virtual scrolling (none existed before).

## Automated checks

- `pnpm test:unit` (web): 990 / 990, run twice.
  - `template-editor.test.tsx` failed once in an earlier full run and passes alone, here and on `main`. It is not touched by this branch.
- Architecture tests: 3 / 3.
- `tsc --noEmit` and ESLint: clean on the changed areas.
- Prettier: clean on every changed file.
- `next build`: succeeds.

## Findings for the backend agent

1. **Import request size.** One `POST …/records/import` of 500 realistic rows (about 220 KB) returns 500 `INTERNAL_ERROR` "服务暂时不可用".
   - Cause: Nest's default 100 KB JSON body limit (`PayloadTooLargeError`), mapped to 500 by `ApiExceptionFilter`.
   - The import screen sends 500-row batches, so real spreadsheets can hit it.
   - Suggested fix: raise the limit for this route and map 413 to a clear message.
2. **`GET …/records/{id}/workflow` returns 409 when no workflow is published.**
   - The UI handles it (`WORKFLOW_NOT_PUBLISHED` renders nothing), but every record page logs a console error.
   - A 404 or an empty 200 would avoid it.
3. **No member directory for employees.**
   - Employees get no roster, so owners and member fields they can read show 其他成员 (or 我).
   - An employee-visible directory endpoint (id, display name, status) would let the UI show names.
4. **No per-record edit capability.**
   - With update scope OWN, the record page still offers 编辑 on other members' records. This is the same on `main`; the server rejects the save.
   - The record response has no "can update" flag, and mirroring the permission rule in the browser would duplicate authorisation.
   - Suggested fix: a per-record capability in the record response.

## Known limitations

- **No sticky table header.** AntD's sticky header splits the header into a separate `<table>`, which breaks header–cell association for screen readers. The footer (pagination and bulk bar) stays sticky.
- **Large pages.** At 1,000 rows per page, full-table changes take about 1.1–1.3s in a production build. Virtualisation is a candidate for a later phase.
- **Identical names** (two 周岚) differ only by avatar colour. The roster carries no employee number to show.
- **Platform admin pages** are not verified: no local super-admin account was available.
- **Later phases** (settings, designers, dashboards, platform): those pages pick up the blue theme, but their layouts are not restructured yet.
