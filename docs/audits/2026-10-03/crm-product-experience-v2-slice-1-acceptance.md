# CRM Product Experience V2 — Slice 1 验收记录

日期：2026-10-03  
分支：`codex/crm-product-experience-v2-slice-1`  
实现提交：`e3be29f`、`ac18f15`、`0696956`、`1e1a9f0`  
环境：隔离 PostgreSQL `crm-v2-browser-postgres`（`127.0.0.1:55434/crm_v2_browser`）、API `3101`、Web `3100`；租户 `nebula-demo`。未触碰 PostgreSQL `5432`、`5433` 或既有业务服务。

## 自动化证据

- Task 0 正式 records 回归：114 tests passed；导航复现脚本：7 tests passed。
- Shell/layout focused suite：33 tests passed；补充 review 修复后 records/workspace/list/layout：55 tests passed。
- Web typecheck：passed；受影响文件 ESLint：passed；`git diff --check`：passed。
- 红测已保留在实现过程：B01 搜索同步、B02 卸载防抖、B03 详情关闭排序；Task 2 管理筛选视图、筛选空态恢复、接口失败重试也先有失败再转绿。

## 浏览器验收

浏览器账号：Admin `18800001001`、Employee `18800001003`；视口高度 900。

| 验收项 | 1440 | 900 | 390 |
|---|---|---|---|
| Admin/Employee 导航、租户身份、可达操作 | Admin PASS；Employee PASS；Admin 分组可见 | Admin PASS；侧栏 64px | Admin/Employee PASS；移动导航打开/关闭可用 |
| 已发布默认列、HIDDEN 字段、OWN 数据隔离 | Admin 页面可见发布列；Employee 仅工作/业务数据组 | 抽查通过，无页面横溢出 | 卡片布局、无页面横溢出 |
| 搜索/视图/筛选/排序/分页→详情→返回保持状态 | 自动化 PASS；浏览器详情关闭保留 `page=2&sort=updatedAt&direction=desc` | 自动化 PASS | 移动入口可达；完整多状态移动复测未观察 |
| 空结果清除、接口失败重试、长字段/长标题 | 自动化 PASS；浏览器长记录 fixture 已创建 | 自动化 PASS | 未观察 |
| 页面无水平溢出，表格只在自身横向滚动 | PASS，`scrollWidth=1440` | PASS，`scrollWidth=900` | PASS，`scrollWidth=390`，卡片布局 |
| 键盘操作、弹层关闭回焦点、移动导航回焦点 | 筛选视图 Drawer 可关闭；部分键盘循环未观察 | 同左 | Escape 关闭导航并回焦点到“打开导航”；Drawer 完整焦点循环未观察 |
| 新建/编辑/批量/导入导出能力保持 | 权限按钮和菜单可达；records 自动化覆盖 | 抽查 | 移动完整能力未观察 |

### 已观察的限制

- Next.js dev overlay 的 `getComputedStyle`/控制台噪声不作为产品失败；API workflow 面板对无流程记录返回的 409 是现有业务状态提示，不影响本切片导航与列表验收。
- 移动导航打开后，Tab 焦点可到达背景内容；这是本切片前已有行为，未作为本轮新增回归修复，后续应补 modal focus containment/inert。
- 真实浏览器未覆盖所有空态、API 失败注入、员工 OWN 记录逐条对照和完整 1440/900/390 全矩阵；这些写为未观察而非 PASS。

后续切片仍保持 `PLANNED`，本记录不宣称 AI Provider、生产部署或 CI required checks 已验证。
