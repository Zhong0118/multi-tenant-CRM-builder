# CRM 流程化演进路线图

> 日期：2026-09-15  
> 文档类型：Program Roadmap  
> 状态：ACTIVE  
> 当前事实来源：`HANDOFF.md`  
> 详细设计原则：`docs/superpowers/specs/2026-09-15-workflow-platform-boundaries.md`

## 1. 文档目的

这份文档只负责回答三个问题：

1. 当前 CRM Builder 正处在哪个阶段；
2. 后续能力应按什么顺序建设；
3. 每个阶段做到什么程度才算完成。

它**不是任何一个阶段的详细实现规格**。  
标记为 `PLANNED` 的阶段只代表方向和优先级，不代表已经批准具体数据模型、API 或页面设计，也不得在当前任务中提前实现。

详细开发遵循“一次一个可独立验收的 Task”：

```text
Roadmap
  ↓
长期架构边界
  ↓
当前 Task Design Spec
  ↓
当前 Task Implementation Plan
  ↓
开发
  ↓
Acceptance / Audit
  ↓
更新 HANDOFF 与 Roadmap
  ↓
再设计下一 Task
```

## 2. 状态定义

| 状态 | 含义 |
|---|---|
| `COMPLETED` | 已实现并有当前仓库事实或验收记录支持 |
| `ACTIVE` | 当前唯一主要产品开发任务 |
| `PLANNED` | 已确定方向，但不允许提前扩展实现 |
| `GATE` | 工程或发布守门项，可与产品任务并行，但必须在正式发布前完成 |

原则：

- 同一时间只保留 **1 个主要 `ACTIVE` 产品 Task**。
- 未来阶段不提前写成详细 Task Spec。
- 当前 Task 完成并验收后，下一阶段才从 `PLANNED` 提升为 `ACTIVE`。
- 如果实际实现证明原路线需要调整，以验收事实为依据更新本 Roadmap，不反过来强行迁就旧计划。

## 3. 当前产品位置

当前系统已经不是单纯 CRUD 型 CRM。

现有基础包括：

- 多租户、RLS、WorkspaceGuard、有效权限计算；
- 动态业务对象、字段、视图、权限与不可变发布快照；
- 动态记录 CRUD、筛选、排序、批量修改、CSV 导入导出；
- Record Relation；
- Activity Timeline；
- Follow-up Task、到期、逾期、完成、取消、转派；
- Owner / 离职交接；
- Record Attachment；
- 平台模板；
- 多工作台 Dashboard；
- 公司审计、平台审计；
- 版本冲突与乐观锁。

因此当前形态可定义为：

> **Configurable CRM Builder + Workflow Primitives**

它已经具备流程化所需的若干原语，但还缺少真正控制业务推进的：

- State；
- Transition；
- Action；
- Event / Trigger。

## 4. 总体阶段

| 阶段 | 状态 | 核心目标 | 完成后的产品意义 |
|---|---|---|---|
| V2.0 数据与 SaaS 基础 | `COMPLETED` | 多租户、动态对象、记录、权限、模板、Dashboard | 可配置数据型 CRM Builder |
| 工程守门 | `GATE` | CI、main protection、剩余关键人工验收 | 为后续核心改造提供回归保护 |
| V2.1A Workflow Core | `COMPLETED` | State + Transition + Manual Execution | 从“改字段”进入“走流程” |
| V2.1B Action Engine | `PLANNED` | 结构化业务动作 | 形成通用 CRM 业务闭环 |
| V2.2 Sales Execution | `PLANNED` | 团队任务、主管队列、逾期升级 | CRM 主动组织销售执行 |
| V2.3 Automation | `PLANNED` | Event + Trigger + Worker | 自动化 CRM |
| V2.4 Data Quality & Integration | `PLANNED` | 去重合并、通知、外部集成 | 长期运营与触达能力 |
| V2.5 Platform & Production | `PLANNED` | 模板升级、对象存储、监控、备份 | 可持续运营的平台产品 |
| V3 Agentic CRM | `PLANNED` | Approval + Typed Tools + Agent | Agentic CRM |

---

# 5. 工程守门（GATE）

这部分不是当前 Workflow 产品范围，但应尽快补齐，并在正式发布 Workflow 前完成。

## 5.1 当前已知工程缺口

以 `HANDOFF.md` 为事实来源，目前仍需：

