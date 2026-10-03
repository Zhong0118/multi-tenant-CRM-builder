# CRM Product Experience V2 — Slice 1 验收记录

日期：2026-10-03；分支：`codex/crm-product-experience-v2-slice-1`；fetch 基线 `70884f5`。

状态：**IMPLEMENTATION COMPLETE / ACCEPTANCE INCOMPLETE / DRAFT PR / NOT MERGED**。后续 Slice 2–4 保持 PLANNED，仍需后续明确批准。

主体实现提交：`e3be29f`、`ac18f15`、`0696956`、`1e1a9f0`。本轮补移动焦点约束、移动卡片排序/分页/选择与取消搜索草稿同步，修复均先得到正式红测再转绿；独立评审最后未发现新增具体阻断缺陷。

## 环境与范围

隔离 PostgreSQL `crm-v2-browser-postgres`（`127.0.0.1:55434/crm_v2_browser`）、Redis DB 15、API `3101`、Web `3100`；租户 `nebula-demo`。Admin `18800001001`，Employee `18800001003`。未触碰 5432、5433、55433 或生产服务；未修改 CI、后端、权限、发布 schema、依赖和迁移。

浏览器为真实 Playwright Chromium，1440/900/390 CSS px，高度 900。Web 同时设置 `API_ORIGIN` 与 `NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3101`。

## 自动化证据

本轮最终源代码运行：

- `DATABASE_ADMIN_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm test`：exit 0；API 94 suites / 1235 tests；Web 76 files / 504 tests；Web architecture 3 tests，其他 workspace tests 均通过。
- `pnpm --filter @crm/web typecheck`、受改 TSX/test 文件 ESLint、`git diff --check`：exit 0。
- 全仓 `pnpm typecheck`、`pnpm contracts:check`、`pnpm build`（上述 DATABASE_ADMIN_URL 占位）：exit 0；contracts 生成无漂移。
- 新增聚焦红测：移动反向边界焦点、resize 后仍打开、取消搜索后草稿不一致、卡片排序/分页/选择不可达；最终 app-shell 17 tests + record-list 26 tests 通过。
- 全 Web lint **不通过**。同一 ESLint/配置对比临时 `git archive origin/main apps/web` 基线（不操作旧 root main）：基线 266 files / 6 errors / 5 warnings；实现分支 266 files / 4 errors / 5 warnings。四项同源既有错误分别是 `ai-assistant-page.tsx:46` refs、`tool-activity.tsx:16`、`follow-up-panel.tsx:74`、`workflow-designer.tsx:72` set-state-in-effect。五项 warnings 相同；本轮受改文件 lint 通过，不混修既有错误。

## 浏览器验收

PASS 仅代表该格描述的实际路径；NOT OBSERVED 代表没有完整浏览器证据，不用自动化替换浏览器结果。

| 验收项 | 1440 | 900 | 390 |
|---|---|---|---|
| 两角色身份、导航/可见分组 | 前轮 PASS | 前轮 Admin PASS；Employee 本轮列表可达 | 两角色列表可达；Employee 导航焦点本轮 PASS |
| 两角色搜索→排序→第二页→详情→关闭返回 | PASS | PASS | PASS，新增卡片排序和分页 |
| URL 保持 | `page=2&search=V2验收线索&direction=desc` | 同左 | `page=2&search=V2验收线索&sort=updatedAt` |
| 页面水平溢出 | 无，PASS | 无，PASS | 无，PASS |
| 筛选空结果清除恢复 | 自动化 PASS；完整浏览器矩阵 NOT OBSERVED | NOT OBSERVED | Employee PASS，保留 updatedAt 排序 |
| 保存视图→清除→应用恢复 | 自动化 PASS；浏览器 NOT OBSERVED | NOT OBSERVED | Employee PASS，`Slice1 mobile view` 恢复搜索/排序 |
| 真实请求失败→同查询重试 | 自动化 PASS；浏览器 NOT OBSERVED | NOT OBSERVED | Employee PASS，Playwright 对 records 请求注入 503，移除 route 后 retry URL 不变 |
| 移动导航焦点与 resize | 不适用 | 从390切入后解除 inert；桌面 preference 不变 | Employee PASS；Shift+Tab 首项回到末项，25次Tab无背景焦点；Escape回打开按钮；390→900→390保持关闭 |
| 卡片选择→批量修改 | table 自动化 PASS | table 自动化 PASS | Employee PASS，选择1条可打开“批量修改1条”；未执行批量写入 |
| 新建/编辑/导入/导出/列设置完整操作 | 自动化覆盖；完整浏览器矩阵 NOT OBSERVED | NOT OBSERVED | 菜单与详情入口可达；完整提交/导入/下载 NOT OBSERVED |
| 长字段/长标题 | fixture 已有；完整观察 NOT OBSERVED | NOT OBSERVED | 240字 note fixture 创建；完整浏览器观察 NOT OBSERVED |
| Shared Shell 平台/工作台/AI | 相关全套自动化 PASS；平台/AI 完整浏览器复测 NOT OBSERVED | 同左 | Employee工作台实际可达；AI确认交互浏览器 NOT OBSERVED |

## 数据权限证据

独立 HTTP 实测（不把侧栏分组或默认列当权限证明）：Employee memberId `7344bfda-ce80-4e7d-89da-45731d3fde97`；Admin leads 39 条，Employee 25 条。Employee runtime `readScope/updateScope=OWN`，create/read/update true、delete false；Admin ALL、delete true。Employee limit=10 第1/2页各10条，返回记录负责人均为该 employee。Admin 可见其他负责人记录；Employee GET 另一负责人记录 `a82b87ad-55de-41d6-a9e2-89df253d7bb2` 返回 `404 RECORD_NOT_FOUND`。**OWN HTTP PASS**，浏览器逐条全记录核对 NOT OBSERVED。

**HIDDEN NOT OBSERVED / FIXTURE SETUP GAP**：当前 runtime leads 的 Admin/Employee 字段均为 name/phone/source/status/note，Employee 无 HIDDEN 字段。未修改现有权限或 publication 来伪造通过。HIDDEN 的已有自动化测试通过，但本轮尚未构造真实隐藏字段的 browser/API 对照场景。

新增隔离 fixture `2e6a7a9f-e78e-433a-9d4e-52aeeb956221`（recordNo39，本人所有），note 240字；name 的既有 published maxLength 为100。分页 API 使用 `limit`，非 `pageSize`。

## 已知限制与合并影响

- HIDDEN 场景、完整浏览器能力矩阵、长内容矩阵及平台/AI确认交互尚缺证据：**验收阻断，保持 Draft，尚不能宣称 Slice1 验收完整完成或开始 Slice2**。
- 既有全 Web lint 四项错误：与 baseline 相同，不是本轮新增；不属于六项 required checks，也不修改 CI 绕过它们。
- 无 published workflow 的 fixture 详情 workflow GET 返回409，属于既有业务状态；Next dev/jsdom getComputedStyle 噪声不作产品失败。
- 历史 AI E2E hardcode `55433/crm_v1b_test` 属独立 setup 问题；本轮未使用该库，未验证真实 Provider/生产部署。
- 六项远端检查以 Draft PR 最新 SHA 实查为准；本地测试通过不替代 Database Integration / Critical API E2E 的远端状态。
