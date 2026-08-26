# Task 9 Report — Platform Business-Template Runtime Closure

## Delivered

- Added `apps/api/test/business-templates.e2e-spec.ts`, which drives the real HTTP stack against PostgreSQL from platform authorization through template create/save/publish/apply.
- The E2E verifies ordinary-user denial, template-code validation, a two-object/four-field aggregate, immutable version publication, DRAFT-only application, fresh tenant object IDs, complete field/view/permission hydration, source-version provenance, absence of object publications, and exact retry idempotency.
- Extended `packages/database/test/integration/business-templates.test.mjs` with direct runtime-role rejection of published-version configuration updates and a queryable `sourceTemplateVersionId` relationship for two generated tenant objects.
- The precise E2E RED exposed one product integration seam: API creation accepted a numeric-leading template code although the Web and design contract required a leading letter. `CreateBusinessTemplateDto` and the generated OpenAPI pattern now agree on `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
- The single full-repository gate exposed only closure defects in prior slice files: stale Prettier output, synchronous state derivation through a React effect, test-double lint errors, one nullable DOM test value, and an E2E that assumed the whole shared test database was empty. These received minimal non-feature fixes; the tenant summary test now asserts its own before/after delta so it composes with the preceding database integration gate.
- Updated `HANDOFF.md` and `docs/design/README.md` from observed local behavior. They do not claim template upgrades, relationship support, existing-object merging, production deployment, or a remote push.

## Focused TDD evidence

All package-manager invocations used:

```text
/Users/zhongxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
```

- The first sandboxed E2E attempt exited 1 with Prisma `EPERM` on the local database socket. This was an environment failure and was not counted as RED.
- The initial happy-path-only E2E passed, proving that the already implemented HTTP/application path itself had no missing integration seam.
- RED — `set -a && source .env && set +a && PATH=".../fallback:$PATH" .../fallback/pnpm --filter @crm/api test:e2e -- business-templates.e2e-spec.ts --runInBand`: exit 1. The numeric-leading code request expected 400 and received 201.
- Contract generation after the minimal DTO change — `.../fallback/pnpm contracts:generate`: exit 0.
- GREEN — the same focused E2E command: exit 0; 1 suite / 1 test.
- Focused database integration — `set -a && source .env && set +a && PATH=".../fallback:$PATH" .../fallback/pnpm --filter @crm/database test:integration`: exit 0; 10 tests.

## Browser acceptance

Acceptance used the installed Browser skill exactly as required: browser selection and full browser-client documentation first, then the localhost-capable in-app browser through the Node REPL. No standalone Playwright process or alternate browser MCP was used. Local API/Web services were stopped after acceptance, the viewport was restored, and key console-error reads were empty.

Observed evidence for the eight specification scenarios:

1. `/platform/templates` showed the real empty state `还没有业务模板`, one creation CTA, and no invented counters or rows. After creation it showed the real row and real values: 2 objects, v1, 1 application.
2. Creating `Task 9 验收 CRM` (`task9-acceptance-crm`) navigated to the editor; reopening the row returned to the same persisted template.
3. The editor persisted two objects (`客户/customers`, `商机/opportunities`), one title field per object, and exposed all four sections: 基本设置、字段、列表视图、员工权限.
4. Editing produced `有未保存变更` and disabled publishing; saving produced `草稿已保存` and enabled publishing.
5. Publication analysis reported 2 objects / 2 fields and `可以发布`; the first history was empty, publishing created v1, and the next saved label change showed both change analysis and history `v1 / from draft 2`.
6. After publication, object code, field key, and field type controls were disabled with visible identity-lock explanations.
7. An existing non-empty/active company displayed one object and `只有草稿状态的公司可以使用初始化模板`. A new DRAFT company previewed v1 and two objects with `将创建对象草稿，不会直接上线`; applying returned `已生成 2 个对象草稿`. After invitation acceptance and normal company activation, the tenant administrator saw exactly two object rows, both 草稿 and 未发布.
8. At 900×800 the editor displayed the desktop-only explanation requiring at least 1024px; at desktop width the real persisted data returned and no fake data appeared.

Authorization evidence: the platform administrator's direct attempts to enter an active workspace and the acceptance workspace redirected to `/waiting`; platform-admin status did not create tenant membership. The tenant administrator gained access only after accepting the invitation and company activation.

## Complete repository gate

The gate ran once in the required order. Failed commands were repaired and rerun individually; the sequence was not restarted and no extra smoke suite was added.

| Command                                                                                             | Exit / evidence                                                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `docker compose up -d`                                                                              | 0                                                                                                       |
| `docker compose -f compose.test.yaml up -d`                                                         | 0                                                                                                       |
| `set -a && source .env && set +a && .../fallback/pnpm --filter @crm/database prisma:migrate:deploy` | 0; 5 migrations, none pending                                                                           |
| `.../fallback/pnpm format:check`                                                                    | 1; 25 prior Task 3–8 files; exact-file Prettier write exited 0                                          |
| focused file check / second `format:check`                                                          | 1 for one remaining test file; exact-file write and single-file check exited 0                          |
| final `.../fallback/pnpm format:check`                                                              | 0                                                                                                       |
| first `.../fallback/pnpm lint`                                                                      | 1; React effect rule                                                                                    |
| focused Web tests after derived-selection fix                                                       | 0; Web 185 unit + 3 architecture tests                                                                  |
| second `.../fallback/pnpm lint`                                                                     | 1; 26 API test-double/import findings                                                                   |
| final `.../fallback/pnpm lint`                                                                      | 0                                                                                                       |
| first `.../fallback/pnpm typecheck`                                                                 | 2; one nullable DOM fixture                                                                             |
| final `.../fallback/pnpm typecheck`                                                                 | 0                                                                                                       |
| `.../fallback/pnpm test`                                                                            | 0; 399 tests total: API 196, Web 188, Worker 2, contracts 7, database schema 4, tenant-templates 2      |
| `set -a && source .env && set +a && .../fallback/pnpm --filter @crm/database test:integration`      | 0; 10 tests                                                                                             |
| first `set -a && source .env && set +a && .../fallback/pnpm --filter @crm/api test:e2e`             | 1; 1/8 failed because prior DB integration left its two intentional DRAFT fixtures                      |
| diagnostic invocation with an extra `--`                                                            | 1; Jest treated flags as a filename pattern and found no tests                                          |
| corrected serial/filtered diagnostics                                                               | test process exit 1, localized the old absolute-total assertion; the filtering pipeline itself exited 0 |
| final `set -a && source .env && set +a && .../fallback/pnpm --filter @crm/api test:e2e`             | 0; 7 suites / 8 tests                                                                                   |
| first `.../fallback/pnpm contracts:check`                                                           | 1; only the intended unstaged OpenAPI code-pattern delta                                                |
| exact `git add packages/contracts/openapi.json`, then `.../fallback/pnpm contracts:check`           | 0                                                                                                       |
| `.../fallback/pnpm build`                                                                           | 0; API, Web, Worker and all packages built                                                              |
| `set -a && source .env && set +a && .../fallback/pnpm --filter @crm/database prisma:validate`       | 0                                                                                                       |
| `git diff --check`                                                                                  | 0                                                                                                       |
| `git status --short`                                                                                | 0; intended closure files plus protected user state only                                                |

The focused DB test and the DB gate refer to the same 10-test integration command; it was intentionally run once during focused convergence and once at its required position in the sole full-repository gate.

## Protected workspace state

- `apps/web/src/app/(auth)/register/page.tsx` remains modified and unstaged; it was not edited, formatted, staged, or committed by Task 9.
- `chat会话.md`, `.claude/worktrees/`, and the five pre-existing untracked design documents remain untracked and unstaged.
- No `git add .`, reset, rebase, push, deploy, or remote mutation occurred.

## Scope boundary

This is local slice verification only. Template-version upgrades, existing-object merge/overwrite, object relationships, state machines, conversion actions, and production deployment remain outside the delivered scope.
