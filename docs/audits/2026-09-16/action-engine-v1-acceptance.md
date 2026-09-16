# Action Engine V1 验收记录

日期：2026-09-16
分支：`feat/action-engine-v1`（worktree `.worktrees/action-engine-v1`），本轮提交区间 **`a01b6ae..ca9cf80`**。
功能代码的验收点为 `ca9cf80`。HEAD 以 `git log -1 --oneline` 为准，本文不硬编码单个 HEAD 值。

## Post-merge status

2026-09-16：PR #1 已合并进入 `main`。
Merge commit：`e590c23da6aa9c5fe0d0c3cd71250270ea265ebd`。
功能代码验收点仍为 `ca9cf80`；其后到 feature tip 的提交均为文档变更，因此原验收证据仍对应实际运行时代码。
未部署生产环境。

> 下文"Commits"与"Tests"等小节是**合并前**记录的验收事实，保留原样，不回填、不重算。文中出现的"未合并进 `main`"均属**当时的**历史状态，当前状态以上方 Post-merge status 为准。

本轮交付：Transition 的同步结构化业务动作 —— typed `actions[]`、严格 Draft Validator、Actions 冻结进 Object Publication、事务内 Action Engine（五类 Action）、Admin Action 设计器、员工静态确认、执行失败文案。
不在本轮范围：Trigger / Event / Automation / 异步 Worker / Outbox / 外部 I/O。

本文所有数字都来自本轮在区间末端提交上**实际重跑**的命令输出，或明确标注来源的任务报告；没有预测值。门禁的**完整七步序列**在提交本文档之前整体跑过一次（即 Tests 小节的第 0–6 步，全部 exit 0），其中第 0–4 步此前也单独跑过一次并得到同样结果。其后本文只产生 **Markdown 文档提交**，不改变任何代码文件。

---

## Commits

区间 `a01b6ae..ca9cf80` 共 **18 个提交**，79 个文件，`+20991 / -801`。

| Commit | 内容 | 对应任务 |
|---|---|---|
| `45fbaf4` | feat: validate typed workflow actions（严格 Draft Validator + 五类 Action 的 typed 校验） | Task 2 |
| `d438931` | feat: persist workflow transition actions（迁移 0018 + schema/DTO/repository） | Task 1 |
| `0296740` | feat: publish workflow action snapshots（Actions 冻结进 publication + legacy 兼容） | Task 3 |
| `d561bff` | refactor: add transaction-aware object access resolver（§46.3 action access resolver） | Task 4 |
| `145b42e` | refactor: extract transaction-aware record commands（`applyRecordPatch` / `applyTransition` 两意图分离） | Task 5 |
| `83b27d9` | refactor: extract transactional relation and follow-up commands | Task 6 |
| `ed4fd4f` | feat: add transactional action engine（五类 Action 的引擎本体） | Task 7 |
| `616d8e5` | feat: validate workflow actions at publication（跨对象 publish analyzer） | Task 8 |
| `40fc6a7` | feat: execute workflow actions atomically（runTransition 单事务串起来） | Task 9 |
| `fad8a31` | test: prove action engine atomicity and tenant safety（真实 PostgreSQL e2e，仅测试文件） | Task 10 |
| `02b08a1` | chore: generate action engine contracts（OpenAPI 与生成客户端） | Task 11 |
| `161ad8d` | fix: clear two pre-existing typecheck errors and make the effect label total | Task 17 blocker |
| `6d349a4` | feat: add workflow action designer（Admin 设计器） | Task 12 |
| `9597f4b` | feat: confirm workflow action effects（员工静态确认） | Task 13 |
| `c88bb50` | docs: activate Action Engine V1（BOUNDARY-16 + Roadmap 置 ACTIVE） | Task 14 |
| `8986587` | fix: use transition and action labels in action failure messages（§32 文案修复） | §32 follow-up |
| `43dc2fb` | chore: lint the action engine e2e spec（分支自有的新文件 lint 归零） | Task 17 |
| `ca9cf80` | fix: surface exhausted write-conflict retries as RECORD_VERSION_CONFLICT（重试耗尽不再裸 500） | Task 17 follow-up |

`main` 仍在 `a01b6ae`，未被本轮改动。

---

## Migration

`packages/database/prisma/migrations/0018_workflow_actions/migration.sql`：

