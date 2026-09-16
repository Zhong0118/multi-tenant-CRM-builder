# Record Required Field Visibility Hardening — Acceptance

> 日期：2026-09-16
> 类型：Workflow Required Field Visibility Hardening（PR #2）之后的 bounded security hardening（非新功能）
> 设计：`docs/superpowers/specs/2026-09-16-record-required-field-visibility-hardening-design.md`
> 计划：`docs/superpowers/plans/2026-09-16-record-required-field-visibility-hardening.md`
> 证据：`.superpowers/sdd/records-path-leak-investigation.md`、`record-hardening-report.md`、`record-hardening-review.md`、`record-hardening-report-round2.md`（均未跟踪过程中的产物）

本文件只记录**实际观察到的**事实。所有命令都在
`.worktrees/record-required-field-visibility` 内执行。

## 1. 基线与提交

| 项 | 值 |
| --- | --- |
| 分支 | `fix/record-required-field-visibility` |
| 基线 | `66ed859`（= 当时的 `origin/main`，含 Record hardening 的 spec/plan） |
| 提交 | `45c9f08` 记录写入不再泄露隐藏必填字段 key<br>`00eb7af` publish 期拦截"必填+隐藏+无默认值"<br>`1368a1e` 隐藏字段的默认值永不 materialize<br>外加一个只动文档的收口提交（本文件所在提交：设计勘误、验收、HANDOFF / Lean Roadmap 状态同步） |
| 状态 | **未合并、未部署**（合并由用户决定） |

未 reset / rebase / force-push / push / 建 PR / 部署。

## 2. 被修复的问题

`record-value-engine.ts` 的字段循环遍历**每一个**已发布字段，却从不读 `input.access`；而 `assertFieldWritable` 只检查**已提交**的 key。于是对一个 `HIDDEN` 必填字段（客户端无法提交它）：

- `:95-100` 的必填检查抛 `FIELD_REQUIRED` **带原始 fieldKey** → `record-command.ts:283-296` 映射成 **HTTP 400** + `fieldErrors.<hiddenKey>`；
- 第二条出口：`records.service.ts:396-401`（CSV 导入）逐行回执带 `fields: Object.keys(error.fieldErrors)`；
- **第三条出口（本轮新发现）**：`:87-93` 的默认值 materialize 对隐藏字段照跑，默认值过不了 `normalizeValue()` 时抛 `FIELD_INVALID` **同样带 key**。

玩家可见症状：员工看到一个完整可提交、但永远失败的表单，只提示"请填写必填字段。"，无法知道是哪个字段（隐藏字段永远不渲染）。

## 3. 实施的精确运行时规则

> **对 Actor 不可见的字段，完全不参与该 Actor 的写入。**

- **不可见（`HIDDEN`，或 key 不在 `access.fields`）**：
  - **跳过必填检查**（不报错）；
  - **不 materialize 默认值**（`1368a1e`）——默认值过不了归一化时既不泄露 key、也不阻塞写入，字段保持 `undefined`。
- **可见（`EDIT` / `READ_ONLY`）**：行为**完全不变**——必填缺值仍 `FIELD_REQUIRED`（400 + `fieldErrors.<fieldKey>`）；默认值非法仍 `FIELD_INVALID`（带 key）。
- 谓词**只有一处实现** `isFieldVisible()`（`Object.hasOwn` + `!== 'HIDDEN'`，fail-closed、原型安全），CREATE / UPDATE 共用同一个循环，`deriveTitle` 复用同一谓词。
- `deriveTitle` 对隐藏标题字段抛**不带 key** 的 `FIELD_REQUIRED`（code/status 不变，只去掉 key）；该分支对**任何当前可发布的配置都不可达**（`TITLE_FIELD_HIDDEN` + 读闸门），属纵深防御。

### 3.1 Publish 期规则

`object-configuration.policy.ts` 新增 blocking 规则：

```text
code:    REQUIRED_FIELD_HIDDEN
触发:    field.required && employeeAccess.fields[fieldKey] === 'HIDDEN' && defaultValue == null
定位:    带 fieldKey
```

`defaultValue == null` 豁免**保留**（有能落值的默认值时该配置合法）。该函数被两处调用——对象发布（`object-publication.policy.ts:120`）与业务模板发布（`business-template-publication.policy.ts:112`，另 `:286` 为 changes-only）——两条流都已实测触发。

## 4. 改动文件

```text
apps/api/src/modules/records/record-value-engine.ts
apps/api/src/modules/records/record-value-engine.spec.ts
apps/api/src/modules/records/record-command.spec.ts
apps/api/src/modules/records/records.service.spec.ts
apps/api/src/modules/objects/object-configuration.policy.ts
apps/api/src/modules/objects/object-configuration.policy.spec.ts
```

`git diff --name-only 66ed859..HEAD` = 恰好上面 6 个文件（224 + 98 行插入级别；生产代码仅 2 处：必填检查加可见性条件、默认值 materialize 加可见性条件，外加 `deriveTitle` 传入 access）。
无 DB / migration / Prisma / contracts / Web 改动；error code 与 HTTP status 语义不变。

## 5. TDD 过程（RED → GREEN，真实输出）

### 5.1 RED（先写测试，未改实现）

- focused `record-value-engine record-command records.service`：**3 套件失败 / 20 failed, 86 passed, 106 total**（基线 103）。失败原因**都是行为性的**：
  - `records.service.spec`：`Expected value: not "secret" / Received array: ["secret"]`（导入失败行的 `error.fields`）；
  - `record-command` / 引擎：`ApiException: 请填写必填字段。`（来自 `record-command.ts:291`），即 `FIELD_REQUIRED` 带着隐藏的 `secret` / `note` key。
