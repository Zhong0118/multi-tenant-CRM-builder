# SDD ledger — plan: docs/superpowers/plans/2026-08-26-platform-business-template-designer.md

Spec: docs/superpowers/specs/2026-08-26-platform-business-template-designer-design.md
Start commit: bf4aeb5
Workspace: current checkout on main, explicitly approved by the accepted plan; no worktree created.

## Preflight rulings

Ruling: execute in the current checkout on `main` — the approved plan and HANDOFF explicitly require task commits on local main and forbid a worktree — cost if wrong: feature commits land directly on local main, but no push or deployment is allowed and every task remains separately revertible.

Ruling: omit duplicate full Web unit-suite runs in Tasks 6 and 8 — run their focused tests plus lint/typecheck, then run the complete suite once in Task 9 — cost if wrong: an unrelated Web regression may be discovered later at the final gate instead of immediately after those tasks.

Ruling: keep one task-scoped behavior test cycle and one review per task, with no extra smoke runs — this implements the user's explicit cost constraint while preserving the plan's critical safety checks — cost if wrong: lower-risk presentation regressions may wait until the final gate or manual acceptance.

Ruling: use `/Users/zhongxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm` for commands — Homebrew pnpm 11.22.0 hangs even for `--version`, while the bundled pnpm 11.19.0 matches `packageManager` and runs normally — cost if wrong: commands depend on the Codex bundled runtime path for this session.

Baseline: `object-publication.policy.spec.ts` passed (1 suite, 9 tests) with bundled pnpm 11.19.0.

## Preflight consistency scan

| Pair / task   | Producer → consumer or internal check                                                     | Finding                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Task 1        | Shared object configuration analysis remains behind existing object publication interface | Coherent; existing-record checks remain tenant-only.                                                |
| Task 2        | Prisma models, grants, RLS, immutable versions, and source FK                             | Coherent; raw SQL RED test avoids generated-client dependency.                                      |
| Task 3        | Template schema/policy consumes Task 1 shared rules                                       | Coherent; stable checksum and identity-lock rules are explicit.                                     |
| Task 4        | Lifecycle repository/HTTP consumes Tasks 2–3                                              | Coherent; Presenter owns derived lock facts and Web never diffs versions.                           |
| Task 5        | Web list/create consumes Task 4 generated contracts                                       | Coherent; no application endpoints required yet.                                                    |
| Task 6        | Editor consumes Tasks 4–5 and shared object presentation views                            | Coherent after canonical field permissions are serialized only through `employeeAccess.fields`.     |
| Task 7        | Application transaction consumes Tasks 2–4                                                | Coherent; fresh tenant IDs and empty-target check are load-bearing.                                 |
| Task 8        | Company UI consumes Tasks 5 and 7                                                         | Coherent; source company is chosen first and overwrite is never offered.                            |
| Task 9        | E2E and handoff consume all prior tasks                                                   | Coherent; complete suite is deferred here once, per user cost instruction.                          |
| Tasks 1 → 3   | `analyzeObjectConfiguration` / `compileObjectConfiguration`                               | Interface names and responsibilities match.                                                         |
| Tasks 2 → 4   | Prisma template rows → lifecycle repository                                               | JSON aggregate, optimistic version, and active version relations match.                             |
| Tasks 2 → 7   | Immutable version and source FK → application hydration                                   | Source version is retained and no object publication is created.                                    |
| Tasks 3 → 4   | Publication analysis/checksum → lifecycle publish                                         | Error and result types match.                                                                       |
| Tasks 4 → 5   | Generated lifecycle contracts → Web client/list/create                                    | Routes and pagination agree.                                                                        |
| Tasks 4 → 6   | Detail Presenter lock facts → editor view                                                 | `publishedCode`, `publishedFieldKey`, and `publishedType` are server-derived.                       |
| Tasks 4 → 7   | Module/DTO/contracts extended by application                                              | Same module owns lifecycle and application Controllers without a circular TenantsModule dependency. |
| Tasks 5 → 6   | `template-api.ts`, `template-types.ts`, CSS → editor                                      | Later task extends, rather than duplicates, feature boundaries.                                     |
| Tasks 5 → 8   | Template client/types/CSS → application UI                                                | Task 8 adds application methods and reuses published-template list query.                           |
| Tasks 7 → 8   | Business-configuration and application contracts → company UI                             | Summary reasons and response fields match.                                                          |
| Tasks 2 → 9   | Database integration file → final immutability/source proof                               | Task 9 extends the same real database test.                                                         |
| Tasks 7 → 9   | Application HTTP path → E2E                                                               | Request fields and 201 result agree.                                                                |
| Tasks 6/8 → 9 | Visible editor/application flows → browser acceptance                                     | Manual acceptance checks only behavior not covered economically by unit tests.                      |

