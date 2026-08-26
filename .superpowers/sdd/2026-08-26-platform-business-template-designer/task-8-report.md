# Task 8 Report — Company Business-Configuration UI

## Delivered

- Company details now fetch the tenant and its business-configuration summary in parallel and render a `#business-configuration` section.
- Eligible draft companies can open an on-demand template selector that queries only templates with an active version. The selected template preview shows its current version, object count, and object names before confirmation.
- Confirmation submits the selected template ID with the detail response's current active version ID and the target tenant ID. Success renders the generated object names/codes and source version, and states that the company administrator must review and publish the drafts.
- Non-draft and non-empty companies have no application action and receive precise explanatory copy; no existing configuration is changed by this flow.
- New-company success now links directly to `/platform/tenants/:tenantId#business-configuration`.

## Verification

- RED: the exact focused Vitest command failed as expected because the application component and the business-configuration link were absent.
- GREEN: the same focused command passed: 2 files / 11 tests. The tests exercise the visible selection preview, draft-result ledger, blocked target explanations, and creation-result anchor link.
- Web typecheck initially exposed stale local compiled contract declarations from Task 7 although the generated source contracts already contained the application DTOs and paths. Rebuilding the local contracts package refreshed the ignored declarations; the single final Web typecheck passed.
- `git diff --check` passed.

## Residual risk

- Per the Task 8 cost boundary, no full Web suite, lint, browser smoke, or deployment ran. The platform-admin flow was not manually exercised against a live API in this task.
