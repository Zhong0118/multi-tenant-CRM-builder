# Engineering Gate Hardening — Acceptance

> 日期：2026-09-17
> 状态：COMPLETED
> 设计：`docs/superpowers/specs/2026-09-17-engineering-gate-hardening-design.md`
> PR A 计划：`docs/superpowers/plans/2026-09-17-critical-api-e2e-stabilization-implementation.md`
> PR B 计划：`docs/superpowers/plans/2026-09-17-critical-api-e2e-gate-promotion-implementation.md`

本文件记录 Hardening 的观察证据。下方 §1–§4 是 PR B 合入前已核实的事实，**不回填、不重算**。§5 为 post-merge 补记。

## 1. PR A — Critical API E2E Stabilization

| 项 | 值 |
| --- | --- |
| PR | https://github.com/Zhong0118/multi-tenant-CRM-builder/pull/11 |
| 合并提交 | `bc6cad2dd422d3c1b443faaed775ccda6f6a2f1e` |
| 功能 head | `a28bc729fc658b502c9381d625c8a38e572d1f3d` |
| Critical 测试数 | 5 |
| 三次干净库 | 同一 commit，fresh PostgreSQL `:55434`，`crm_app` / NOBYPASSRLS：5/5 × 3，约 1.1s/次 |
| Auth 漂移 | `GET /api/v1/me/sessions` 从数组断言改为 `{items,page,limit,total}`；Auth E2E 2/2 |
| CI / 保护 | PR A **未改** `.github/workflows/**`，**未改** branch protection |

PR A hosted run `35229734228`（五门 success）后 merge；`main` push run `35230094874` 五门 success。

## 2. Critical Suite Coverage

`apps/api/test/critical-api.e2e-spec.ts` 五个主题：

- Auth / Session：注册、登录、分页 sessions、revoke 后 401，不泄露 `tokenHash`
- Tenant / Workspace isolation：Tenant A actor 访问 Tenant B workspace → 403，B 数据不变
- Record CRUD / permission：OWN 可见自己、他人 404、hidden field 不出现、stale version 409
- Workflow Transition：`qualify` 成功，`recordVersion + 1`，history 含 `transitionKey`，stale reopen 409
- Action atomicity rollback：`CREATE_FOLLOW_UP` + 无 create 权限的 `CREATE_RECORD` → 403，follow-up / history / source 记录 / 成功审计均回滚

## 3. PR B — Hosted CI

| 项 | 值 |
| --- | --- |
| PR | https://github.com/Zhong0118/multi-tenant-CRM-builder/pull/12 |
| head | `9b93ea8` |
| run | `35231285009` |

| Check | Conclusion | 耗时 | Job |
| --- | --- | --- | --- |
| Typecheck | success | 44s | `105235733403` |
| Contracts | success | 38s | `105235733165` |
| Unit Tests | success | 2m25s | `105235733236` |
| Database Integration | success | 1m0s | `105235732590` |
| Build | success | 56s | `105235732992` |
| Critical API E2E | success | 52s | `105235733194` |

Critical job 日志观察：`Container ... Healthy` → `All migrations have been successfully applied.` → `Tests: 5 passed, 5 total` → `docker compose down -v` 删除卷。

## 4. Branch Protection

读回 `GET .../protection/required_status_checks`（Promote 后）：

```text
strict: true
contexts:
  Typecheck
  Contracts
  Unit Tests
  Database Integration
  Build
  Critical API E2E
```

每个 check 的 `app_id` 均为 GitHub Actions `15368`。

更广保护读回：

```text
protected = true
enforcement_level = everyone
enforce_admins.enabled = true
allow_force_pushes.enabled = false
allow_deletions.enabled = false
required_approving_review_count = 0
```

未放宽管理员强制、未打开强推/删分支。

## 5. Post-merge status

> 本节由合并后补记，**不回填、不重算**上方任何验收数据。

- PR B 已 squash 合入 `main`：`4eac32cb101c6500c189f684b61fa382223b38e7`（https://github.com/Zhong0118/multi-tenant-CRM-builder/pull/12）。
- `main` push run `35232613694` 六个 required job 均为 success：Typecheck / Contracts / Unit Tests / Database Integration / Build / Critical API E2E。
- 评论记录：https://github.com/Zhong0118/multi-tenant-CRM-builder/pull/12#issuecomment-5715953457
- Critical fixture 的 seed session `expiresAt` 随后从 `2026-10-17` 改为 `2099-12-31`（独立 test/docs PR），避免 required gate 在一个月后确定性变红。
- Engineering Gate Hardening **COMPLETED**。AI Assistant V1A 仍为 PLANNED。

## 6. Next Roadmap Stage

AI Assistant V1A remains PLANNED and is not auto-promoted.