```sql
ALTER TABLE "workflow_transition_definitions"
ADD COLUMN "actions" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "workflow_transition_definitions"
ADD CONSTRAINT "workflow_transition_definitions_actions_array"
CHECK (jsonb_typeof("actions") = 'array');
```

- **不新增表、不新增 RLS Policy、不新增 GRANT**，也没有 `ActionExecution` 表：改的是 0017 已带 tenant RLS 与 `crm_app` CRUD 权限的既有表。迁移文件自身的注释也写明了这一点。
- 应用命令（Task 1）：`DATABASE_ADMIN_URL="$TEST_DATABASE_ADMIN_URL" pnpm exec prisma migrate deploy`，输出 `The following migration(s) have been applied: migrations/ └─ 0018_workflow_actions/ └─ migration.sql`。
- 本轮我直接查 5433 复核（只读）：`_prisma_migrations` 中 `0018_workflow_actions` 已 applied；`workflow_transition_definitions.actions` = `jsonb`、`NO`（NOT NULL）、default `'[]'::jsonb`；约束 `workflow_transition_definitions_actions_array` = `CHECK ((jsonb_typeof(actions) = 'array'::text))`。
- 本轮**从未连接 5432**，因此 0018 在 5432 上的状态本文不作判断（台账记录它只被应用到 5433）。

---

## 已实现的 Action 类型

五类，均冻结进 publication 并由引擎在同一个事务里执行：

| Type | 语义 | 允许的 key |
|---|---|---|
| `CREATE_RECORD` | 在目标对象新建记录 | `key` `type` `targetObjectCode` `values` `owner` |
| `UPDATE_RECORD` | **只改 Source Record** | `key` `type` `target` `values` |
| `CREATE_RELATION` | 建立记录关联 | `key` `type` `left` `right` |
| `CREATE_FOLLOW_UP` | 新建待跟进事项 | `key` `type` `target` `title` `dueAt` `assignee` |
| `ASSIGN_OWNER` | Source Record 负责人 → 执行人 | `key` `type` `target` `owner` |

上限：每个 Transition 最多 20 个 Action；每个 `CREATE_RECORD` / `UPDATE_RECORD` 最多 50 条字段映射。
引用只允许 `SOURCE_RECORD` 或**前序** Action 的 `ACTION_OUTPUT`（`ActionRecordRef`）。

---

## 真实的事务架构（按代码实际形态记录）

1. **一个租户事务。** `WorkflowRuntimeService.runTransition` 通过 `this.records.withTenantTransaction(context, …)` 开**唯一**一个事务；`WorkflowRuntimeService.execute` 只是它外面的有界重试循环。Action Engine（`executeActions`）接收调用方传来的 `tx`，**自己从不开启、也不嵌套事务**。
2. **`RecordsStore.applyTransition` 是 Source Record 的唯一写入点。** 引擎不写 Source：它返回累积的 `sourcePatch`，由调用方在 `workflow-runtime.service.ts:264` 用**一次** `store.applyTransition(...)` 把「Source patch + 下一个 Workflow 状态 + `version + 1`」一起写掉。
3. **两个意图必须保持分离。** `applyTransition`（Transition 意图）**故意不加** ACTIVE-owner 锁；`applyRecordPatch`（普通更新意图）**会**先 `lockActiveOwners`。二者共用同一个 `applyPatchBody`（一次 `updateMany`，`expectedVersion` 守卫 + `version: { increment: 1 }` + 可选 history），差别只在锁。不锁是**重构前 `applyWorkflowTransition` 的既有行为**（离职交接不会改写每条记录，被停用负责人的记录仍必须能被管理员推进），不是新策略；`records.repository.ts:198-235` 与 `:566-604` 的注释明确要求**不要把两者合并回一个方法**。
4. **事务体内没有 `try/catch`。** `runTransition` 的函数体内没有任何捕获，任何 Action 失败都向外抛，整个事务回滚。
   **与 brief 表述的差异（据实记录）：** brief 说 “no `try/catch` in `execute`”。`ca9cf80` 之后 `execute` 里**确实有**一个 `try/catch`（`workflow-runtime.service.ts:130-166`），但它不是吞错：非写冲突（`!isWriteConflict(error)`，含所有 `ApiException`）**原样重抛且不重试**；只有写冲突落到下一次尝试；3 次用尽后映射为 `ApiException('RECORD_VERSION_CONFLICT', 409)`。原子性由第 3 点的单事务 + 无事务内捕获保证，与该循环无关。

