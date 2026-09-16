# Workflow Required Field Visibility Hardening — Acceptance

> 日期：2026-09-16
> 类型：Action Engine V1 合并后的 bounded security hardening（非新功能）
> 设计：`docs/superpowers/specs/2026-09-16-workflow-required-field-visibility-hardening-design.md`
> 计划：`docs/superpowers/plans/2026-09-16-workflow-required-field-visibility-hardening.md`

本文件只记录本轮**实际观察到的**事实。所有命令都在
`.worktrees/workflow-required-field-visibility` 内执行。

## 1. 基线与提交

| 项 | 值 |
| --- | --- |
| 分支 | `fix/workflow-required-field-visibility` |
| 基线 | `df9b2696602a89a5898d161c0ba04771594092c1`（`df9b269`，即含 PR #1 的 `main`） |
| 修复提交 | `c8acbf17558a2ccc4418fc2836a51d76cd441487`（`c8acbf1`）`fix: hide inaccessible workflow required fields` |
| 文档提交 | 见本文件所在提交 `docs: record workflow field visibility hardening` |

未 reset / rebase / force-push / push / 建 PR / 部署。

## 2. 被修复的问题

`runtimeWorkflowView()` 的 `availableTransitions()` 原样返回
`transition.requiredFieldKeys`，`assertRequiredFields()` 又把 `HIDDEN` 字段当作
missing 继续构造 `fieldErrors[fieldKey]` 与带字段 label 的 message。因此一个
required field 对当前 Actor 是 `HIDDEN` 的 Transition，仍然会把该字段的 key
（GET）以及 key + label（direct POST）发给客户端 —— 字段权限的 metadata
side channel。

`access.fields` 中**不存在**的 key 同样走这条泄露路径（`?? 'HIDDEN'` 只影响
是否计入 missing，不影响是否返回）。

## 3. 实施的精确运行时规则

> 若当前 Actor 对某个 Transition 的任一 `requiredFieldKey` 是 `HIDDEN`，
> 或该 key 不存在于 `access.fields`，则**整个 Transition 对该 Actor 不可执行**。

- **GET** `runtimeWorkflowView()`：该 Transition 完全不出现于
  `availableTransitions`（不是只把 key 从 `requiredFieldKeys` 里删掉）。
- **Direct execute** `resolveExecutableTransition()`：在 `allowedRoles` 检查之后、
  `assertRequiredFields(...)` 之前抛出 `ApiException('WORKFLOW_TRANSITION_FORBIDDEN', 403)`
  —— 与「角色不允许」使用同一个通用错误码，不带 fieldKey、不带 label、
  不带 `fieldErrors`、不带 hidden field 计数，也不新增会暴露原因的错误码。
- `access.fields` 中**不存在**该 key：判定为 `HIDDEN`（fail closed）。缺失必须是
  own-property 缺失（`!Object.hasOwn(access.fields, fieldKey)`），不能写成
  `access.fields[fieldKey] ?? 'HIDDEN'` —— 后者对 `constructor` / `__proto__` /
  `toString` 会取到 `Object.prototype` 的继承成员，把缺失判成可见（本轮补丁，
  见 §4.1）。
- 可见 required field（`EDIT` / `READ_ONLY`）为空时，行为**完全不变**：
  仍是 `WORKFLOW_REQUIRED_FIELDS_MISSING`（400），仍带 `fieldErrors.<fieldKey>`
  与人类 label。
- `__start__` 合成 Transition 不受影响（`requiredFieldKeys: []`）。
- Tenant Admin 不回归（其 `access.fields` 由 `resolveEffectiveAccess()` 全部给 `EDIT`）。
- Member Override 模型不变：判断只依赖 `EffectiveObjectAccess.fields`。

GET 与 POST 复用同一个模块私有谓词，避免读写规则漂移：

```ts
function hasHiddenRequiredFields(
  transition: Pick<PublishedWorkflowTransition, 'requiredFieldKeys'>,
  access: EffectiveObjectAccess,
): boolean {
  return transition.requiredFieldKeys.some(
    (fieldKey) =>
      !Object.hasOwn(access.fields, fieldKey) ||
      access.fields[fieldKey] === 'HIDDEN',
  );
}
```