Task 1: complete (commits bf4aeb5..395fee4, review clean; focused tests 2 suites / 11 tests)
Task 2: fix round 1/5 (2 addressed, 0 open — explicit SELECT/INSERT RLS policies and inactive-admin/application denial coverage; commits ff14c5b..c85a6ff)
Task 2: complete (commits 395fee4..c85a6ff, review clean; database integration 10 tests)
Task 3: complete (commits c85a6ff..ff6bc04, review clean; focused tests 2 suites / 5 tests)
Task 4: Ruling: allow the minimal type-narrowing fix in `apps/api/src/modules/objects/object-publication.policy.ts` — Task 4 contract generation exposed a load-bearing Task 1 compile error after null guards, and the protected-file rule does not cover this API file — cost if wrong: Task 4's diff includes one out-of-list shared-policy hunk, which its task review must judge.
Task 4: Ruling: the plan phrase “eight lifecycle paths” is a count typo — the approved surface has seven lifecycle operations and Task 7 owns application — cost if wrong: an expected lifecycle endpoint would remain deferred, but the specification and route table both enumerate the implemented seven.
Task 4: minor (deferred): whitespace-only names pass DTO validation before service trimming.
Task 4: minor (deferred): list application counts use one query per template row.
Task 4: minor (deferred): service tests do not directly cover pagination/filter/history ordering branches.
Task 4: fix round 1/5 (nullable-required DTO presence validation addressed; strict field-access enum remained open; commits 40df53e..ffe2af7)
Task 4: fix round 2/5 (strict string enum validation addressed; commits ffe2af7..8986285)
Task 4: complete (commits ff6bc04..8986285, review clean; focused DTO tests 8/8, API typecheck and contracts checks completed across implementation/fix rounds)
Task 5: Ruling: the documented `pnpm ... test:unit -- <files>` form did not filter Vitest and ran the existing 34-file Web suite once; subsequent Web checks must use `pnpm --filter @crm/web exec vitest run <files>` for exact targeting — cost if wrong: future tasks would repeat the full suite and violate the user's speed/usage constraint.
Task 5: fix round 1/5 (template code max-length parity and exact new-template breadcrumb addressed; commits 60cbf1a..0bb540d)
Task 5: complete (commits 8986285..0bb540d, review clean; exact fix verification 2 files / 3 tests, Web architecture/lint/typecheck passed across implementation/fix rounds)
Task 6: Ruling: defer the review's Minor items (true-404 routing, analysis request cancellation, dirty-leave confirmation, and field-error/reapply UX) until the final acceptance/next UX hardening slice — cost if wrong: uncommon navigation or overlapping-request cases remain less polished, but no publication/identity/data-loss invariant is knowingly left open.
Task 6: fix round 1/5 (eight Important publication/editor invariants addressed; two follow-on edges remained open; commits a30ebee..5667432)
Task 6: fix round 2/5 (dirty refresh retry preservation and ACTIVE-only permission snapshot addressed; commits 5667432..e8df9ee)
Task 6: complete (commits 0bb540d..e8df9ee, review clean; final scoped Web 12/12 and API policy 12/12 tests, Web/API typecheck passed; no full suite/smoke)
Task 7: fix round 1/5 (full-triple exact retry, post-lock concurrency retry, duplicate identity defenses, and UUID parameter validation addressed; commits 80d84cd..c34e1bb)
Task 7: complete (commits e8df9ee..c34e1bb, review clean; final focused 2 suites / 25 tests and API typecheck passed; no full/database/smoke)
Task 8: fix round 1/5 (immutable active-version preview, query failure recovery, pending-modal locking, and unified reset addressed; one selection error-state Minor remained; commits 2721a2a..ff26de1)
Task 8: fix round 2/5 (cross-template POST error state cleared; commits ff26de1..7a117a1)
Task 8: complete (commits c34e1bb..7a117a1, review clean; final exact component test 6/6, earlier focused 2 files / 13 tests and Web typecheck passed; no full/smoke)
Task 9: final review fix wave complete — six Important findings closed: idempotent same-draft publication plus database uniqueness, explicit nullable `defaultValue`, nested validation/config contracts and shared-policy defenses, leading-letter object codes across API/Web, five UUID route pipes, and unbounded applicable-template pagination. Focused final verification: API 5 suites / 47 tests, Web 2 files / 20 tests, database integration 10/10, contracts check, API/Web typecheck, affected lint/format/diff-check. Deferred Minors remain whitespace-only template names, template-list application-count N+1, and Ant Alert `message`; no full suite, full API E2E, browser, build, deploy, or push rerun.