---

## Tests（本轮实际重跑，区间末端提交）

命令顺序与输出：

| # | 命令 | 观察到的结果 |
|---|---|---|
| 0 | `pnpm --filter @crm/contracts --filter @crm/database build` | exit 0（`packages/contracts build: Done` / `packages/database build: Done`）。**必须先跑**：`packages/{contracts,database}/dist` 是 non-tracked 构建产物，否则 `apps/web` 会报 19 处 `TS2307`（Task 17 用移走/还原 `dist` 的可逆实验证明过），那是构建顺序产物，不是既有失败 |
| 1 | `pnpm typecheck` | **exit 0**，`Scope: 6 of 7 workspace projects`，6/6 `Done` |
| 2 | `pnpm contracts:check` | **exit 0**，生成后 `git diff --exit-code` 无漂移 |
| 3 | `pnpm test` | **exit 0**，见下表分 workspace 计数 |
| 4 | `pnpm build` | **exit 0**，`apps/web build: ✓ Compiled successfully`，6/6 `build: Done` |
| 5 | `pnpm --filter @crm/api test:e2e -- --runTestsByPath test/action-engine.e2e-spec.ts --forceExit` | **exit 0**，`Test Suites: 1 passed, 1 total` / `Tests: 9 passed, 9 total` |
| 6 | `pnpm --filter @crm/api test:e2e -- --runTestsByPath test/app.e2e-spec.ts --forceExit` | **exit 0**，`Test Suites: 1 passed, 1 total` / `Tests: 1 passed, 1 total` |

`pnpm test` 分 workspace（同一次运行）：

| Workspace | Runner | 结果 |
|---|---|---|
| `apps/api` | jest（unit，`rootDir: src`） | **69 suites / 902 tests passed** |
| `apps/web` | vitest + `node --test` | **66 files / 411 tests passed**，architecture `3/3` |
| `packages/contracts` | `node --test` | **8 / 8** |
| `packages/database` | `node --test` | **8 / 8** |
| `apps/worker` | vitest | **1 file / 2 tests passed** |
| `packages/tenant-templates` | `node --test` | **2 / 2** |

合计 **1336 个测试通过，0 失败**。

**`pnpm test` 不跑 e2e。** `apps/api` 的 unit jest 配置是 `rootDir: src` + `testRegex: .*\.spec\.ts$`，而 e2e 位于 `apps/api/test/*.e2e-spec.ts`，不被该正则匹配。所以上表第 5、6 步是独立且必须的，不能被第 3 步替代。

### 环境注意（本轮实测，供后续复跑参考）

首次重跑时我把根 `.env` 整体 `source` 并 export，于是 `NODE_ENV=development` 进入了环境。后果是可复现的：

- `apps/web` 的 `next build` 报 `⚠ You are using a non-standard "NODE_ENV" value`，随后 `Error occurred prerendering page "/_global-error"` / `TypeError: Cannot read properties of null (reading 'useContext')`，构建 exit 1；
- 同一次运行里 web 的 `template-application.test.tsx > keeps the modal open and selection locked while application is pending` 失败一次（断言 `getByRole("button", { name: "确认应用" })` 在按钮进入 `ant-btn-loading`、加载图标带 `role="img" aria-label="loading"` 时无法匹配）。

该失败是**可复现的，且成因就是 `NODE_ENV=development` 本身**：

| 环境 | 命令 | 结果 |
|---|---|---|
| `NODE_ENV=development` | 完整 `pnpm test` | web `1 failed \| 410 passed (411)`, exit 1 |
| `NODE_ENV=development` | `pnpm --filter @crm/web test:unit`（单独重跑） | 同一条测试再次失败，`1 failed \| 410 passed (411)`，exit 1 |
| `NODE_ENV` 未设置（vitest 默认） | 该测试文件单独跑 ×2 | **7/7 通过 ×2** |
| `NODE_ENV` 未设置 | 完整 `pnpm test` ×2 | **exit 0 ×2**（web 66 files / 411 tests） |
| `NODE_ENV` 未设置 | `pnpm build` | **exit 0** |

也就是说上面表里的绿色结果来自**没有 `NODE_ENV=development`** 的干净环境（只把 `DATABASE_URL` / `DATABASE_ADMIN_URL` 指向 5433）。该测试属于业务模板应用，与 Action Engine 无关，本轮没有改动它，也不是本分支的回归 —— 它是「用一个非标准 `NODE_ENV` 跑 Next/vitest」的产物。**后续复跑门禁时不要整体 `source` 根 `.env`**。

