# CRM Product Experience V2 — Final Acceptance Draft

日期：2026-10-05。状态：**IMPLEMENTED / LOCAL VERIFIED / BROWSER RISK-BASED OBSERVED / PR AND CI PENDING / NOT MERGED**。

本文记录收尾时已确认的事实与待补项，不声明整体V2完成、完整浏览器矩阵PASS或当前CI成功。浏览器观察由主agent提供；本文整理不代表另一次独立复测。

## 1. 交付与授权

| 切片 | 当前事实 | 证据边界 |
|---|---|---|
| Slice1 | PR #24 已合并，`9cd2523` | [历史验收](../2026-10-03/crm-product-experience-v2-slice-1-acceptance.md)保留原矩阵和门禁 |
| Slice2＋3 | PR #25 已合并，`78f55df`，gh已核实 | [历史验收](../2026-10-04/crm-product-experience-v2-slices-2-3-acceptance.md)仍是部分浏览器观察 |
| Slice4 | 已授权，实现 `206e310` / `8cf9c16` / `7fcaca6`，回归修复 `ea660ca` / `c248fe5`；本地验证和独立review完成，等待PR | 分支 `codex/crm-product-experience-v2-slice-4`，尚无PR，未合并 |

范围：Object/Field/Permission/Dashboard/Workflow管理员配置体验与先前证据缺口收尾。保留服务端权限投影、乐观锁、草稿/发布及既有业务语义；不扩展API/schema/CI/依赖。新PR不自动合并，不部署，不启动AI/Automation/Sales Execution/Production Essentials。

浏览器使用既有隔离55434 fixture、Web3100/API3101；named SSR故障使用隔离代理3102，不代表生产故障。Admin `18800001001`；**真实Employee为 `18800001003`（赵晨）**。`18800001002` 为第二位Admin，先前被称为“Employee before/after”的观察不得作为员工证据。

## 2. 新增已观察路径（不是全角色矩阵）

| 工作面 | 实际观察 | 结论边界 |
|---|---|---|
| Admin Field / Object，1440 | 抽屉将字段改名为“名称 V2 草稿验收”，保存后draft6、publication仍v1；随后发布v2 | 实际草稿保存/发布路径已观察；不能用第二位Admin证明Employee发布前后投影 |
| Admin Workflow | 重命名动作后保存draft7，再发布v3；对正确object-definitions路由注入PUT409 `v2-workflow-conflict`，动作输入 `V2 conflict retained action final` 保留 | 保存/发布及冲突保留输入已观察；不证明全部动作配置/校验路径 |
| Admin Workflow响应式 | 900控件区域宽578，保存按钮 `(771,820,88,34)` 可达；390桌面提示保留返回路径 | 真实主要编辑区域/能力边界已观察，不称390完整Workflow编辑可用 |
| Employee流程，390 | `18800001003` 新建记录 `6951528c-2902-46da-90a0-19a7fa5b3723`，使用v3发布流程；执行“处理完成 V2”，待处理→已处理、record version1→2，历史显示赵晨 | 真实Employee运行动作已观察；并非完整字段发布前后对照 |
| Employee字段发布前/后，390 | Admin改名“名称 V2 员工发布验收”并保存draft8，live仍v3；真实赵晨 `18800001003` reload `/new` 仍见旧“名称 V2 草稿验收”及v3；Admin发布v4后Employee reload见新标签及v4 | 真实Employee草稿不生效、发布生效对照已观察；不扩大为全视口矩阵 |
| 成员覆盖立即生效，Employee390 | 同一fixture保存canCreate=false后Employee列表新建link count0，直接 `/new` 404；恢复INHERIT后 `/new` 再可达，未再次发布 | 立即覆盖与继承恢复已观察；失败校验保留输入仍待补 |
| Employee记录写入错误，390 | PATCH409 `v2-employee-conflict` 与PATCH503 `v2-employee-write503` 后备注输入保留 | 两项真实失败保留输入已观察；不扩大为全部表单错误 |
| Employee提交后刷新失败，390 | 实际PATCH成功后list GET503 `v2-refresh503`；抽屉退出编辑，提示“已保存但刷新失败”、recordv2；独立API GET200核对备注 `V2 committed refresh503 acceptance` 及version2 | 已提交写入未误报为失败，保存数据独立核验；后续完整恢复矩阵未声明 |
| Employee Followups来源返回，1440/900/390 | 返回 `OPEN&page1` 的精确原URL，H2“我的跟进待办”实际获得焦点；动画后dialog1440 x800/width640，900 x261/width640，390 x0.7/width390 | 三宽度此来源的URL/heading焦点已观察；不扩大为全部来源和生命周期 |
| Employee管理直链 | 对象管理、Dashboard配置、成员访问管理直链均得到404，显示友好“页面不存在” | 三项实际未授权管理路径已观察；不扩大为全部管理路径 |
| Employee SSR鉴权错误 | default SSR401及named SSR403均显示通用“页面加载失败”的权威错误边界，普通retry fallback数量0；注入随后reset0 | 实际401/403未被503普通重试降级吞掉；不替代所有鉴权路径 |
| Admin已开字段抽屉resize | 1440→900：rect `(300,0,600,900)`，保存按钮 `(796,858,88,34)`；继续390：dialog `(0,0,390,844)`，保存可达 | portal缩放和保存可达已观察；Object手机桌面提示有返回路径，不将整个对象编辑称为手机可用 |
| Admin Dashboard草稿/预览/发布 | 首页工作台保存draft1→2；预览实际值；发布#2 | 实际保存/预览/发布路径已观察；未覆盖所有组件操作 |
| Admin Dashboard元配置 | 改名“销售运营工作台 V2 验收”，draft仍2；已发布overview仍显示旧snapshot名称 | 即时元配置与发布快照是不同语义，未据此判定缺陷，也不称overview已同步新名 |
| Admin Dashboard响应式 | 390属性展开入口362×44；resize900后保持展开；1440画布654×720 | 具体布局/入口已观察，不替代所有编辑操作和键盘矩阵 |
| Employee named首页SSR503 | 真实Employee经3102代理看到overview503，个人tasks1/overdue1、完成入口和retry仍可用；代理恢复后实际点击retry，overview恢复，任务仍可见 | named SSR失败隔离与真实恢复已观察；完成入口可用不等于此故障态已实际完成任务 |