（上面的表达式是**本轮补丁后**的当前实现；`c8acbf1` 当时写的是
`(access.fields[fieldKey] ?? 'HIDDEN') === 'HIDDEN'`，对 prototype 名不 fail
closed，已在 §4.1 修正。）

`assertRequiredFields()` 的 `HIDDEN` 分支按计划保留（最小 diff），对合法调用者
已不可达；它上面新增的授权 guard 才是本轮的修复点。

## 4. 改动文件

本分支（`main` → HEAD）的完整改动集是 4 个文件：

```text
HANDOFF.md
apps/api/src/modules/workflows/workflow-runtime.spec.ts
apps/api/src/modules/workflows/workflow-runtime.ts
docs/audits/2026-09-16-workflow-required-field-visibility-hardening.md
```

其中**只有代码提交** `c8acbf1`（`fix: hide inaccessible workflow required fields`）
改动 2 个文件：

```text
apps/api/src/modules/workflows/workflow-runtime.spec.ts
apps/api/src/modules/workflows/workflow-runtime.ts
```

其余 2 个文件（`HANDOFF.md` 与本验收文档）来自 `dfe568c`
（`docs: record workflow field visibility hardening`）与本节下面的补丁轮。

没有 `packages/contracts/**`、`packages/database/**`、`apps/web/**` 改动。
没有迁移、没有 Prisma schema 改动、没有 contracts 重新生成。Runtime DTO 形状
不变（`availableTransitions[].requiredFieldKeys: string[]`），只是服务端保证
其中只可能出现当前 Actor 可见的 key。

### 4.1 独立评审后的补丁轮（本轮）

独立评审（`.superpowers/sdd/hardening-review.md`）的 4 条具体缺陷已在本轮修复，
改动仍限于上面 4 个路径：

1. **prototype 名 fail-closed（the real bug）**：谓词
   `(access.fields[fieldKey] ?? 'HIDDEN') === 'HIDDEN'` 对 `constructor` /
   `__proto__` / `toString` 这类 key 会取到 `Object.prototype` 的**继承**成员
   （既不是 `null` 也不是 `undefined`），于是把「不在 `access.fields` 中」的
   key 判成可见，与 §8 相矛盾。改为 own-property 判断：
   `!Object.hasOwn(access.fields, fieldKey) || access.fields[fieldKey] === 'HIDDEN'`，
   并在 helper 上写明「不要简化回 `??`」的原因。
2. **删除一条无牙断言**：§5 GET 测试里
   `expect(body).not.toContain(HIDDEN_FIELD_LABEL)` 无论实现如何都不可能失败
   （`RuntimeWorkflowView` 从不含字段 label），已删除；保留
   `expect(body).not.toContain('"secret"')` 这条强断言。
3. **补 3 条测试**（原计划 2 条 + prototype 用例）：
   空 `requiredFieldKeys: []` 仍被返回且可执行；`READ_ONLY` 必填字段缺值时
   仍返回该 Transition 且 direct execute 仍抛
   `WORKFLOW_REQUIRED_FIELDS_MISSING`（400，`fieldErrors` 含该字段）；
   `requiredFieldKeys: ['constructor']` 按 §8 判为 HIDDEN。

**RED / GREEN（真实输出）**：把谓词单独 `git stash` 回 `dfe568c` 的旧表达式后，
原型用例失败；恢复后通过。两次运行的命令与结果：

```bash
pnpm --filter @crm/api test -- workflow-runtime.spec -t "prototype name"
```

```text
# 旧谓词（`?? 'HIDDEN'`）
  ● workflow runtime required field visibility (§4–§8) › treats a required prototype name absent from access.fields as HIDDEN (§8)
    Expected value: not "prototype-transition"
    Received array:     ["visible-transition", "prototype-transition", "empty-transition"]
Test Suites: 1 failed, 68 passed, 69 total
Tests:       1 failed, 909 passed, 910 total

# 恢复修复后（同一条命令）
Test Suites: 69 passed, 69 total
Tests:       910 passed, 910 total
```

（该命令的 `-t` 过滤在 pnpm 下未生效，因此实际跑的是整个 `@crm/api` 测试集；
两次运行的差值正好是这一条新测试。）

补丁轮后的聚焦计数：

