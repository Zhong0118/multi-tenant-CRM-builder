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
- Runtime result types retain optional `objectCode` for legacy executor/test compatibility, while all current V2 engine/DTO output now provides it. The record-list adapter intentionally renders plain text rather than guessing a route if an old response lacks that metadata.