- GitHub CI；
- `main` branch protection / required checks；
- Dashboard 设计器完整主链路人工验收：
  - 新增组件；
  - 编辑属性；
  - 保存草稿；
  - 预览；
  - 发布；
- 平台公司创建完整链路人工验收：
  - 新增公司；
  - 邀请首管；
  - 接受邀请；
  - 启用公司。

## 5.2 推荐 required checks

CI 具体实现应先以当前仓库可稳定执行的命令为准，目标至少覆盖：

- typecheck；
- API/Web/Packages tests；
- contracts drift check；
- production build。

不得为了“有 CI”而引入一套和本地实际验证路径不同的假流水线。

---

# 6. V2.1A — Workflow Core

状态：`COMPLETED`

详细规格：

- `docs/superpowers/specs/2026-09-15-workflow-v1-design.md`
- `docs/superpowers/plans/2026-09-15-workflow-v1-implementation.md`

## 6.1 目标

让任意动态业务对象拥有受控的业务状态流转。

管理员定义：

```text
State
  +
Transition
  +
Permission
  +
Required Fields
```

员工不再通过普通 Record Update 任意改“流程状态”，而是执行服务端认可的 Transition。

## 6.2 完成标志

必须同时满足：

1. 公司管理员可以为动态对象配置 Workflow；
2. Workflow 跟随对象 Draft / Publish 生命周期；
3. 新记录进入初始状态；
4. 旧记录可以显式“进入流程”，不能被静默批量改写；
5. Record Detail 展示当前流程状态；
6. Runtime 只返回当前用户有权执行的 Transition；
7. Transition 执行校验：
   - 当前状态；
   - 有效权限；
   - Required Fields；
   - Record Version；
8. 每次执行产生结构化 Transition History；
9. 每次执行进入 Audit；
10. 旧的无 Workflow 对象行为不受影响。

## 6.3 明确不做

本阶段禁止提前加入：

- Create Record Action；
- Create Relation Action；
- 自动线索转换；
- Trigger；
- BullMQ 业务任务；
- 定时自动化；
- 通知；
- Approval；
- 表达式 DSL；
- AI Agent。

---

# 7. V2.1B — Action Engine

状态：`PLANNED`

只有 Workflow V1 验收完成后才允许设计详细 Spec。

## 7.1 目标

让 Transition 不只是“改变状态”，还能产生结构化业务动作。

候选 V1 Action：

```text
UPDATE_RECORD
CREATE_RECORD
CREATE_RELATION
CREATE_FOLLOW_UP
ASSIGN_OWNER
```

## 7.2 业务意义

以“线索转化”为例，产品模板可以配置：

```text
Transition: 转化
  ↓
CREATE_RECORD(customer)
CREATE_RECORD(contact)
CREATE_RECORD(opportunity)
CREATE_RELATION(...)
CREATE_FOLLOW_UP(...)
```

但 CRM Core 中不得出现硬编码的：

```text
convertLeadToCustomer()
```

## 7.3 完成标志

当 Action Engine 完成后，可以认为产品已经从：

> 可配置数据 CRM

明确进入：

> **可配置流程型 CRM**

---

# 8. V2.2 — Sales Execution

状态：`PLANNED`

## 8.1 目标

把已有个人 Follow-up 提升为团队执行系统。

候选能力：

- 我的任务；
- 今日任务；
- 即将到期；
- 已逾期；
- 团队任务；
- 无负责人；
- 按成员查看；
- 主管异常队列；
- 任务转派；
- 基础逾期升级；
- 负责人分配。

## 8.2 产品变化

CRM 从：

> 用户进去查数据

转向：

> CRM 告诉业务人员今天应该做什么。

---

# 9. V2.3 — Automation

状态：`PLANNED`

## 9.1 目标

在 Workflow + Action Engine 稳定后加入事件与自动触发。

首批候选 Event：

```text
RECORD_CREATED
RECORD_UPDATED
STATE_CHANGED
FOLLOW_UP_DUE
FOLLOW_UP_OVERDUE
DATE_REACHED
```

目标结构：

```text
Event
  ↓
Condition
  ↓
Action
```

## 9.2 Worker

当前 Worker 只具备 Redis 连接边界。

本阶段才允许引入真正的业务队列，例如：

- 延迟任务；
- 到期检查；
- 重试；
- 幂等执行；
- 死信/失败记录。