```bash
pnpm --filter @crm/api test -- workflow-runtime
```

```text
Test Suites: 2 passed, 2 total
Tests:       54 passed, 54 total
```

分套件实测：`workflow-runtime.spec.ts` 20（上轮 17 + 本轮新增 3 条：prototype、
空必填、READ_ONLY），`workflow-runtime.service.spec.ts` 34。上轮基线 51，
本轮 +3 = 54。

## 5. TDD 过程（RED → GREEN，真实输出）

### 5.1 RED（先写测试，未改实现）

命令：

```bash
pnpm --filter @crm/api test -- workflow-runtime.spec
```

结果：`Test Suites: 1 failed, 1 total` / `Tests: 4 failed, 13 passed, 17 total`。
新增 5 条测试中 4 条失败，失败的**原因都是「当前实现仍在返回/泄露该
Transition」**，不是类型错误、不是符号缺失（编译通过，测试跑起来了）：

```text
  workflow runtime required field visibility (§4–§8)
    ✕ omits a whole transition whose required field is HIDDEN, without leaking key or label (§5) (1 ms)
    ✕ refuses a direct execute of a HIDDEN required field with a generic 403 (§6) (1 ms)
    ✕ treats a required key missing from access.fields as HIDDEN (§8)
    ✓ keeps the missing-value error for a visible required field (§7)
    ✕ does not regress a tenant admin whose fields are all editable (§13) (1 ms)

  ● ... › omits a whole transition whose required field is HIDDEN, without leaking key or label (§5)
    Expected value: not "hidden-transition"
    Received array:     ["visible-transition", "hidden-transition", "legacy-transition"]

  ● ... › refuses a direct execute of a HIDDEN required field with a generic 403 (§6)
    Expected: "WORKFLOW_TRANSITION_FORBIDDEN"
    Received: "WORKFLOW_REQUIRED_FIELDS_MISSING"

  ● ... › treats a required key missing from access.fields as HIDDEN (§8)
    Expected value: not "legacy-transition"
    Received array:     ["visible-transition", "hidden-transition", "legacy-transition"]

  ● ... › does not regress a tenant admin whose fields are all editable (§13)
    Expected value: not "legacy-transition"
    Received array:     ["visible-transition", "hidden-transition", "legacy-transition"]
```

即：GET 仍把 hidden/unknown Transition 直接返回；direct POST 抛的是
`WORKFLOW_REQUIRED_FIELDS_MISSING`（400，带 `fieldErrors` 与 hidden label），
而不是通用 403。可见字段那条回归测试在修复前就已经是绿的 —— 它守卫的是
「不要顺手改坏 §7」。

### 5.2 GREEN（实现之后）

```bash
pnpm --filter @crm/api test -- workflow-runtime
```

```text
PASS src/modules/workflows/workflow-runtime.spec.ts
PASS src/modules/workflows/workflow-runtime.service.spec.ts

Test Suites: 2 passed, 2 total
Tests:       51 passed, 51 total
Snapshots:   0 total
Time:        0.336 s, estimated 1 s
```

基线（改动前，同一命令）：`2 passed / 46 passed`。差值 5 = 本轮新增测试数。
分套件实测：`workflow-runtime.spec.ts` 17（原 12 + 新增 5），
`workflow-runtime.service.spec.ts` 34。

### 5.3 覆盖的五个用例

| 用例 | 断言 |
| --- | --- |
| GET projection（§5） | `visible-transition` 仍在且 `requiredFieldKeys` 仍是 `['amount']`；`hidden-transition` 整个不在；序列化 body 不含 `"secret"`（原先还有一条 `内部评级` label 断言，实测无论如何都不可能失败，本轮已删除，见 §4.1） |
| Direct execute（§6） | `WORKFLOW_TRANSITION_FORBIDDEN` + `getStatus() === 403` + `fieldErrors === {}`；错误体不含 `secret`、不含 `内部评级`、不含 `WORKFLOW_REQUIRED_FIELDS_MISSING` |
| Unknown access key（§8） | `legacy-secret` 不在 `access.fields` → GET 不返回该 Transition，body 不含 `legacy-secret`；POST 同样是 403 且错误体不泄露该 key |
| Visible missing regression（§7） | `amount = EDIT` 且值为空 → GET 仍返回 Transition；POST 仍 `WORKFLOW_REQUIRED_FIELDS_MISSING`（400），`Object.keys(fieldErrors) === ['amount']`，message 仍含 label `预计金额` |
| Admin regression（§13） | `resolveEffectiveAccess({ role: 'TENANT_ADMIN' })` 下 `fields.secret === 'EDIT'`，GET 仍返回 `hidden-transition`，POST 可正常解析；同时 `legacy-secret`（根本不是已发布字段）对 Admin 也按 `HIDDEN` 拒绝 |

