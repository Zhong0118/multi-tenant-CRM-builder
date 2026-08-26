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

## Fix Round 1

- The preview and confirmation now use the same immutable current template version from `listVersions`. The draft detail is no longer read by this application flow; preview filters that version to active objects only.
- Template-list and selected-version failures now show formatted API details with request IDs and a retry action. A missing current version is also a stable retryable error rather than a silent disabled confirmation.
- While application is pending, the modal cannot close through its close control, mask, keyboard, or cancel button, and the template selector is disabled. Successful completion alone closes the modal.
- Modal completion and every user close share one reset path that clears errors, selected template state, and the related query cache before a later reopen.
- RED: the exact focused Vitest command found the old draft preview, missing failure state, and cancellable pending modal. GREEN: the same command passed 2 files / 13 tests. Web typecheck passed after the completed change.

## Fix Round 2

- Changing the selected template now immediately clears any prior application failure, including its request ID, before loading the newly selected template version.
- RED: the focused application test retained template A's failed request ID after switching to template B. GREEN: the same focused test file passed 6/6 tests after the selection handler cleared that error.
