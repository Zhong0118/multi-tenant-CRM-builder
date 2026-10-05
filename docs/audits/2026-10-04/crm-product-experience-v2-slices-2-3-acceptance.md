# CRM Product Experience V2 — Slice 2＋3 联合验收

状态：实现与自动化门禁已完成；浏览器矩阵仍为部分观察，本文不声明整体浏览器 PASS。

## 交付基线

PR #24已于2026-10-04合并，merge `9cd2523319557d47fd877646716b01698d7e1193`。合并前当前页批量选择修复 `4484ed9` 六门SUCCESS（run37198879692），合并后main run37199104409六门SUCCESS。

新分支 `codex/crm-product-experience-v2-slices-2-3` 从上述主线创建，独立工作树，不重复携带已合并Slice1差异。用户授权修改/测试/提交/push/新PR；新PR不自动合并。Slice4、部署、AI/Automation、权限/schema/CI改动不在范围。

## 已完成实现与自动化证据

- Task1提交40ce11a、手机触控0f640ae：摘要→工作流→下一步→活动历史；完整字段/关联/附件渐进展开，表单按需出现；投影、权限和observed version保留。32受影响测试通过；Web typecheck和受影响lint无warnings。
- Task2提交114c698、缓存修复0aab949、提交后刷新错误修复ef20de7：来源白名单与查询状态、跟进URL状态、返回/焦点、活动与跟进缓存、记录/工作流缓存刷新；170＋40受影响测试、工作流10测试和Web typecheck/affected lint/diff check均通过（按提交报告；最终全量仍需包含最新修复重跑）。
- Task3提交d9c3854：个人任务位于日期控制前；业务表快捷入口去重且保留canCreate；默认/命名Dashboard overview瞬态失败隔离、requestId安全提示与当前路由retry；4xx/auth/permission/Next控制流不吞。44受影响测试、full typecheck和affected lint/diff check通过。
- 联合当前分支 focused rerun：9 files / 79 tests passed，Web typecheck passed；全仓 `pnpm test`：API/Web/worker/contracts/database/tenant-templates passed，Web 560 tests＋architecture3 passed；`pnpm contracts:check` passed。
- 真实隔离浏览器：Employee详情在390/900/1440可打开且无横向溢出；390按需跟进/活动已保存，关联创建/解除与附件上传在普通对象完成；工作流独立发布fixture的 `处理完成` 将版本v1→v2、状态待处理→已处理、追加赵晨历史。Employee工作台任务位于日期控制之前；任务链接带 `followUp` 与精确 `returnTo`，改期后返回首页在390显示 `all1/overdue0/today1` 与新时间 `10/04 23:30`，避免旧计数闪现。Admin在900命名Dashboard真实观察到个人任务、源链接、快捷入口。

## 最终工程门禁

- `pnpm test`：exit0（API/Web/worker及共享包；Web unit560、architecture3）。
- `DATABASE_ADMIN_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm contracts:check`：exit0，生成契约无diff。
- 联合focused测试＋Web typecheck：exit0（79/79；随后最新修复必须重跑）。
- 最终仍需在最新提交后重跑：`pnpm typecheck`、`pnpm build`、`pnpm contracts:check`、affected ESLint、focused/full tests，并完成最终代码评审。

## 浏览器矩阵与边界

| 流程 | Admin 1440/900/390 | Employee 1440/900/390 | 证据状态 |
|---|---|---|---|
| 列表查询→详情→返回，状态与焦点 | 部分 | 真实390/900/1440详情；任务来源390 | 不能宣称六格完整PASS |
| 工作台→详情→完成/改期/取消→来源即时更新 | 任务/来源部分 | 真实390改期与即时计数；其余 | 部分观察＋自动化 |
| 新增跟进/活动，错误草稿与恢复 | 自动化＋Admin390保存 | 自动化；Employee矩阵未完整跑 | 部分观察 |
| 关联/附件发现、操作与数量 | 普通对象真实操作 | 组件自动化；六格未完整跑 | 部分观察 |
| 工作流动作/结果/版本冲突 | Admin fixture动作真实；冲突未浏览器观察 | 自动化/fixture；冲突未浏览器观察 | 冲突 NOT OBSERVED |
| 无配置/失败Dashboard仍可处理个人任务 | 路由自动化覆盖400/401/403/404/503和retry；SSR fault未浏览器注入 | 同上 | 浏览器故障注入 NOT OBSERVED |
| 长内容/手机/键盘/权限 | 自动化＋部分真实 | 390详情/任务来源真实；键盘跨页焦点为已知BODY fallback | 不能宣称六格完整PASS |

### 已知边界

- `returnTo`跨页面回到已卸载来源时保持浏览器默认BODY焦点；普通仍挂载的列表来源有可见记录链接焦点恢复。未引入全局持久化焦点基础设施。
- 自动化测试覆盖跨租户/外部/管理路径拒绝、未授权错误不吞、workflow提交后详情刷新失败不误报提交失败、active/inactive跟进缓存刷新；最终浏览器未注入真实503 SSR故障。
- 独立工作流fixture `slice23-flow-probe` 发布analysis无blocking/warnings；Follow-up POST对连字符objectCode返回400（既有DTO正则），所以任务业务流程使用既有`opportunities`，不扩展API。
- API/Web运行均使用隔离55434/3100/3101/Redis15；未触碰其他DB，未部署，未调用真实AI Provider。

## Post-merge status

2026-10-05：PR #25 已合并，merge `78f55df`，已由 gh 核实。原实现、工程门禁和浏览器矩阵保留为当时证据，不回填为全格PASS。当前已授权Slice4及遗留验收缺口收尾，本地实现存在但未合并、尚无新PR；当前CI不作成功声明。

新增观察见[最终验收草稿](../2026-10-05/crm-product-experience-v2-final-acceptance.md)：真实Employee `18800001003` 在390完成v3流程记录动作；named首页SSR503隔离及真实retry恢复。上一轮default503/auth401/403证据仅保留其原标签。曾被称为Employee的 `18800001002` 实为第二位Admin，不能充当员工发布前后证据。完整两角色三宽度矩阵和来源焦点仍待补，不以合并替代验收。
