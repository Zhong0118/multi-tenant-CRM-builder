# Workflow V1 验收记录

日期：2026-09-15  
分支：`feat/workflow-v1`，已 push `origin/feat/workflow-v1`，未合并 `main`。  
`main` 功能基线仍是 `227e8d9`（其上可能有文档提交）。本分支 HEAD 以 `git log -1 --oneline` 为准，本文不硬编码。

本轮只交付 State + Transition + Manual Execution + History + Audit。没有 Action Engine、Automation、模板 Workflow、列表状态筛选或批量 Transition。

## Commits

| Commit | 内容 |
|---|---|
| `698a984` | schema / 0017 / RLS |
| `3310199` | Admin Draft API + validator |
| `1ea438c` | publication snapshot |
| `4d12877` | 新记录初始化 `statusKey` |
| `78b2dfd` | Runtime GET/POST + history + audit |
| `3848177` | Designer / Record UI + contracts |

后续可能还有 typecheck 夹具修复与本文档提交。

## Migration

- `packages/database/prisma/migrations/0017_workflow_state_machine/migration.sql`
- 本地 Homebrew PostgreSQL 5432 已 apply
- 独立测试库 `compose.test.yaml:5433` 本轮 Docker daemon 未开，未部署

## Tests

| 范围 | 结果 |
|---|---|
| API workflow 聚焦（admin/runtime/policy/publication/records/architecture） | 78 passed |
| Web workflow 聚焦（designer/panel/audit-labels） | 7 passed |
| Dashboard 夹具回归（为过 typecheck/build） | API 17 / Web 28 passed |
| `pnpm contracts:check` | 无 drift |
| `@crm/api` typecheck + build | 通过 |
| `@crm/web` typecheck + production build | 通过 |
| 全仓 `pnpm test` | 通过（API 55 suites / 433 tests；Web 65 files / 368 tests + architecture 3） |

已知既有 typecheck 错误（main 已存在，与 Workflow 无关）已用最小测试夹具修复，使 DoD 的 typecheck/build 可执行：

- `dashboards.repository.spec.ts` MONTH trend widget 交叉类型
- `dashboard-builder.test.tsx` `updateDashboard` 返回 `DashboardDraft`

## Browser Walkthrough

环境：`http://localhost:3000` + `http://localhost:3001`，演示公司 `nebula-demo`，管理员 `18800001001`。

新建独立对象 `workflow-check` /「流程验收表」，避免改演示商机的 `status_key`。

1. 对象设计器出现「流程」步骤。
2. 启用流程，添加状态「新建 / 赢单」，初始=新建，终态=赢单，动作「标记赢单」。
3. 保存后出现「流程配置已保存」。
4. 保存列表视图、员工权限后「发布变更」成功。
5. 新建记录「验收记录甲」进入详情：流程状态「新建」，按钮「标记赢单」。
6. 执行后状态「赢单」，版本 v2，历史「陈静 · 标记赢单 / 新建 → 赢单」，终态无后续按钮。
7. 员工 `18800001003` 访问 `/settings/objects` 为 404（不能进设计器）。
8. 补开该对象员工「可以查看 / 可以新建」并再发布后，员工导航出现「流程验收表」。
9. 员工新建「员工验收记录」进入「新建」，执行「标记赢单」后状态「赢单」、版本 v2、历史「赵晨 · 标记赢单」。

## Spec Deviations

1. 正式决策（不再是偏差）：数据库物理列复用 `records.status_key`，Prisma `statusKey`，领域/API 使用 `workflowStateKey`。用户确认方案 A。Boundary 与 Design 已改成同一表述。
2. Web 客户端在 contracts 生成前用 `relationRequest` 调新路径；contracts 随后已 regenerate。
3. 第一次发布时员工默认「可以查看」仍关着，所以员工导航没有该表。补开查看/新建并再发布后，员工 Runtime 与管理员一致。这是验收对象权限配置问题，不是 Workflow Runtime 缺入口。

## Known Gaps

- 独立测试库 `compose.test.yaml:5433`：收口时已 `docker compose -f compose.test.yaml up`，`prisma migrate deploy` 应用到 `0017`，`workflow-rls.test.mjs` 3 passed（租户隔离草稿、租户隔离 history、runtime 不能 update/delete history）。
- 员工账号执行 Transition 已在真实页面走通（赵晨 / 员工验收记录）。
- 未做双标签页 stale version 的浏览器冲突演示（API 单测覆盖 `RECORD_VERSION_CONFLICT`）。
- 演示主对象（线索/商机）未启用 Workflow。
- 已 push `origin/feat/workflow-v1`，未合并 `main`，未部署，未开始 Action Engine。
