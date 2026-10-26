# 员工每日目标与站内提醒

## 授权与边界

用户已接受连续推进、两个独立 PR、分别验收的顺序，并要求设计逻辑合理后执行。当前分支在既有隔离工作树中，从已部署的 main 8373c03 开始。只操作专用本地测试库，不部署、不修改生产数据，不改其他工作树。

## 使用规则

- 公司管理员在团队动态维护每日目标；每个指标一条公司规则，可选全体在职员工或多选指定在职员工。同一规则统一目标值。员工在任务与日报查看自己的当日进度。
- 指标为 calls、connectedCalls、wechatAdded、customersFollowed、followUpsDone、tasksDone。定义完全沿用 work-metrics.ts，包括新加微信按成员/客户首次登记、跟进按不同公共池记录、完成任务按 completed_at。日报文字不另行加次数。
- 目标整数 1–100000，提醒时刻为公司本地 HH:mm，默认 17:00；工作日用 ISO 1–7，默认周一至周五，可修改。未配置就不启用，已有公司不自动创建规则。
- 公司日历决定今天及日界，不能使用服务器或浏览器本地日界。配置保存立即生效；当天提醒时间已过会在下一次扫描检查，当天已提醒过则不重复。停用目标、停用成员或账号、非工作日均不产生新提醒。不补发以往日期。
- 到提醒时间，实际数低于目标才发送给员工本人；每个规则/员工/公司日期最多一条。消息明确写出日期、截至提醒时的实际数和目标数，它是历史时点记录。后续补做只更新当前进度，不伪造历史结果。
- 沿用现有站内消息列表、未读数、已读和跳转，目标消息跳到当前公司的 /work。公司管理员可看团队进度，员工不得指定其他成员或读取团队。
- 已有公海、逾期跟进、成交复核通知保持原权限和行为；目标通知没有业务记录 ID，不伪造占位业务表/记录。

## 存储与接口

新增 work_goal_rules（每租户 metric 唯一、version 乐观锁、enabled、target、remind_at、weekdays、audience）和 work_goal_recipients（同租户规则/成员外键）。保留规则并使用停用，ID 在修改时稳定，确保当天去重。受众 ALL_EMPLOYEES 自动涵盖后续加入的员工，SELECTED_MEMBERS 必须非空且全部为本公司活跃员工/账号。

扩展 member_notifications：允许目标消息 object_id/record_id 为空，新增 WORK_GOAL_BEHIND、goal_rule_id、details 快照；约束非目标消息仍必须有对象和记录。安全定义者扫描器使用现有 crm_notification_writer 最小权限角色，禁止运行时直接伪造通知，保留 RLS。当前消息 view 兼容两类消息，目标快照仅本人可见。

六个指标的 SQL 定义集中到一个共享、按租户/成员/时间范围读取的函数；工作统计和目标进度/扫描复用该函数，避免两套口径。原工作统计其他指标和接口不改变。扫描每分钟运行，多进程/重复扫描依靠唯一约束避免重复；配置与成员并发停用须重新验证或安全跳过并在下次检查，不能抢锁破坏现有业务顺序。

API（沿用 cookie/WorkspaceGuard、审计与 DTO 风格）：

```ts
type GoalMetric = 'calls'|'connectedCalls'|'wechatAdded'|'customersFollowed'|'followUpsDone'|'tasksDone';
type GoalRule = {id:string;metric:GoalMetric;target:number;remindAt:string;weekdays:number[];audience:'ALL_EMPLOYEES'|'SELECTED_MEMBERS';memberIds:string[];enabled:boolean;version:number};
// GET /workspaces/:tenantCode/work-goals/settings, admin only
// {timezone:string,rules:GoalRule[],members:{id:string,name:string}[]}
// PUT /workspaces/:tenantCode/work-goals/:metric, admin only
// body {expectedVersion:number,target:number,remindAt:string,weekdays:number[],audience,memberIds:string[],enabled:boolean}
// expectedVersion=0 only creates; positive must match current version; response GoalRule
// GET /workspaces/:tenantCode/work-goals/progress?scope=mine|team, default mine; team admin only
// {timezone:string,today:string,items:{ruleId:string,metric:GoalMetric,memberId:string,memberName:string,target:number,actual:number,remindAt:string,scheduledToday:boolean}[]}
```

未启用的规则不出现在当前进度，管理员配置列表可以看到。该版本每指标一条公司规则，不额外开发按人不同目标或周/月业绩考核。

## 测试

先写失败测试，再实现。覆盖真实 PostgreSQL 的权限隔离、同日并发去重、达到目标不提醒、配置/成员停用、工作日与非 UTC 日界、指定受众、重启后补当日而不补往日、旧通知不回归、统计口径一致、同日修改不二次提醒。API 覆盖员工越权、跨公司成员、无效指标/时刻/目标/版本、审计和进度。前端覆盖配置保存/冲突、真实计数展示、通知分组跳转和移动布局；隔离本地账号跑管理员配置→员工记录→进度更新→提醒→已读链路。

## Final review clarification
- Progress caches are scoped by verified member identity as well as tenant and mine/team; changing accounts must never display the prior account's progress, even if fresh fetching fails.
- An existing rule may be disabled while preserving its exact stored audience/member set even when those members/accounts are no longer active. This narrow stop-only exception does not allow creating a disabled rule with inactive members, changing its audience to inactive members, or enabling a rule with inactive members. Same-tenant membership and expectedVersion checks remain enforced.
