# 版式重做 · 实施说明（给并行执行者）

设计决定见 `design-notes.md` 的「第 02 轮」；标杆的逐元素拆解见 `reference/admin/benchmarks.md`（图在同目录，先打开对应的图再动手）。风格不变：青绿 `var(--color-primary)`、浅灰外壳、白色圆角主区、发丝线表格。**这一轮只改版式：每个区域放什么、按钮在哪、怎样排。**

## 共享件（只用，不改）

| 文件 | 用途 |
| --- | --- |
| `apps/web/src/components/layout/page.tsx` | `Page`（`width="wide"` 管理列表 ≤1200px、`"form"` 表单 ≤720px、`"full"`、`"bleed"`）、`PageToolbar`（`start` 左侧搜索与筛选，`end` 右侧操作）、`PageSection`（区块标题在内容外面） |
| `apps/web/src/components/layout/page-header.tsx` | `PageHeader`：`breadcrumb`、`title`、`count`（标题旁的灰色数字）、`status`、`description`（最多一行）、`extra`（右侧按钮，主按钮放最后） |
| `apps/web/src/components/workbench/status-tag.tsx` | 状态标签 |
| `apps/web/src/features/records/record-row-actions.tsx` | 行尾「⋯」菜单的写法参考（图标 `aria-hidden`、危险项放最后并先确认、无权限的项保留并写明原因） |

**不要修改**：`apps/web/src/app/globals.css`、`apps/web/src/app/providers.tsx`、`apps/web/src/components/layout/*`、`apps/web/src/components/navigation/*`、`apps/web/src/features/records/*`、别的执行者负责的目录。需要共享件做不到的东西，在你自己的模块 CSS 里写，并在报告里说明。

外壳已经改好：主区（`main`）没有内边距，每个工作区页面必须自己包一层 `Page`。成员、审计、`/settings/**` 在「设置区」里，侧栏会自动换成设置导航。

## 控件语法（所有页面一致）

- 页头：`PageHeader`，标题 20px；说明只写一句真正有用的话，没有就不写；按钮在右，主按钮最后。不要在页头下面再放一段解释。
- 工具行：`PageToolbar`。左边搜索框（antd `Input`，`prefix={<SearchOutlined aria-hidden />}`，宽约 260px，`allowClear`）加筛选下拉；右边次要按钮在前、主按钮在后。
- 表格：antd `Table`（主题已是发丝线、无竖线）。第一列「主体」：28px 圆形首字头像或业务表图标 + 名称（14px、500）+ 下一行灰色辅助信息（13px）。行操作一律收进最后一列的「⋯」菜单（`Dropdown` + `type="text"` 图标按钮，`aria-label="更多操作 <名称>"`），**不要在行里放一排文字链接或红框按钮**。
- 头像：28px 圆、`var(--color-primary-soft)` 底、`var(--color-primary)` 字、取名字第一个字。
- 弹窗：新增 / 邀请这类短表单用 antd `Modal`（宽 520px），长表单或带预览的用 `Drawer`（宽 560px）。
- 空状态：`Empty` 简洁图 + 一句话 + 至多一个按钮，放在表格区域里，不要单独再套一个卡片。
- 文字不小于 13px；颜色只用 `globals.css` 里的变量；不加渐变、彩色侧边线、卡片套卡片、标题上方的英文小标签。
- 所有文案用中文；面向公司管理员，写人话（「邀请成员」，不是「发送邀请请求」）。

## 环境

- 浏览器验证用已在运行的服务：网页 `http://localhost:3300`、接口 `http://localhost:3301`（`next dev` 与 `nest --watch`，改代码会热更新）。**不要重启或另起服务，不要动数据库结构。**
- 已登录的会话：`/tmp/ui-env/state-admin.json`（刘洋，公司管理员）、`/tmp/ui-env/state-employee.json`（李昂，员工）；公司代码 `nebula-demo`。
- 截图：`node /tmp/ui-env/look.mjs <admin|employee> <路径，如 /members> <输出.png> [宽度] ['可选的 playwright 步骤，如 await page.click("text=邀请成员")']`。截图放到 `docs/design/2026-10-21-layout-overhaul/shots/<你的前缀>-*.png`，自己用 Read 打开看。
- 类型检查：在 `apps/web` 下 `npx tsc --noEmit -p .`；单测：`npx vitest run <你改过的测试文件或目录>`；lint：`npx eslint <你改过的文件>`。别的执行者正在同时改其他目录，类型检查里出现的不是你文件的错误不用管，但要在报告里提一句。
- 不要 `git commit`、`git stash`、切分支；只改工作区文件。

## 交付

1. 页面在 1440×900 和 390 宽都能用；截图自己看过，改掉重叠、截断和空洞。
2. 既有功能不能丢：每个按钮、菜单项、确认、错误提示、权限判断都要还在（可以换位置）。因为结构变化而失效的单测要改成测新结构，不要删掉断言了事；新交互补测试。
3. 回报（≤500 字）：改了哪些文件、页面现在的结构（自上而下）、哪些既有功能换了位置、测试结果（命令与通过数）、截图路径、没做完或拿不准的地方。