上一轮default overview503/auth401/403已有观察只保留其原角色/路由/视口标签，不在本文扩大为本轮全矩阵PASS。自动化覆盖也不替代浏览器观察。

## 3. 工程验证账本

- 当前源码修复：`ea660ca`（record pending freeze）、`c248fe5`（Workflow pending race）；文档提交后的PR head SHA待填。以下为父agent已收集的本地验证，不替代远端门禁。
- 最终fresh全仓 `pnpm test`：**exit0**，Web82 files / **603 unit tests**＋architecture3；`pnpm typecheck` / `pnpm build` / `pnpm contracts:check`：**全部exit0**，由父agent收集bash404结果。
- 首轮曾出现4项dashboard-routes失败（useSearchParams mock返回null），已修并重跑；typecheck首次缺失DATABASE_ADMIN_URL的setup失败在安全inert env下纠正。历史失败不抹去，但不是当前失败。
- 全部changed TS affected ESLint：**0 errors / 1 existing dashboard navigation warning**；`git diff --check`：**exit0**。
- 独立review `c5b14` 发现的Workflow race已由 `c248fe5` 修复，record pending freeze由 `ea660ca` 修复；最终 **107 focused tests PASS，review无阻断**。更早records26/members15聚焦结果保留为过程证据。
- Slice4 PR编号/URL/head SHA：**PENDING — 尚未创建**。
- 远端六项required checks（Typecheck、Contracts、Unit Tests、Database Integration、Build、Critical API E2E）：**PENDING**（最新head SHA/run/逐项状态待填）。历史PR25门禁不等于当前Slice4 CI。

## 4. 剩余浏览器与验收字段

- **完整Admin/Employee ×1440/900/390矩阵：NOT COMPLETE。** 补齐或按实际抽样范围列明记录任务source/create/complete/reschedule/cancel及列表查询上下文返回，不用本节观察补算六格。
- **Employee Followups来源返回焦点：OBSERVED at1440/900/390。** 精确OPEN/page1来源URL与H2“我的跟进待办”实际focus见上表；其他来源/角色、重新挂载与仍挂载全部生命周期不因这三格自动PASS。
- **真实Employee字段草稿/发布对照：OBSERVED at390**，draft8/livev3→publishv4与标签前后见上表；排除 `18800001002` 误标证据。不宣称其余视口已补齐。
- **成员覆盖立即生效与INHERIT恢复：OBSERVED at390**，见上表。**失败校验保留输入仍PENDING**；不得将已观察覆盖流程扩大为所有表单错误路径。
- **记录409/write503/提交成功后refresh503：OBSERVED Employee390。** 失败备注保留、真实提交后的刷新警告及独立API数据核验见上表，不替代其余角色/视口或全部恢复路径。
- **MONEY空输入：一次性测试/setup观察，不是已确认产品限制或当前阻断。** 初次保存曾收到400并补57000；clean reload后正确渲染57000.00、未复现。不归因于新diff，也不将该400误算为503/409证据。
- **剩余管理员编辑/长内容/键盘/关闭回焦点：PENDING。** 对象管理、Dashboard配置、成员访问管理Employee直链404已观察；不扩大为全部配置面授权证明。

## 5. 收尾判断

**批准范围实现及本地验证已完成，可进入PR交付；PR/最新SHA远端六门仍待核实，尚不作合并就绪或已合并声明。** V2现有交付包括公共框架和记录列表、详情下一步/历史与上下文返回、任务优先员工工作台，以及草稿/发布/即时覆盖语义清楚的管理员配置面。冲突输入、提交后刷新失败、SSR故障隔离和权限错误边界已有代表性真实证据，review阻断已修复并验证。

浏览器采用risk-based观察：本文逐路径角色/视口有效，**不声称所有功能×两角色×三宽度完整PASS**；剩余未观察组合、完整键盘/长内容覆盖为已披露验收限制，不笼统否定已实现能力。复杂Object/Workflow390保留桌面边界；Dashboard即时元配置不改旧发布snapshot含义；真实Provider与生产部署不在范围。历史审计只追加Post-merge status，不重写原始矩阵。