---

## Rollback 证明（All-or-Nothing）

两条独立证据：

### 1) Task 10 真实 PostgreSQL 套件（`action-engine.e2e-spec.ts`）

走真实 HTTP 路径 + 真实 `crm_app` 角色 + 真实表，断言读真实表：

- **T10a**：Transition 的后续 Action 失败 → 403 `ACTION_EXECUTION_FAILED`；`tasks=0, notes=0, relations=0, follow_ups=0`（都是该 actor **有** canCreate 权限的目标，所以零值可证伪）；Source 的 `{version,statusKey,title,ownerMemberId,data,deletedAt}` 与请求前逐字节相同；`record_transition_histories=0`；成功类 audit = `[]`。
  计数断言是**变异检验过的**：一个「吞掉 Action 失败但把事务提交掉、再回 403」的变异能通过状态断言，却在这条计数断言上以 `Expected: 0 / Received: 1` 失败（同一轮日志打出 `[T10a] counts tasks=1 notes=1 relations=1 followUps=1`）。
- **T10e**：Member Override 关掉目标对象 `canCreate` → 整条 Transition 回滚（对照臂 201 + 1 条回执；覆盖臂 403，回执仍为 1、follow-ups 0、Source 不变、history 0、audit 恰好等于对照臂的 3 条且同一个 execution id）。
- 失败事务**不留成功 Audit**：`successfulAudits()` 为空。

### 2) Task 16 真实浏览器走查（见下节）观察到

`0` 条 audit 行；`process-target-a` / `process-target-b` 记录数不变；`record_relations` 不变；`record_follow_ups` 不变；`record_transition_histories` 不变；Source 的 `data` / `status_key` / `version` 不变；**且 `record_counters.next_record_no` 也回滚**（两个目标对象都仍是 3，即被中止那次消耗的号段没有留下）。

---

## Permission 证明

- **Actor Permission 继承**：Action 用的是执行人自己的有效权限，没有 `runAsSystem` / `runAsAdmin` / 绕过权限的入口。目标对象的 schema 由 transaction-aware resolver（`resolvePublishedObjectInTransaction`）在**同一事务内**解析，且**故意不施加 `canRead` gate**（`canCreate=true, canRead=false` 的 create-only 目标是合法的），由具体 Domain Command 检查 `canCreate` / `canUpdate` / 字段权限。
- **Member Override 拒绝 → 整体回滚**：T10e（真实库）与 Task 16 浏览器（HTTP 403，全表无副作用）双向证明。Task 16 特意把覆盖放在**第 2 步**（`create-target-b`）上，所以第 1 步真的事务内执行过，属于真正的中途回滚；错误 `fieldErrors` 的键是 `actions.create-target-b`，与执行顺序一致。
- **`EMPLOYEE + ASSIGN_OWNER` 在 Publish 时被拦下**：`action-publication.policy.ts:199-216` 判定为权限不兼容（`流程动作「…」允许员工执行，但包含变更记录负责人的步骤；V1 不允许员工变更记录负责人。`）。Task 16 因此为员工单独建了去掉 `ASSIGN_OWNER` 的 6-Action 变体。
- **不可读 / 不可见 Source**：T10f（a）`canRead:false, readScope:'NONE'` → 403 `OBJECT_ACTION_FORBIDDEN`，无副作用；（b）OWN 范围内他人的记录 → 404 `RECORD_NOT_FOUND`，无写入。

---

## Concurrency 证明