## 6. 聚焦验证结果（Task 3）

> 下表是 `c8acbf1` + `dfe568c` 当时的原始记录；本轮补丁把
> `workflow-runtime.spec.ts` 从 17 条加到 20 条，因此现在同一条命令是
> `Test Suites: 5 passed` / `Tests: 272 passed`（269 + 新增 3 条），
> `pnpm --filter @crm/api typecheck` 仍 **exit 0**。

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @crm/api test -- workflow-runtime object-publication published-object` | exit 0，`Test Suites: 5 passed` / `Tests: 269 passed`。其中 `object-publication.policy.spec.ts`、`published-object.service.spec.ts`、`published-object-transaction.spec.ts` 全绿；日志里的 `Invalid published object snapshot for object object-corrupt` 是该 spec 自带的负路径用例，不是失败 |
| `pnpm --filter @crm/api typecheck` | **exit 0**（`tsc --noEmit`，无输出）。前置：先跑 `pnpm --filter @crm/contracts --filter @crm/database build`，因为 `packages/{contracts,database}/dist` 是 non-tracked 构建产物，未构建时 `apps/api` 的 e2e spec 会报 `TS2307 Cannot find module '@crm/database'`（构建顺序产物，非本分支回归）。全程**没有** `source` 根 `.env` |
| `pnpm typecheck`（全仓，可选） | exit 0 |
| `pnpm contracts:check` | exit 0，无漂移（`packages/contracts/openapi.json` / `packages/contracts/src/generated/openapi.ts` 未发生变化） |
| `npx prettier --check` + `npx eslint`（仅两个改动文件） | 均 exit 0，本分支自己的文件 lint 干净 |
| `git diff --name-only` | 见 §4：本分支完整改动集 4 个路径（其中 `c8acbf1` 当时为 2 个） |

基线聚焦套件（改动前）`workflow-runtime` 2 套件 46 测试全绿，未出现既有红灯。
§4.1 补丁轮后基线是 51，现为 54。

## 7. 已知非目标（本轮明确不做）

```text
Web 端 redaction（record-workflow-panel.tsx 未改动）
DB / Prisma / 迁移
Contracts / OpenAPI 形状
Action Engine publish analyzer 的 default-value 合法性
Action Engine publish analyzer 的 READ_ONLY required mapping
结构性 WORKFLOW_ACTION_* locator
executionSummary 的删除
deadlock retry 的 backoff / jitter
apps/api/test/auth.e2e-spec.ts 的既有失败
全仓 lint（57 个既有 API 错误）
CI / branch protection
Member-level Field Permission
V2.2 / Sales Execution / Automation / Agent
```

发布期校验没有被删除：本轮是 defense-in-depth，不是替代。

## 8. 遗留（本轮不修，仅记录）

- `assertRequiredFields()` 里的 `HIDDEN` 分支现在对合法调用者不可达但仍保留；
  按计划取「最小安全 diff」。若后续重构该函数，需保留 fail-closed 语义。
- `READ_ONLY` 必填字段为空导致用户无法自行补齐，仍是另一个 publication/UX
  议题，不在本轮范围。
- 独立评审还记录了两条**同类但不在本分支范围**的残留信息通道（普通记录路径的
  `FIELD_REQUIRED` `fieldErrors`、Action 失败重抛的 `ACTION_EXECUTION_FAILED`
  `fieldErrors`），本轮明确不修、只记录，需各自单独开任务。
- 本文件按任务给定的路径写在 `docs/audits/` 根下，仓库既有约定是
  `docs/audits/<日期>/<名称>.md`；此处遵循任务显式给定的文件名，未擅自改路径。
