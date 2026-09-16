# Action Engine V1 兼容性审查复核

> 日期：2026-09-16  
> 复核基线：`main` / `a01b6aee311ff400f7a202a488fa1545365fba24`  
> 结论：**PASS WITH REQUIRED REFACTOR**

## 1. 对 Agent 审查结论的判断

Agent 的主要架构判断是正确的：

- `0018` 不需要新 Action 表；给既有 `workflow_transition_definitions` 增加 `actions JSONB` 即可；
- 既有 transition table 已有 RLS / FORCE RLS / `crm_app` CRUD GRANT，因此新增列不需要新 RLS/GRANT；
- Action Engine 的核心前置不是业务 Action 本身，而是 transaction-aware command refactor；
- 不能直接调用会自行打开 transaction 的 Public Service；
- `PublishedObjectService.resolveRuntimeSchema()` 的 read gate 不适合作为 CREATE_RECORD target resolver；
- `resolveUpdateOwner()` 的 Employee 路径会保留 current owner，不能拿来实现一个声称“分配负责人”却实际 no-op 的 Action；
- 增加 `actions` 必须同步 Prisma、Workflow DTO/Type、Draft Repository、Publication compiler/parser、Web types 和 generated contracts。

## 2. 一处需要纠正

Agent 提到：

> `title VARCHAR(200)` vs `TEXTAREA(10000)`

这个具体事实不对。

当前 `records.title` 是 `VARCHAR(300)`；对象标题字段只允许：

```text
TEXT
PHONE
EMAIL
SINGLE_SELECT
```

`TEXTAREA` 不能成为标题字段。

真实边界是：

```text
EMAIL 最大可到 320
records.title 最大 300
```

因此需要把 derived record title 的 300 字符限制放进业务校验，而不是依赖 DB 报错。

Follow-up 的 `title` 才是 `VARCHAR(200)`，其现有 DTO 已有 `@MaxLength(200)`。

## 3. “BLOCKED” 应如何理解

这不是产品架构 BLOCKED。

更准确的是：

> **当前实现结构不能直接开写 Actions，但阻断点是可计划、可局部重构的。**

所以正式状态是：

```text
PASS WITH REQUIRED REFACTOR
```

而不是要求重新设计 Action Engine。

## 4. 已定案的两个语义

为避免继续等待产品拍板，本轮按已经批准的 Actor Permission 原则做保守定案：

### A. ASSIGN_OWNER

V1 不新增 Employee Owner Change 权限。

如果 Transition 允许 `EMPLOYEE` 且含 `ASSIGN_OWNER`：

```text
Publish blocked
```

以后“员工领取/归我负责”作为明确 capability 单独设计。

### B. Record title 长度

不截断。

derived title 超过 300：

```text
FIELD_INVALID(titleFieldKey)
```

这样普通 HTTP Create/Update 与 Action Create 都得到一致业务错误。

## 5. 可以进入 Implementation Plan

可以。

下一步严格限制在：

```text
Action Engine V1
+
为强事务必须做的 transaction-aware domain command refactor
+
上述 title correctness hardening
```

不得提前实现 Automation / Worker / Approval / Agent。