- **同一条记录、同一个 `expectedVersion`**：两个并发 Transition → **恰好一个成功 + 一个 `RECORD_VERSION_CONFLICT`**（`[201,409]`），且只有**一份**下游数据（1 条记录、1 个 follow-up、1 行 history、version +1）。T10c 与 T10b-ii same-record 均如此。
- **真实 `40P01` 死锁被诱发并驱动了有界重试**：T10b-i 先证明该驱动栈上真实的 `40P01` 形态（`P2010`、`metaKeys=['driverAdapterError']`、无 `meta.code`、`cause.originalCode='40P01'`、`isWriteConflict=true`；同一栈上的真实 `42P01` 反例 → `false`），再用一个真实在服务的死锁证明重试把它消化成 HTTP 201 且只提交一次（blocker 的第二条语句 `granted`、`pg_stat_database.deadlocks` +1）。变异证据：把 `WORKFLOW_EXECUTE_ATTEMPTS` 改成 1，同一测试立刻回 500。
- **A/B 两条不同 Source 记录**：两条都合法提交（`[201,201]` 或 `[201,409]`），没有任何一次出现裸 500、也没有部分提交；该用例断言 `deadlocksAfter > deadlocksBefore`（真实死锁确实发生），因此不可能空跑通过。**两个不同 Source 记录本就应当都成功** —— 乐观锁守卫是**按 Source 记录**的，谁都没写对方的 Source。
- **重试耗尽不再裸 500**（`ca9cf80`）：3 次尝试全部输掉写冲突后抛 `ApiException('RECORD_VERSION_CONFLICT', 409)`（既有文案「该记录已被其他人修改，请刷新后重试。」），而不是把 `P2010/40P01` 当非 ApiException 抛成 500。RED/GREEN 是确定性的：在 `43dc2fb` 上必然复现裸 `Error: Raw query failed. Code: 40P01`。非冲突错误一律原样、不重试（`toBe` 身份断言覆盖 `ACTION_EXECUTION_FAILED`/400、`WORKFLOW_TRANSITION_FORBIDDEN`/403、`RECORD_NOT_FOUND`/404），并有「最后一次尝试胜出」测试证明只发生一次 version bump（7→8）、一行 history、一条 audit、一个 `workflowExecutionId`。
  **诚实的边界**：e2e 的 A/B 用例 10/10 绿且未走到耗尽分支（受害方的重试总是成功），所以确定性单元测试才是这条修复的真正证明。

---

## RLS 证明

对真实 PostgreSQL 证明（不是 fake 事务）：

- 只存在于**另一个租户**的对象 code：Transition 第 2 个 Action 目标它 → 404 `ACTION_EXECUTION_FAILED`，第 1 个 Action 已建的记录回滚，Source 不变，无 history，**且外部租户那张表的行数不变**（该断言先证明外部表里本来有 1 行，所以不是空表空跑）。
- **同名对象 code 在两个租户**：创建出来的行 `tenantId` 是本地租户，外部租户行数不变。
- 拿**外部租户的 recordId** 在本地对象上执行 → 404 `RECORD_NOT_FOUND`，外部记录逐字节不变。
- 以 `crm_app` 身份并设置 `app.tenant_id`：`count(*) FROM records` 只等于该租户的计数；跨租户 `UPDATE` 影响 0 行。

**重要发现（防守纵深）：** 从 `findPublishedObjectInTransaction` 里**删掉应用层租户谓词，测试依然全绿** —— 真正的兜底是 `object_definitions` 上的 RLS（`crm_app` 根本看不见外部行）。同样的变异对 `lockRecord` 的租户谓词也不变红，因为 `records` 的 RLS 以同一个 `TenantContext` 为键、record id 又是全局唯一 UUID，任何 RLS 可见行都不可能只违反应用层谓词。
结论写进代码注释而非隐藏：**不要把应用层谓词当作安全边界，RLS 才是；两者都保留**。也正因为如此，`T10d(3)` 无法单独隔离 Source 锁的租户谓词 —— 这是覆盖边界，不是可修复的缺陷。

---

## Browser Walkthrough（Task 16）

环境：`http://localhost:3000` + `http://localhost:3001`，API 与 Web 进程的 `DATABASE_URL`/`DATABASE_ADMIN_URL` 全部指向 **5433**（`ps eww` 实证）；5432 全程未接触，连只读都没有。演示租户 `nebula-demo`，管理员 `18800001001` 陈静，员工 `18800001007` 周岚（`NODE_ENV=development` + `DEV_VERIFICATION_CODE` 免短信登录）。

四项检查全部通过：