完成后产品进入：

> **自动化 CRM**

---

# 10. V2.4 — Data Quality & Integration

状态：`PLANNED`

候选能力：

### 数据质量

- Duplicate Rule；
- 重复客户识别；
- Merge Preview；
- 字段合并；
- Relations 迁移；
- Activities 迁移；
- Follow-ups 迁移；
- Attachments 迁移；
- Audit。

### 通知与集成

建议顺序：

1. 站内通知；
2. Email；
3. SMS；
4. Feishu；
5. 其他 Adapter。

通知必须作为结构化 Action，而不是散落在业务 Service 中。

---

# 11. V2.5 — Platform & Production

状态：`PLANNED`

包括：

- Template Upgrade / Diff；
- 模板同步已有租户；
- Workflow / Action / Automation 模板化；
- 私有对象存储；
- 附件病毒扫描；
- 备份恢复；
- 日志脱敏与保留；
- 监控告警；
- Migration Rollback；
- 域名 / HTTPS / Cookie / CORS 生产验收；
- 独立统计中心；
- 专门导入导出中心；
- 必要时原生 Excel 导入。

说明：

独立统计中心应优先消费 Workflow 产生的结构化数据，例如：

- Stage Conversion；
- Stage Aging；
- Sales Cycle；
- Win Rate；
- Funnel。

因此不应抢在 Workflow 之前建设大量基于普通字段的临时统计逻辑。

---

# 12. V3 — Agentic CRM

状态：`PLANNED`

只有在 Workflow、Action、Automation、Audit、Approval 边界成熟后进入。

目标架构：

```text
Agent
  ↓
Typed Tool
  ↓
Action Engine
  ↓
Permission Check
  ↓
Approval（高风险动作）
  ↓
Execute
  ↓
Audit
```

Agent 禁止：

- 直接写 PostgreSQL；
- 直接绕过 Workflow；
- 绕过 Effective Access；
- 绕过 RLS；
- 绕过 Approval；
- 创建无法审计的副作用。

---

# 13. 依赖关系

```text
Data Foundation
      ↓
Workflow Core
      ↓
Action Engine
      ↓
Sales Execution
      ↓
Event / Trigger / Worker
      ↓
Data Quality / Notification / Integration
      ↓
Platform Upgrade / Productionization
      ↓
Approval / Agent
```

允许并行的只有低耦合工程项，例如 CI、视觉优化、生产基础设施。

业务核心阶段原则上不要跨级并行开发。

---

# 14. 每个 Task 的固定生命周期

每一个主要 Task 必须遵循：

## Step 1 — Promote

在本 Roadmap 中把下一阶段标成 `ACTIVE`。

## Step 2 — Design

创建：

```text
docs/superpowers/specs/YYYY-MM-DD-<task>-design.md
```

必须包含：

- Goal；
- Non-goals；
- Domain Model；
- Security；
- Publication / Versioning；
- API；
- UI；
- Compatibility；
- Acceptance Criteria。

## Step 3 — Implementation Plan

创建：

```text
docs/superpowers/plans/YYYY-MM-DD-<task>-implementation.md
```

按可以独立验证的小任务拆分。

## Step 4 — Development

Agent 按 Plan 开发，不自行扩展 `PLANNED` 阶段。

## Step 5 — Acceptance

完成后新增：

```text
docs/audits/YYYY-MM-DD/<task>-acceptance.md
```

只记录真实结果：

- Commit；
- Migration；
- Tests；
- Browser Walkthrough；
- Spec Deviations；
- Known Gaps。

## Step 6 — Handoff

更新 `HANDOFF.md`：

- 当前已完成；
- 当前真实缺口；
- 下一 Task；
- Acceptance 路径。

## Step 7 — Next Task

基于实际实现再写下一份 Spec，不提前半年冻结所有细节。

---

# 15. 当前唯一产品开发任务

Workflow V1 已进入 `main`，验收见
`docs/audits/2026-09-15/workflow-v1-acceptance.md`。

下一主要产品 Task 待用户确认后再从 `PLANNED` 提升为 `ACTIVE`。当前不要自行进入：

- Action Engine；
- Automation；
- Dedup / Merge；
- Notification；
- Template Upgrade；
- Agent。

Workflow V1 通过验收后，再决定下一 Task 的详细设计。
