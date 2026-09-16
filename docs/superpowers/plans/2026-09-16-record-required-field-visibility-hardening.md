# Record Required Field Visibility Hardening — Implementation Plan

> 日期：2026-09-16
> Spec：`docs/superpowers/specs/2026-09-16-record-required-field-visibility-hardening-design.md`
> 前置事实：`.superpowers/sdd/records-path-leak-investigation.md`
> 基线：`main` @ `06ae55b`（PR #2 已合并）
> 状态：DRAFT — **等待用户批准后才可开工**。按 Lean Roadmap 纪律，`PLANNED` 阶段不得提前实现。

本计划把一个已定的小改动拆成任务。它不讲产品方向，只讲**改哪个文件、先写什么失败测试、跑什么命令、什么算完成**。

---

## 边界（全程适用）

允许改动的文件（超出即停并汇报）：

```text
apps/api/src/modules/records/record-value-engine.ts
apps/api/src/modules/records/record-value-engine.spec.ts
apps/api/src/modules/records/record-command.spec.ts
apps/api/src/modules/records/records.service.spec.ts
apps/api/src/modules/objects/object-configuration.policy.ts
apps/api/src/modules/objects/object-configuration.policy.spec.ts
HANDOFF.md
docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md
docs/audits/2026-09-16/record-required-field-visibility-hardening.md   （Task 4 新建）
```

明确**不得**改动：`apps/web/**`、`packages/**`（database / contracts）、migrations、`action-engine.ts`（见 Task 4 的遗留说明）、`workflow-*`、auth、CI、lint 配置。

硬约束：不 reset / rebase / force-push / 部署；不 push、不建 PR（除非用户明确要求）；不碰 5432 开发库；不整份 source 仓库根 `.env`（它会导出 `NODE_ENV=development`，弄坏 `next build` 与一个 web 测试）；`git add` 只用显式路径，**绝不用 `git add .`**。

---

## Task 0 — 基线与隔离分支

**目的**：在一个干净隔离的环境里开工，先证明基线是绿的。

1. 工作树（沿用仓库既有做法，注意新 worktree **只含已跟踪文件**）：
   ```bash
   git worktree add .worktrees/record-required-field-visibility -b fix/record-required-field-visibility origin/main
   ```
2. 从主工作树复制 `.env` 进 worktree（gitignore 掉了，缺它则 DB 相关测试全失败）。
3. 构建依赖（新 worktree 缺 non-tracked 构建产物）：
   ```bash
   pnpm --filter @crm/contracts --filter @crm/database build
   ```
4. 基线聚焦测试（必须先全绿，记录真实数字）：
   ```bash
   pnpm --filter @crm/api test -- record-value-engine record-command records.service
   ```
5. 记录基线：`git log --oneline -1`、上面命令的 `Test Suites` / `Tests` 数字。

**完成标志**：分支存在、基线聚焦套件全绿、基线数字被记录。

---

## Task 1 — 写失败测试（RED）

**目的**：先证明泄露真实存在，且 RED 的原因是**行为性的**（"隐藏 key 被返回了"），不是编译错误、缺符号。

### 1.1 主 RED — `record-command.spec.ts`

放在既有 `:452` "applies required validation and field defaults" 旁边：

- 让既有 `secret` fixture 字段变成 `required: true`。该字段当前 `required` 未设（即 `false`），其对象配置里 `employeeAccess.secret: 'HIDDEN'`（`record-command.spec.ts:115` 一带）。
- **显式传入隐藏访问**：`access({ fields: { … , secret: 'HIDDEN' } })`。注意两件事：① 该文件的模块级 `access()` 帮助函数（`:122-135`）把 `secret` 默认成 `'EDIT'`；② 既有测试 `:410-425` 正是为此显式传 `secret: 'HIDDEN'`——照它的写法做。
- 输入 `values: { name: '张三' }`（只提交可见的标题字段）。
- 断言：`createRecordCommand` **成功**，并且**没有存下 `secret` 的值**；响应/值里不含 `secret` 的 key。

同时**保留可见场景**的覆盖：用默认的 `secret: 'EDIT'` fixture 断言仍然得到 `{ code: 'FIELD_REQUIRED', fieldErrors: { secret: [...] } }`。

预期 RED（修复前）：实际会抛 `FIELD_REQUIRED`，`fieldErrors.secret` 带着隐藏 key —— **这就是要观察到的红**。

> 提示：既有 `:831-842` 那条测试在 `secret.required = true` 后**不会回归**，因为它会**提交** `secret`，`assertFieldWritable` 先抛 `FIELD_HIDDEN`，根本走不到必填循环。收工时用完整套件确认这一点。

### 1.2 引擎级 RED — `record-value-engine.spec.ts`

放在既有 `:313` 旁边：

- 断言 `validateRecordMutation({ mode: 'CREATE' })` 在一个**非标题、`required: true`、`HIDDEN`** 的字段上**不抛错**；
- 同时断言一个**可见**的必填字段仍然抛 `{ code: 'FIELD_REQUIRED', fieldKey: '<该字段>' }`。

### 1.3 第二出口 RED — `records.service.spec.ts`

放在既有 `:1404`（导入逐行失败）旁边：

- 断言导入失败行的 `error.fields` **不再包含**那个隐藏 key。

### 1.4 先跑一遍并记录 RED

```bash
pnpm --filter @crm/api test -- record-value-engine record-command records.service
```

