# Record Required Field Visibility Hardening — Design

> 日期：2026-09-16
> 类型：Workflow hardening（PR #2）之后的 bounded security hardening（非新功能）
> 状态：DRAFT — 等待用户批准后才可进入 Implementation Plan 之外的任何代码改动
> 前置事实：`.superpowers/sdd/records-path-leak-investigation.md`（只读调查，HEAD `06ae55b`）

---

## 1. 问题

`record-value-engine.ts:64-101` 的字段循环会遍历**已发布 schema 的每一个字段**，但**从不读 `input.access`**。因此当一个字段对当前 Actor 是 `HIDDEN` 时：

- 客户端**不会也不能**提交这个 key（`assertFieldWritable` 在 `:140-151` / 调用点 `:58` 只检查**已提交**的 key，提交隐藏字段会得到 `FIELD_HIDDEN` 403）；
- 于是循环走到 `:95-100`，发现 `field.required === true` 且值为空，抛出 `FIELD_REQUIRED`（带原始 `fieldKey`）；
- `record-command.ts:283-296` 把它翻译成 **HTTP 400** + `fieldErrors: { <hiddenFieldKey>: ['请填写必填字段。'] }`。

结果：**一个对该员工隐藏的必填字段，其 `fieldKey` 通过错误响应体泄露出去。** 这与 PR #2 修掉的 Workflow 路径是**同一类 metadata side channel，但在另一条路径上**，而且这里连"提交隐藏字段"都不需要——只要这个必填字段对他是隐藏的、且他没有提交它（他做不到），请求就必然失败并吐回 key。

### 1.1 触发条件（四条同时成立）

| # | 条件 |
|---|---|
| 1 | 该字段 `required: true` 且**不是标题字段** |
| 2 | `access.fields[fieldKey] === 'HIDDEN'`（或 key 不在 map 中；`?? 'HIDDEN'` fail-closed 默认在 `:144` / `:116`） |
| 3 | `field.defaultValue === null` —— 有**能落值**的非空默认值时，`:87-93` 直接落默认值、创建成功且不报错 |
| 4 | 客户端没有提交该 key（他无法提交） |

条件 3 决定了"员工永远建不出这条记录"**只对一半**：真正的前提是「必填 + 隐藏 + 空」。

> **勘误（2026-09-16，由独立评审发现，已在本任务内修正）**：条件 3 初稿写成"有非空默认值就一定创建成功"——**这是错的**。默认值同样要过 `normalizeValue()`：`''` 用在 TEXT / PHONE / EMAIL、失效的 MEMBER id、不在配置里的选项 key、形状不对的 JSON，都会抛 `FIELD_INVALID` **带着该隐藏字段的 key**，于是员工每次创建都拿到 400 + `fieldErrors.<hiddenKey>`——**与本任务要关闭的泄露是同一类**。因此实现必须保证：**对 Actor 不可见的字段，其默认值根本不参与该 Actor 的写入**（跳过默认值 materialize），而不是只跳过必填检查。

### 1.2 玩家可见症状（为什么要修）

`apps/web/src/features/records/record-form.tsx` 按 `fieldKey` 把 `fieldErrors` 映射到输入框；而 `HIDDEN` 字段永远不渲染（`dynamic-field.tsx:57` 返回 `null`）。于是员工看到一个**完整可提交、但永远提交失败**的表单，只提示"请填写必填字段。"，既不知道是哪个字段，也不知道存在这么一个字段。**这比直接 403 更糟，也正是 metadata 通道的可观测症状。**

---

## 2. 为什么 publish 期没有挡住它（以及一个被证伪的旧解释）

调查核实：**当前 publish 期没有任何 required-vs-HIDDEN 规则**，这条配置**今天就能发布**：

- `TITLE_FIELD_HIDDEN`（`object-publication.policy.ts:128-138`）**只针对标题字段**；
- `REQUIRED_FIELD_HAS_MISSING_VALUES`（`:144-162`）只在 `activeRecordCount > 0` 时触发，**0 记录的新对象照常通过**；
- 完整 blocking 规则清单见调查报告 §3。