1. **成功**（7-Action `advance`，`draft → process`，TENANT_ADMIN）：两个目标记录各 1 条（标题来自 `SOURCE_FIELD` 映射，证明映射真的执行了）；2 条 `record_relations`；1 条 `record_follow_ups`（`OPEN`，负责人 = 陈静，due = 执行时刻）；Source `note: initial-note → updated-by-action-6`；`owner_member_id` 从 NULL 变成陈静（`ASSIGN_OWNER`）；`version: 1 → 2` **恰好一次**；`record_transition_histories` **恰好 1 行**；**8 条 audit 行共享同一个 `workflowExecutionId`**（2× `record.created`、2× `record.relation_added`、`follow_up.created`、`record.updated`、`record.owner_assigned`、`record.transition_executed`）。随后无 Action 的 `finish` 把记录推进到 `done`（v3，新增 1 行 history，没有多出任何下游数据）。
2. **回滚**：见 Rollback 小节第 2 条。
3. **员工路径**：6-Action 变体（去掉 `ASSIGN_OWNER`）的确认弹窗只列 **6** 条（`将当前记录分配给执行人` 正确缺席）；点「取消」**没有发出任何请求**（网络请求列表 + 数据库双向确认），数据库完全未变；点「确认执行」后 `owner_member_id` 仍为 **NULL**（缺席是真的，不是被悄悄替换），页面刷新到 v2/process。
4. **错误体验**：API 返回 403 `ACTION_EXECUTION_FAILED`，`message` = `无法完成“员工推进”：步骤“创建 1 条记录”失败。所有变更均未保存。`，UI 只渲染人类文案（不渲染 raw action key），`fieldErrors` 键为 `actions.create-target-b`。

**证据形态：没有截图文件。** `browser_take_screenshot` 报告成功，但磁盘上找不到产物（Playwright MCP 以自身 cwd 解析相对路径，在工作区、`$DSH_HOME`、`/tmp`、`$HOME/.dsh` 的有界搜索都没有）。因此上文每一条 UI 结论都建立在**无障碍树快照**（报告里逐字引用）之上，本文不引用任何截图。

---

## Deviations（偏差）

1. **`records.status_key` 复用为 `workflowStateKey`** —— 这是 Workflow V1 起就有的**正式决策**（用户确认方案 A），不是本轮新偏差。物理列 `records.status_key` / Prisma `statusKey` 不变，领域与 API 层叫 `workflowStateKey`。
2. **brief 的「relate A↔B」在 V1 表达不出来。** `ActionRecordRef` 只允许 `SOURCE_RECORD` 或前序 Action 的 `ACTION_OUTPUT`，所以一个 Action 永远引用不到**另一条既有记录**。Task 10 用文档化的 `SOURCE_OWNER` follow-up 负责人制造出等价的锁反转，而不是断言一件做不到的事。
3. **§40 的 `draft → process → done` 与「一次执行到 `state done` 且 version +1 恰好一次」互相不可同时满足**（三态链上，带 Action 的那次只能落在中间态）。Task 16 的处理：把 7-Action 的那次单独在全新记录上测量（version `1→2`，恰好 1 行 history），再用无 Action 的 `finish` 走到 `done`。这是 Spec 内部不一致，不是缺陷。
4. **§32 的字面文案「创建客户」在 V1 没有生产者。** 一个 Action 只携带 `key` / `type` / `payload`，**没有 `label`**（`label` 不在 `ACTION_ALLOWED_KEYS`，`git log --all` 也没有任何 ref 加过它），所以消息里用的是 §31 的**类型标签**「创建 1 条记录」。代码已经**优先**读 Action 上可能存在的 authored `label`（防御性），再退回类型标签，最后退回 raw key，所以「给 Action 加 authored label」将来是一个纯增量任务（types + validator + DTO + contracts + 设计器），**不需要改引擎**。当前输出安全、通用且诚实，记录为**文档化偏差，不是缺陷**。
5. **I1（relations 作用域解析顺序）接受为非回归。** 基线的 `add()` 已在 `withTenant` **之前**调用两次 `scope()`，每次各自开事务（3 事务/3 连接）；新代码把同样的解析挪进写事务内层，变成 4 连接 —— 是**顺序调整，不是新的嵌套事务类别**，客户端可见行为（400/403/404/201、audit、真实 PG e2e）完全一致。决定：接受，不为一条连接去churn 写路径。同时修掉了 `record-relation-command.ts` 里那句**与事实相反**的注释（它曾声称 resolveScope 在调用方事务内解析），因为后来者若照着写会把嵌套事务带进 Transition 事务、直接破坏 §4/§24。
6. **`WORKFLOW_ACTION_*` 结构化错误码取代 `WORKFLOW_INVALID_DRAFT`** 是可观察的行为变化（`publicationIssueCode()`），但目前 `apps/web` 没有映射这些码，仓库里唯一断言旧码的是草稿保存 API 测试。接受。

