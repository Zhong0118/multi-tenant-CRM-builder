# CRM Product Experience V2 Slice 2＋3 联合实施计划

> **For agentic workers:** 使用 executing-plans 按业务流程执行；本轮用户明确授权直接实施，无需逐组件确认。

**当前状态（2026-10-05）：PR #25 已合并，merge `78f55df`（已由 gh 核实）；不再是 ACTIVE 开发分支。** 历史实现与门禁不等于完整浏览器验收；遗留证据缺口纳入已授权 Slice4 收尾，详见[最终验收草稿](../../audits/2026-10-05/crm-product-experience-v2-final-acceptance.md)。下方任务清单保留原计划，不将未经观察的格子补勾为完成。

**Goal:** 看懂记录、处理下一步、回顾历史，并从员工首页完成任务后返回即时更新的工作台。

**Architecture:** 复用现有RecordWorkspace/DetailDrawer、FollowUpPanel/Workbench、ActivityTimeline与DashboardRenderer。详情采用摘要→工作流→下一步→历史→业务字段与渐进关联/附件；来源URL仅接受同租户工作台/跟进列表，普通深链保留原列表查询。既有follow-ups根缓存统一失效；记录写入显式刷新列表，首页隔离Dashboard加载错误。

**Tech Stack:** pnpm、Next/React、Ant Design、TanStack Query、TypeScript、Vitest/Testing Library、Playwright。

**Spec:** [V2设计](../specs/2026-10-03-crm-product-experience-v2-design.md) §§6–7及本轮用户范围合同。

**Base:** PR #24 merge `9cd2523319557d47fd877646716b01698d7e1193`；独立工作树与分支 `codex/crm-product-experience-v2-slices-2-3`。Slice1提交均已在基线，不重复带入新PR。

## Global Constraints

保留teal #167568、公共tokens、所有权限投影/乐观锁/工作流动作与错误。Follow-up与Activity领域分离；不硬编码租户状态字段，不新增计数API、schema、权限、CI或依赖。不改变已发布Dashboard组件、桶定义和租户时区。Slice4、AI、Automation、部署不在范围。新PR不自动合并。

## Task 1：详情阅读和处理层级

**Files:** record-detail-drawer.tsx、record-activity-timeline.tsx、follow-up-panel.tsx、records.module.css、follow-ups.module.css及对应tests。

**Interfaces:** 消费RuntimeObjectSchema投影字段、RecordSummary和原业务API；保留FollowUpPanel followUpId定位、RecordForm observed version、WorkflowPanel全部动作/结果。

- [ ] 聚焦红测：新增表单默认收起，点击安排/追加后出现；失败保留输入；只读不能写。
- [ ] 摘要取published title/default列与负责人，完整业务字段仍可发现；下一步和活动优先；关联/附件采用明确可展开区域，提示来自现有数据，无新计数请求。
- [ ] 修正受改FollowUpPanel既有lint，以异步定位实际状态更新解决，不禁用检查。
- [ ] 运行详情/跟进/活动/工作流/记录表单受影响测试并提交独立实现。

## Task 2：来源返回与即时刷新

**Files:** record-workspace.tsx、record detail route、follow-up-panel/workbench.tsx、followups route，新增小型source导航helper及tests。

**Interfaces:** 详情URL携带followUp与returnTo；returnTo白名单为同租户home/named dashboard/followups（保留range、status、page）。普通record query不受影响。

- [ ] 红测验证同租户来源精确返回、跨租户/外部/管理URL拒绝、普通列表排序过滤分页保持。
- [ ] 跟进列表状态/page进入URL；工作台和跟进任务链接携带来源及target ID。禁止仅用router.back依赖未知history。
- [ ] 创建/完成/改期/取消await既有follow-ups root失效；两个活跃观察者和返回非活跃缓存立即更新。记录编辑/工作流后的列表和相关跟进缓存同步刷新；不无差别伪造计数。
- [ ] 运行workspace/query/followup聚焦tests后独立提交。

## Task 3：员工工作台任务优先与故障隔离

**Files:** employee-workbench.tsx、workbench-chrome/elements、workspace-home-view.tsx、default/named dashboard page及dashboard-server.ts、对应tests。

**Interfaces:** DashboardRuntimeResult及已发布renderer不改；PersonalFollowUpWorkbench继续请求原server buckets/timezone。

- [ ] 红测：个人任务出现在运营日期控制之前；UNCONFIGURED复用既有个人任务；overview整体失败仍可处理个人任务并重试，auth/permission仍按原规则处理。
- [ ] 重排外围chrome；合并重复业务打开入口，保留有权新建；不修改已发布layout。
- [ ] 隔离default/named dashboard加载失败，提供局部retry与安全错误。
- [ ] 运行home/workbench/time-period tests并提交独立实现。

## Task 4：联合验证与交付

- [ ] 完整验证一轮：pnpm test；DATABASE_ADMIN_URL安全占位 pnpm typecheck/build/contracts:check；受影响文件ESLint；git diff --check。
- [ ] 复用55434隔离fixture，Admin/Employee×1440/900/390：记录阅读→安排/完成/改期/取消→返回来源即时刷新；列表搜索筛选排序分页返回；深链、权限、乐观冲突、错误重试、焦点、长内容和手机触控；Dashboard无配置/失败仍可用。只回归本次受影响边界，不重复平台/AI。
- [ ] 记录最终证据矩阵，区分PASS/自动化/NOT OBSERVED；更新HANDOFF/roadmap/两份计划及验收，独立review处理阻断。
- [ ] push与创建一个联合PR；核实最新SHA六门与review。汇报PR24 merge、新PR/commit、实现与证据、限制与合并建议。新PR不合并、不部署。