**一处必须更正的既有文档**：`docs/audits/2026-09-16/action-engine-v1-acceptance.md:229` 用"Member Override 会在 publish 之后动态改变字段权限，publish 期 analyzer 无法完全预防"来解释这个缺口——**这是错的**。`resolveEffectiveAccess()` 的 fields 映射读的是 `employeeAccess.fields`（`effective-access.ts:83`），**从不读 `objectPolicy.fields`**；`MemberObjectPolicy` / `ObjectPermission` 只有六个对象级字段，`FieldPermission` 是 `@@unique([tenantId, fieldId, subjectRole])`，**按角色、没有成员维度**。override 只能影响"能不能创建/读取/修改"，**结构上不可能改变字段可见性**。本设计按正确事实推进，并建议单独修掉那处措辞。

---

## 3. 精确行为决策

> **requiredness 只能对"当前 Actor 有权填写的字段"强制执行。**

- **不可见（`HIDDEN`）→ 跳过必填检查**：不抛错、不写值（该字段最终为 `null`）。
- **可见（`EDIT` / `READ_ONLY`）→ 行为完全不变**：仍抛 `FIELD_REQUIRED`（原始 key、HTTP 400、`fieldErrors.<fieldKey>`）。
- 谓词**同时作用于 CREATE 与 UPDATE**：`:64-101` 循环是两者共用的；UPDATE 侧这正是"让员工能编辑一条被别的角色留下空值的记录"所必需的。
- 同一谓词**同时守护 `deriveTitle`（`:325-353`）**：publish 的 `TITLE_FIELD_HIDDEN` 已保证标题字段对员工非隐藏，所以这是纵深防御，但两条规则不应互相矛盾。
- **不做"泛化报错"**（例如 `FIELD_REQUIRED` 不带 `fieldKey`）：那样虽然堵住 key，但记录仍然建不出来、提示毫无用处，还会**误伤"提交时漏掉一个可见必填字段"的正当场景**。正确的判别依据是**可见性**，不是"匿名"。

### 3.1 有意接受的后果（必须写进验收文档）

修好之后，一条记录可以**带着"必填字段为 null"落库**，管理员会看到一格"必填但为空"。**这不是新类别的状态**：今天就已可达——管理员先建记录、之后把该字段改成必填；或 Action 目标对象少配一个字段。区别只是把"员工端一个永不成功的 400"换成"负责人端一个可见的数据质量问题"。

### 3.2 第二个 HTTP 面（同一根因，非独立缺陷）

`records.service.ts:396-401`（CSV 导入 `importRows`）的逐行失败回执带 `fields: Object.keys(error.fieldErrors)`，所以 `POST /records/import` 会在 `items[].error.fields` 里吐回同一个隐藏 key（HTTP 200）。**§3 的规则落地后它会自动一起消失**，但需要一个 RED 测试钉住，因为它是未来任何 `fieldErrors` key 的第二个出口。

### 3.3 本任务闭合到哪一步（诚实边界）

本任务闭合的是**泄露类（leak class）**：隐藏字段的 key 不再出现在任何记录写入路径的 `fieldErrors` 里，包括"默认值过不了归一化"这条路径——做法是**对 Actor 不可见的字段完全不参与他的写入**（既跳过必填检查，也不 materialize 默认值）。

**明确仍开放**（不属本任务，需后续任务）：publish 期**不校验默认值本身是否可落值**。因此 `required + HIDDEN + 过不了归一化的非空默认值` 这种配置仍可发布；修好之后它不再泄露 key、也不再阻塞员工创建，但该字段对**每一名员工**都会是空值——即操作员的配置错误从"员工端一个永不明白的 400"变成"负责人端一个可见的数据质量问题"（与 §3.1 同类）。要彻底消除这种配置，需要在 publish 期对默认值做类型/校验/选项/成员有效性检查——**那是另一个任务**，本任务刻意不做（避免在 publish 侧再造一套默认值校验）。

---

## 4. Publish 期规则（需要补，且要留豁免）

即使 §3 正确，这条 publish 规则仍然必要：该配置是**操作错误**，会让对象**对每一名员工都不可创建**，而 publish 期一声不响。规则落点选 `object-configuration.policy.ts` 现有的 `else` 分支（`:195-203`，已在遍历 `activeFields`、已有逐字段 `fieldKey` 定位的写法，紧邻 `EMPLOYEE_FIELD_ACCESS_REQUIRED`），因为它**只需要 draft、不需要跨切面上下文**，diff 最小。