- `object-configuration`：**1 failed / 11 passed**（尚无 `REQUIRED_FIELD_HIDDEN`）；负例（有默认值不拦截）在修复前即绿。
- 第二轮 RED（`1368a1e` 之前）：隐藏 `EMAIL` 默认值 `''` → `Received promise rejected instead of resolved: [RecordValueError: 字段值格式不正确。]`；隐藏标题错误**带 key**（`Received: "name"`）。2 failed / 44 passed，无类型错误。

### 5.2 GREEN（实现之后，由控制者独立复跑）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @crm/api test -- record-value-engine record-command records.service` | **3 套件 / 109 通过** |
| `pnpm --filter @crm/api test -- object-configuration` | **1 套件 / 12 通过** |
| `pnpm --filter @crm/api test`（全 api 单测） | **69 套件 / 918 通过**（基线 915，+3） |
| `pnpm --filter @crm/api typecheck` | **exit 0** |

### 5.3 变异证明（测试有牙齿）

- 必填检查里的可见性条件改回（等价于 `return true`）：**20 failed / 86 passed**，恢复后 109 通过。
- 默认值 materialize 的可见性条件回退：新默认值用例失败（`promise rejected instead of resolved … 字段值格式不正确。`），恢复后通过（文件 sha256 前后一致）。
- `deriveTitle` 的 keyless 分支回退成"总是带 key"：新的隐藏标题用例失败（`Received: "name"`），恢复后通过。**这条正是评审 M4 指出的"原本没有牙齿"的缺口，本轮已补上。**

## 6. 独立评审与处置

独立对抗式评审结论 **PASS_WITH_FINDINGS**（1 条 high = 硬性 DoD 违背，已在合并前修掉）。

| 发现 | 严重度 | 处置 |
| --- | --- | --- |
| `defaultValue == null` 豁免放行了"非空但**落不了值**的默认值"，员工创建时 `FIELD_INVALID` **照样泄露隐藏 key** | high | **已修**（`1368a1e`：隐藏字段的默认值不再 materialize）+ 补测试；spec §1.1 / §3.3 / §4 的对应断言已勘误 |
| `deriveTitle` 的 keyless 分支**没有任何测试**（回退后全套仍绿） | medium | **已修**（补隐藏/可见标题两条断言，并用变异证明） |
| 实现者报告"19 个无关测试" / "18 pre-existing" 数字错误 | low | 评审实测为 **17**（回退谓词：17 既有 + 3 新增 = 20）；本文件采用实测值 |
| 实现者报告称"eslint 未安装"不实 | low | 评审实测 `apps/api/node_modules/.bin/eslint` v9.39.5 可运行，6 个 lint 错误**全部既有**、0 新增；本文件不引用该说法 |
| 评审对 `record-command.spec.ts` 的 `access()` helper 默认值改动（`secret` 由 `EDIT` 变 `HIDDEN`）的裁定 | — | **可接受、不重做**：该默认值与 fixture 自身 `employeeAccess.secret: 'HIDDEN'` 一致；评审实测无覆盖丢失（改动前只有 2 处提交 `secret`，都在显式 HIDDEN map 下期望 `FIELD_HIDDEN`），17 个受影响测试仍各自测它们声称的行为 |

评审同时纠正了我 spec 里两处措辞（"不可达 over HTTP"不精确；`assertFieldWritable` 等仍用 `?? 'HIDDEN'`，并非"同一套 fail-closed 默认"），已在 spec 勘误。

## 7. 本任务闭合到哪一步（诚实边界）

- **已闭合**：隐藏字段的 key 不再出现在记录写入路径的 `fieldErrors`（CREATE / UPDATE / CSV 导入 / 默认值路径）。
- **仍开放（不属本任务）**：
  1. **publish 期不校验默认值本身能否落值**。因此 `required + HIDDEN + 过不了归一化的非空默认值` 仍可发布；修好后它不再泄露 key、也不再阻塞员工创建，但该字段对每名员工都是空值——配置错误从"员工端永不明白的 400"变成"负责人端可见的数据质量问题"。
  2. `action-engine.ts:631-655`：内层 `fieldErrors` 被原样重抛为 `actions.<actionKey>.<fieldKey>`，且**不按 actor 权限过滤**。同一类、独立通道，**只修建记录循环关不掉它**——需单独任务。（既有验收文档写的"仅 legacy 快照可达"**需要重新核实**：一个普通已发布的目标对象带 required+HIDDEN 字段，无需 legacy 快照即可到达。）
  3. `effective-access.ts` 的 `?? 'EDIT'` 对"缺失条目 + prototype 型字段名"（如 `constructor`）会取到原型链成员并判为可见；`resolveEffectiveAccess` 会为每个 schema 字段 materialize key，加上 `EMPLOYEE_FIELD_ACCESS_REQUIRED` 在 publish 期拦截缺失条目，所以仅 legacy 快照可达。本任务的引擎谓词在该边界上已 fail-closed（`Object.hasOwn`），但上游那几处 `?? 'HIDDEN'` / `?? 'EDIT'` 未统一，记为跟进项。
  4. `record-value-engine.spec.ts` 里一条"删除 access 条目"的断言钉的是一个真实解析器**不会产出**的 map 形状（信息级，不影响行为）。

## 8. 不做的（Non-goals）

```text
Action Engine 嵌套 fieldErrors 过滤
publish 期默认值合法性校验
有效访问解析器的 `?? 'EDIT'` / `?? 'HIDDEN'` 统一
错误码 / HTTP status 语义变更
DB / migration / Prisma / contracts / OpenAPI
apps/web/**
Workflow 路径（PR #2 已闭合）
record-relations/*、follow-ups/*（调查确认干净）
全仓 lint / CI / branch protection
member-level field permission（当前不存在）
V2.2 / Automation / AI / Production Essentials
```
