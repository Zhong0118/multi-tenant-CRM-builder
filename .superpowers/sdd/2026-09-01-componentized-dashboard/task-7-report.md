# Task 7 report — published dashboard renderer

## Design pass

The runtime page is an operational surface for tenant administrators and employees: its single job is to make the active publication legible without adding CRM-specific interpretation.

- Tokens: graphite `#17232D`, action/marker teal `#167568`, page `#F3F6F8`, surface `#FFFFFF`, divider `#D8E0E5`; existing IBM Plex Sans/Noto Sans SC remain the reading faces and `data-numeric` preserves the mono numeric treatment.
- Layout: a restrained `PageHeader` leads with the configured dashboard title, the human-readable period, publication number/date, and only role-appropriate actions. A 12-column grid renders configured `QUARTER`, `HALF`, and `FULL` widgets in publication order; mobile reduces this to one column and tables retain horizontal scrolling.
- Signature: each widget has a precise teal left-edge publication/order marker. The rest of the surface is deliberately quiet: modest 6px widget corners, no gradients, no hero treatment, no decorative charts or invented deltas.

Second pass: the first layout draft risked turning the header into a generic status dashboard. I kept publication context in the existing compact status treatment instead, so configured component titles/results remain the page's visual priority.

## TDD evidence

RED: `apps/web/node_modules/.bin/vitest run 'src/app/(workspace)/workspace/[tenantCode]/workspace-home-view.test.tsx'` initially failed all three focused cases because the legacy workbench treated the V2 fixture as an unconfigured opportunity overview. The first failure was the missing configured dashboard title; unavailable-sibling and employee-not-enabled cases failed for the same old runtime boundary.

GREEN: the same focused test passes after introducing the shared renderer and replacing the opportunity-specific wrappers.

## Implementation

- Added `DashboardRenderer` with adapters for `METRIC`, `STATUS_DISTRIBUTION`, `TREND`, `LEADERBOARD`, and `RECORD_LIST`; empty and unavailable states stay inside their configured widget slots.
- Admin and employee workbenches are now thin header/action wrappers over the same renderer. The renderer only consumes configured labels, colors, widths, order, record values, and permission-filtered results.
- Added `objectCode` to the V2 runtime widget presentation/DTO/OpenAPI boundary. Record detail routes require the configured object code plus record id; supplying it from the publication is generic metadata, not inferred CRM behavior.
- Replaced the old opportunity-only UI helpers with generic chart/table/list rendering.
- The demo seed now persists a V2 draft and an active immutable V2 publication with five components bound to the already-seeded opportunity object/publication and its existing ten-member record set. Existing demo tenants update only when the draft/publication configuration differs, keeping subsequent seed runs idempotent.

## Checks

- Web focused unit tests (`workspace-home-view` + `dashboard-builder`): 14 passed.
- API focused dashboard suites: 28 passed.
- API and Web TypeScript checks: passed.
- Scoped Web/API ESLint and `git diff --check`: passed.
- OpenAPI JSON/client generation was rerun after the runtime `objectCode` contract addition.

## Concerns

- The browser test environment logs JSDOM's existing pseudo-element `getComputedStyle` notice while Ant Table mounts; the focused tests still pass.
- Superseded by the review fix below: Web runtime widgets now require the V2 object binding and never guess a record route.

## Review fix round 1

The runtime renderer now treats every configured status display as a distinct presentation of the same API result: `BAR` remains the compact horizontal list, `FUNNEL` is an ordered trapezoid stage layout sized from each returned value, and `DONUT` is an SVG ring with per-option API colors and a visible legend. Unknown option colors fall back to neutral gray rather than being injected into CSS.

The donut SVG exposes a title, description, accessible name, and its visible legend. Trend charts now have an explicit chart label plus a visually hidden data table containing the configured series title, every returned date, and its value. This preserves the concise visual while giving assistive technology the full result.

Web runtime widget types now require `objectCode` in every ready and unavailable variant, matching the existing V2 parser/DTO boundary. Record links therefore always use the configured object binding; the obsolete plain-text fallback is removed. No API engine, DTO, or generated-contract update was needed in this correction because current V2 runtime parsing already rejected a missing binding.

### Review-fix RED/GREEN and checks

- RED: the new focused UI assertions failed because `FUNNEL`/`DONUT` both rendered the generic bar list and `TREND` had no accessible data table. Parser rejection assertions were already green because the V2 parser was strict.
- GREEN: focused `workspace-home-view`, `dashboard-builder`, and `dashboard-types` tests pass (19 tests).
- Web TypeScript check, scoped ESLint, and `git diff --check` pass before the final commit.

## Review fix round 2 — signed distribution values

The renderer now preserves the engine result when a distribution is zero or negative. `BAR` has a real center baseline: positive magnitude extends right, negative magnitude extends left with a dashed treatment, and a zero mark has exactly zero width. `FUNNEL` uses magnitude for its stage width without a minimum floor; negative stages retain their signed numeric value and an explicit visible/accessibility negative marker, while zero stages have no colored width.

Donut is now limited to valid nonnegative part-to-whole data. Any negative input replaces the ring with `存在负值，无法按整体比例展示。` and the signed numeric option ledger. All-zero data keeps an empty neutral ring plus its zero-valued ledger. The ledger is the sole accessible representation of option values; the SVG describes only the visual state, so values are not announced twice.

RED: the focused workspace rendering test could not find a zero-width distribution mark in the old output. GREEN: the same runtime test passes with normal engine-shaped configured-option fixtures covering positive, zero, and negative BAR/FUNNEL values plus negative and all-zero DONUT cases. Web TypeScript, scoped ESLint, and diff hygiene pass before commit.