```text
code:     REQUIRED_FIELD_HIDDEN            （新）
位置:     object-configuration.policy.ts，紧邻 EMPLOYEE_FIELD_ACCESS_REQUIRED
触发:     field.required
          && employeeAccess.fields[field.fieldKey] === 'HIDDEN'
          && field.defaultValue == null
message:  指明该字段；说明它会让员工无法填写，因而对象对员工不可创建
```

**豁免是强制的，但它的含义是"该默认值确实能落值"**：`required + HIDDEN + 能过 `normalizeValue()` 的非空默认值`是合法配置，挡住它就是过度拒绝。注意这不等于"非空即可"——一个**过不了归一化**的非空默认值（见 §1.1 勘误）既不合法、也不可能靠这条豁免变得合法；本任务不为此扩 publish 规则（见 §3.1 与 §5），而是由引擎侧"隐藏字段的默认值不参与写入"保证不泄露。

**为什么 publish 期足够覆盖本类问题**：字段权限来自冻结的 `employeeAccess` map，运行时没有任何东西能改它（§2）。未来若真的引入 **member-level field permission（当前不存在）**，这条规则对"角色默认值"仍然正确，但不再充分——**那个未来的改动才应该引入运行时过滤，而不是本次**。

---

## 5. 明确不做（Non-goals）

```text
Action Engine 的 ACTION_EXECUTION_FAILED 嵌套 fieldErrors 过滤（action-engine.ts:631-655）
  —— 同一类但独立通道：只修建记录循环关不掉它；需各自单独 bounded 任务
改任何 error code / HTTP status 的既有语义（可见字段仍是 FIELD_REQUIRED / 400）
DB / migration / Prisma schema / contracts / OpenAPI 形状
apps/web/**
Workflow 路径（PR #2 已闭合）
record-relations/*、follow-ups/*（调查确认无动态 key 的 fieldErrors）
全仓 lint / CI / branch protection
member-level field permission（当前不存在）
V2.2 Sales Execution / Automation / AI / Production Essentials —— 全部未批准
```

发布期既有校验一律**保留**（本设计是纵深防御，不是替代）。

---

## 6. Security Invariant（完成后长期成立）

```text
记录错误响应中出现的 field key / label
⊆
当前 Actor 可见字段的 metadata
```

本类问题（必填字段）只泄露 **key**，不泄露 label（消息是静态的 `'请填写必填字段。'`；全仓唯一在错误路径解析 label 的是 `workflow-runtime.ts:370-381`，已被 PR #2 变成不可达）。**修法不得引入 label。**

---

## 7. Definition of Done

- [ ] `HIDDEN` 必填字段不再出现在任何记录写入路径的 `fieldErrors` 中（CREATE / UPDATE / CSV 导入）；
- [ ] 可见必填字段缺值的行为**完全不变**（`FIELD_REQUIRED`、400、`fieldErrors.<fieldKey>`）；
- [ ] 谓词在 CREATE 与 UPDATE 两条路径上由**同一处**实现，不出现第二份拷贝；
- [ ] **对 Actor 不可见的字段，其默认值不参与该 Actor 的写入**（默认值过不了归一化时既不泄露 key、也不阻塞写入）；可见字段的默认值语义不变（仍 `FIELD_INVALID` 带 key）；
- [ ] `deriveTitle` 使用同一谓词，不与之矛盾，且其 keyless 分支**有测试钉住**（隐藏标题 → `fieldKey === undefined`；可见标题 → 带 key）；
- [ ] 新增 publish blocking 规则 `REQUIRED_FIELD_HIDDEN`，且**对 `defaultValue != null` 不触发**（有负例测试）；
- [ ] `records.service.ts:396-401` 的第二出口有测试钉住；
- [ ] 新增测试必须先证明**在修复前是红的**（行为性 RED），且测试有牙齿（可用变异证明）；
- [ ] focused 测试与 `pnpm --filter @crm/api typecheck` 均通过；
- [ ] 无 DB / Prisma / contracts / Web 改动，`git diff --name-only` 只含预期文件；
- [ ] 产出真实 Acceptance（只记实际观察到的事实，不照抄旧数字）；
- [ ] HANDOFF 与 Lean Roadmap 的相应行更新为已修复。