---

## Known Gaps

- **`requiredFieldKeys` 未按执行人的字段权限过滤**（`workflow-runtime.ts:215`）。**已由 Workflow Required Field Visibility Hardening（PR #2，`c8acbf1`）修复**：隐藏必填字段所属 Transition 对该 Actor 不可执行——GET 不返回它，direct execute 返回通用 `WORKFLOW_TRANSITION_FORBIDDEN` (403)。**勘误（2026-09-16）**：本条原写的理由是"Member Override 会在 publish 之后动态改变字段权限，publish 期 analyzer 无法完全预防"——**该理由不成立**。独立调查核实：`resolveEffectiveAccess()` 的 fields 映射读的是 `employeeAccess.fields`（`effective-access.ts:83`），**从不读 `objectPolicy.fields`**；`ObjectPermission` / `MemberObjectPolicy` 只有六个对象级字段，`FieldPermission` 按角色（`@@unique([tenantId, fieldId, subjectRole])`），**Member Override 没有字段维度**，结构上不可能改变字段可见性。真实原因是：**publish 期没有针对非标题字段的 required-vs-HIDDEN 规则**。同一类问题在**普通 records 写入路径**上也存在，已由 Record Required Field Visibility Hardening 修复（验收见 `docs/audits/2026-09-16/record-required-field-visibility-hardening.md`）；仍开放的 `action-engine.ts:631-655` 嵌套 `fieldErrors` 通道需单独任务。Task 11 新增的 `effects` / `executionSummary` 本身是干净的。
- **§27 的“可编辑 / 有效默认值”未真正实现**：只过滤了 required + 非空默认值 + 已映射三种情况。对某角色的 Transition 而言，一个实际 READ_ONLY/HIDDEN 的必填字段仍然会被要求映射 —— 映射它会得到 `PERMISSION_INCOMPATIBLE`，不映射则得到 `REQUIRED_MAPPING_MISSING`，**两种配法都发不出去**；此外任何非 null 默认值都被当作“有效”，缺 `defaultValue` 的旧快照也被当成有默认值。属「publish 说没问题 / runtime 会失败」的形状，值得单独复查。
- **六个结构性 `WORKFLOW_ACTION_*` 码没有 locator**（M72）：`object-publication.policy.ts:205-218` 对结构性非法的 actions 只返回**一条** `{code, message}`，把 validator 精确的 `transitions.N.actions.M.key` 路径丢掉了。**已核实为既有行为**（`ed4fd4f:186-192` 上同样的 `Object.values(fieldErrors).flat()[0]` 截断早于本特性存在），本特性只是让它更有后果（这些码现在有了独立 §34 code）。设计器若需要逐 action 定位，那是设计器的一次刻意改动。
- **`executionSummary` 目前没有消费者**（M85/M94/M98）：它按 §31 允许存在、有测试覆盖，但计划里的 Web 任务只消费 `effects`；OpenAPI 又把 `executionSummary` 标成可选，而 GET 永不返回它。属 YAGNI 可删的额外面。
- **5433 上留着两件测试残留，按指示保留：**
  1. 一个**孤儿用户**，手机号 `+8613911112222`，`memberships = 0` —— 是复现那条既有红灯 auth spec 的副作用。**它的 UUID 每次复现都会变**（该 spec 的 `beforeEach` 会先删掉这个手机号的用户、用例在 `:83` 失败后再把它留在库里）。同时留下 1 行该手机号的 `verification_challenges`。本轮复现该红灯后，库里仍是**恰好 1 个**这样的孤儿用户。
  2. 周岚（`+8618800001007`）在 `process-target-b` 上的 **Member Override `can_create=false`**（`can_read=true`、`can_update=true`）—— 为让回滚用例可复现而**刻意**保留。要还原：打开 `/workspace/nebula-demo/members/e4f8811a-cab4-4f2e-9492-7b7a2e4c48ba/access`，对 `process-target-b` 选「使用员工默认」并保存。
  其余 5433 状态是连贯的已发布验收夹具：租户 `nebula-demo`（ACTIVE）、4 个对象 `process-source` / `process-source-employee` / `process-target-a` / `process-target-b` **全部已发布**（本轮复核：`status=ACTIVE` 且 `active_publication_id` 非空）。