**完成标志**：RED 输出被逐字记录（哪些用例红、报的什么、为什么这是"行为性"的红）。若 RED 表现为编译错误或符号缺失，说明测试写错了，不算完成。

---

## Task 2 — 实现（GREEN）

1. 在 `record-value-engine.ts` 加**一个**模块私有谓词，语义：
   ```text
   不可见（access.fields[key] 缺失 或 === 'HIDDEN'）→ 跳过必填检查
   可见（EDIT / READ_ONLY）→ 行为不变
   ```
   注意与 `assertFieldWritable`（`:140-151`）保持同一套 fail-closed 默认；**若要用 own-property 判断，参考 `workflow-runtime.ts` 的 `Object.hasOwn` 写法**（PR #2 的教训：`?? 'HIDDEN'` 对 `constructor` / `__proto__` / `toString` 会取到原型链继承成员，把"缺失"判成"可见"）。
2. 把它用在 `:95-100` 的必填检查上（CREATE / UPDATE 共用这一处，**不要复制第二份**）。
3. 同样守护 `deriveTitle`（`:325-353`）。
4. **不要**改 `record-command.ts` 的 403/400 映射，**不要**改 error code / message。

跑：
```bash
pnpm --filter @crm/api test -- record-value-engine record-command records.service
```
**完成标志**：全部通过；Task 1 的红全部转绿；既有测试无回归。

**若主修单独落地后**：确认 §1.3 的第二出口也自动变绿（它共用同一个 emitter）。

---

## Task 3 — Publish 期规则

1. 在 `object-configuration.policy.ts` 的 `analyzeObjectConfiguration()`（`:67`）里，现有的 `else` 分支（`:195-203`，已遍历 `activeFields`、已有逐字段 `fieldKey` 定位）加新 blocking 规则：
   ```text
   code: REQUIRED_FIELD_HIDDEN
   触发: field.required && employeeAccess.fields[field.fieldKey] === 'HIDDEN' && field.defaultValue == null
   ```
   必须带 `fieldKey` 定位；message 要说清"员工无法填写 ⇒ 对象对员工不可创建"。
   注意该函数被**两处**调用——`object-publication.policy.ts:120`（对象发布）与 `business-template-publication.policy.ts:112, :286`（业务模板发布），所以这条规则天然同时覆盖两条发布流；实现时确认两条流都符合预期，不要只测一条。
2. 在同一目录的既有测试文件 `object-configuration.policy.spec.ts` 里加：
   - 正例：`required + HIDDEN + default null` → 产生 `REQUIRED_FIELD_HIDDEN` blocking；
   - **负例（必须有）**：`required + HIDDEN + 非空默认值` → **不**产生该 blocking。

跑该策略的测试文件 + 相关对象测试。

**完成标志**：正例与负例都通过；既有 publish 测试无回归。

---

## Task 4 — 验证、验收文档与状态同步

1. **独立验证**（另一个 agent 或人工，不采信实现者自述）：复跑 focused 套件、`pnpm --filter @crm/api typecheck`、`git diff --name-only`（应只含边界内的文件）。
2. **变异证明**：把谓词改回原样，确认 Task 1 的测试变红；逐字节还原后确认变绿。
3. 新建 `docs/audits/2026-09-16/record-required-field-visibility-hardening.md`：只记**实际观察到的**事实（基线 SHA、提交、RED/GREEN 输出、测试数、typecheck 结果、改动文件、有意接受的后果 §3.1、未做的 Non-goals §5）。**不要照抄任何旧测试数字。**
4. 更新 `HANDOFF.md`（该缺口条目标记为已修复，注明合并状态）与 `docs/superpowers/plans/2026-09-16-crm-lean-roadmap.md`（Record 侧那一行）。
5. 顺带修 `docs/audits/2026-09-16/action-engine-v1-acceptance.md:229` 那处**被证伪的** Member Override 理由（见 spec §2）。**只改理由，不改该文件里的历史验收数据。**
6. 提交、收口（是否 push / 开 PR 由用户决定）。

**完成标志**：验收文档存在且数字真实；状态同步后全仓 grep 无"未修复/待独立任务"之类的陈旧措辞残留；HANDOFF 与 Lean Roadmap 一致。

---

## 明确不在本计划内（各自单独开任务）

1. `action-engine.ts:631-655`：把内层 `fieldErrors` 原样重抛成 `actions.<actionKey>.<fieldKey>` 且**不按 actor 权限过滤**。只修建记录循环**关不掉它**。注意：既有验收文档写的"仅 legacy 快照可达"**需要先核实**——一个普通已发布的目标对象带 required+HIDDEN 字段，无需任何 legacy 快照就能到达。
2. member-level field permission（当前不存在）：若未来引入，必须由**那个改动**引入运行时过滤。

---

## 风险与回滚

- 风险：谓词写错方向 → 把**可见**字段的必填校验也跳过了（静默放过真正的漏填）。缓解：Task 1 必须同时钉住"可见字段仍然报错"，且 Task 4 用变异证明它有牙齿。
- 风险：`deriveTitle` 与必填循环用了两份判断而漂移。缓解：同一谓词复用，review 时 grep 确认只有一处实现。
- 回滚：改动无 DB / 无迁移，直接 revert 提交即可；有意接受的后果（§3.1）只影响数据质量，不破坏既有数据。