- **`pnpm test` 不跑 e2e 套件**（见 Tests 小节）。任何只跑 `pnpm test` 的绿色结论都不覆盖 e2e。
- **既有红灯，非本轮回归：(a)** `apps/api/test/auth.e2e-spec.ts:83` 期望 `GET /api/v1/me/sessions` 返回数组，而 controller 返回分页 `SessionPageResponseDto`。**本轮亲自复现**：exit 1，`Test Suites: 1 failed, 1 total` / `Tests: 1 failed, 1 passed, 2 total`，断言在 `auth.e2e-spec.ts:83` 失败，`Received has value: {"items": [...], "limit": 20, "page": 1, "total": 2}`。并已证明早于本特性：分支没有任何提交碰过 auth（`git diff a01b6ae HEAD -- apps/api/test/auth.e2e-spec.ts apps/api/src/modules/auth` 为空），`auth.controller.ts` 与 `a01b6ae` **逐字节相同**（`git diff --exit-code` 返回 0），且失败断言 `expect(sessions.body).toHaveLength(2)` 在 `a01b6ae` 的同名文件第 83 行就已存在。**(b)** 全仓 lint 仍是既有的 57 个 API 错误，而**本分支自己的文件是 lint 干净的**（Task 17 把分支新增的 `test/action-engine.e2e-spec.ts` 从 14 个错误清到 0；5 个被分支触碰的 lint 错误文件在 merge-base 上有 19 个错误、现在只有 15 个，分支没有新增 lint 债）。
- **A/B 场景的重试上界是 V1 接受的残余风险**：`WORKFLOW_EXECUTE_ATTEMPTS = 3`，一次运行里 3 次尝试中有 2 次自身被死锁回滚、第 3 次提交。`ca9cf80` 之后第 4 次也不会再裸 500（会得到 409 `RECORD_VERSION_CONFLICT`），但没有退避/抖动。未改上界。
- **确定性「耗尽重试」只由单元测试覆盖**，e2e 的 A/B 用例没走到（见 Concurrency 小节）。
- **未做**：双标签页 stale version 的浏览器冲突演示（`RECORD_VERSION_CONFLICT` 由 API/单元测试覆盖）；§40 的 Permission/Concurrency 子清单**没有在浏览器里**逐条走（它们由 Task 10 的真实 PostgreSQL 套件覆盖，见上文各节）。
- **未验证**：0018 在 5432（用户本地开发库）上的应用状态 —— 本轮从未连接 5432。

### 累积的 Minor findings

Task 1–17 的审查共累积 **100 条 Minor finding（M1–M100，其中 M72 以标题形式记录）**，全部保留在台账 `.superpowers/sdd/progress.md`，本文不逐条粘贴。按类别归纳：

| 类别 | 代表 | 性质 |
|---|---|---|
| 测试强度 / 覆盖盲区（断言共线、空跑可通过、只证结构） | M8、M13、M26、M29、M43、M46、M52、M57、M62、M67、M78、M99 | 不改变行为，但漏掉时不会变红 |
| 注释 / 报告与事实不符 | M2、M10、M25、M39、M44、M59、M71 附近的那条反事实注释 | 已被逐条纠正；本轮另修掉两处 |
| 重复常量 / DRY 漂移风险 | M1、M4、M15、M19、M36、M64、M68、M69 | 今天数值一致，将来会静默分叉 |
| 死代码 / 无消费者的面 | M3、M11、M34、M38、M80、M84、M85、M94、M98 | 可删或待接消费者 |
| 既有或仅对抗性可触发的边界 | M6、M9、M22、M23、M50、M60、M66、M70、M90 | 多数已核实早于本特性 |
| Web / UX 打磨 | M77、M87–M93、M96、M97、M100 | 设计器与弹窗细节 |
| 测试环境 / 夹具注记 | M41、M79、M82、M92、M95、M99 | 含 `pnpm … test:e2e -- <flags>` 会把额外 flag 当路径正则、可能意外跑全套 e2e 的坑 |

其中 **M26（read gate 覆盖共线）与 M51（Transition 意图仅结构性固定）** 被台账点名「最值得在收尾修复波次补」，本轮未做 —— 它们是**测试债**，不是行为缺陷。

---

## 未部署

已通过 PR #1 合并进 `main`，**未部署**。生产迁移、域名/HTTPS/Cookie 与短信供应商仍未就绪（见 `HANDOFF.md`）。
