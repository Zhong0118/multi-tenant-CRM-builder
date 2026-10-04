# CRM Product Experience V2 — Slice 1 验收记录

日期：2026-10-03；分支：`codex/crm-product-experience-v2-slice-1`；fetch 基线 `70884f5`。

状态：**IMPLEMENTATION COMPLETE / SLICE 1 BROWSER ACCEPTANCE PASS / DRAFT PR / NOT MERGED**。批准范围内浏览器路径已完成，保留以下已分类setup/既有lint限制；最终提交六门另以最新SHA实查。后续 Slice 2–4 保持 PLANNED，仍需后续明确批准。

主体实现提交：`e3be29f`、`ac18f15`、`0696956`、`1e1a9f0`。本轮补移动焦点约束、移动卡片排序/分页/选择与取消搜索草稿同步，修复均先得到正式红测再转绿；独立评审最后未发现新增具体阻断缺陷。

## 环境与范围

隔离 PostgreSQL `crm-v2-browser-postgres`（`127.0.0.1:55434/crm_v2_browser`）、Redis DB 15、API `3101`、Web `3100`；租户 `nebula-demo`。Admin `18800001001`，Employee `18800001003`。未触碰 5432、5433、55433 或生产服务；未修改 CI、后端源码、既有业务权限/发布 schema、依赖和迁移；续轮4新增独立验收对象并通过现有API发布，仅写隔离fixture。

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
| 筛选空结果清除恢复 | 两角色PASS（续轮2） | 两角色PASS（续轮2） | 两角色PASS，保留updatedAt排序 |
| 保存视图→清除→应用恢复 | 两角色PASS（续轮3） | 两角色PASS（续轮3） | 两角色PASS（续轮3） |
| 真实请求失败→同查询重试 | 两角色PASS（续轮2） | 两角色PASS（续轮2） | 两角色PASS，503移除后retry URL不变 |
| 移动导航焦点与 resize | 不适用 | 从390切入后解除 inert；桌面 preference 不变 | Employee PASS；Shift+Tab 首项回到末项，25次Tab无背景焦点；Escape回打开按钮；390→900→390保持关闭 |
| 选择→批量修改 | 两角色实际写入并详情核对PASS | 两角色菜单键盘/回焦点PASS；写入按计划抽测1440 | 两角色实际卡片批量写入PASS，键盘/回焦点PASS |
| 新建/编辑/导入/导出/列设置 | 两角色PASS，续轮6/7；桌面批量续轮9 PASS | 两角色表单/文件PASS，批量仅桌面1440抽测 | 两角色新建编辑及CSV PASS；Admin列设置PASS，Employee批量PASS |
| 长字段/长标题 | Admin长标题及Employee长字段入口/焦点PASS | 固定动作可见、表格自身滚动PASS | 长内容换行、底部动作可滚动到达并聚焦PASS，截图见下 |
| Shared Shell 平台/工作台/AI | 平台总览、Employee工作台/AI展示PASS | 同左 | 同左；两角色Fake AI确认/拒绝PASS，拒绝前后activities独立核对一致 |

## 数据权限证据

独立 HTTP 实测（不把侧栏分组或默认列当权限证明）：Employee memberId `7344bfda-ce80-4e7d-89da-45731d3fde97`；Admin leads 39 条，Employee 25 条。Employee runtime `readScope/updateScope=OWN`，create/read/update true、delete false；Admin ALL、delete true。Employee limit=10 第1/2页各10条，返回记录负责人均为该 employee。Admin 可见其他负责人记录；Employee GET 另一负责人记录 `a82b87ad-55de-41d6-a9e2-89df253d7bb2` 返回 `404 RECORD_NOT_FOUND`。**OWN HTTP PASS**，浏览器逐条全记录核对 NOT OBSERVED。

**HIDDEN PASS（独立published fixture）**：leads本身无HIDDEN字段；续轮4通过独立 `slice1-hidden-probe` 构造真实API与两角色三宽度浏览器对照，Employee schema元数据及记录键均省略，Admin保留。证据见本记录续轮4及同目录JSON。未修改现有业务对象的权限或publication。

新增隔离 fixture `2e6a7a9f-e78e-433a-9d4e-52aeeb956221`（recordNo39，本人所有），note 240字；name 的既有 published maxLength 为100。分页 API 使用 `limit`，非 `pageSize`。

## 后续验收补测（自动续轮1，未改变产品源码）

- 重新实查 PR#24 最新 SHA `fdc7a7d643a2445cf529716d4baf30f1d1430d8c`，Draft=true；六项 required checks 均 SUCCESS，run37115563922。
- Admin390 实际新建长标题/长备注记录 `254bdf64-4c29-4dbc-95d7-d607ea44b036`（recordNo40）；通过详情编辑备注并保存后可见更新值。
- 此长记录在1440/900/390详情中备注可见；各宽度列表查看入口可见，页面均无水平溢出。尚不能替代完整视觉截断/焦点矩阵。
- Admin390实际下载 `leads.csv`，读取流验证业务编号40、长标题、更新备注；取消个人备注列后再次下载，CSV不含备注列；恢复默认列。
- Admin390上传单行CSV（线索名称/跟进状态/线索备注自动映射），提交后通过搜索 `Slice1导入验收` 验证导入记录可见。只写隔离fixture。
- HIDDEN进一步诊断：成员对象权限PUT payload `fields:{note:"HIDDEN"}` 返回400 VALIDATION_FAILED，fieldErrors.fields=`property fields should not exist`；前后GET验证仍INHERIT/override null。字段权限只能来自published employeeAccess，未改schema/source或SQL绕过。因此HIDDEN仍NOT OBSERVED，不能把普通字段投影当通过。证据保存在本机 `/tmp/crm-slice1-hidden.json`。

## 后续验收补测（自动续轮2）

- Admin/Employee ×1440/900/390：无结果搜索后清除恢复，保持 `sort=updatedAt&direction=desc`；注入503后移除route并重试，URL相同、真实记录恢复；六格全部PASS且无页面溢出。
- Employee工作台三宽度标题与跟进/统计内容可见，页面无溢出；AI页面三宽度输入框可见、“需确认后执行”提示保留，无溢出。未调用真实Provider，Proposal确认仍NOT OBSERVED。
- 实际浏览器发现桌面空结果同时显示卡片与Table的清除按钮；最小修复给卡片空态复用cardList响应式包装。刷新后1440/900/390均只有1个可见清除按钮，无溢出。受影响record-list26 tests、Web typecheck、该文件ESLint和diff-check均exit0。

## 后续验收补测（自动续轮3）

- Admin/Employee ×1440/900/390：保存具名视图（search=V2、updatedAt desc），清除条件后应用恢复；六格均PASS。
- 使用既有隔离平台管理员18800001999（未提升其他用户权限）登录；平台总览1440/900/390均可达，平台标题/事项内容可见，无水平溢出。Employee直接访问/platform返回自己工作台，未进入平台管理。
- 使用现有test-only FakeAiProvider（NODE_ENV=test / AI_PROVIDER=fake）重启隔离API；Employee发送 ADD_ACTIVITY_NOTE proposal，出现HTTP note/待确认；1440/900/390确认与拒绝按钮可见、无溢出。390手动确认后显示已执行和审计ID `01a10158-9c66-7361-bfbe-14baa2ed3d62`，目标记录 `2e6a7a9f-e78e-433a-9d4e-52aeeb956221` 详情出现HTTP note。仅写隔离fixture，不调用真实Provider；此确认路径PASS。HIDDEN字段权限需要独立published fixture，目前无该场景，保持NOT OBSERVED。
- 源码提交 `5edc9c254f86e26c587ab084b369eaeaa336477f` 已push；CI run37117006767六项required checks全部SUCCESS。后续文档提交仍须核对最新SHA。

## 后续验收补测（自动续轮4）

- 最新文档SHA `bf2be503ea57c1c12f0669316f4dfab2ea71679d` run37117174806六项required checks全部SUCCESS；PR#24仍Draft。
- Employee390实际新建本人记录 `2bfbf880-284d-481a-935a-b4bf650368bd`，编辑备注保存成功；卡片选择→批量修改备注→提交→再次打开详情核对更新值，PASS。
- Employee390导出CSV并读取流，包含批量修改后的备注；通过CSV映射提交导入，搜索验证本人导入记录可见，PASS。
- 独立published对象 `slice1-hidden-probe` 已通过现有draft/analysis/publish API创建（analysis无阻断/警告），21条employee-owned记录。HIDDEN API投影24/24断言通过：Admin含完整hidden_probe字段元数据及columns/search键，list/detail含标记；Employee schema省略整项元数据，list/detail/page2省略字段键，secret搜索Admin21/Employee0。updatedAt desc默认排序、分页20+1。未修改现有leads。
- 父agent独立浏览器复核Admin/Employee×1440/900/390列表和详情：Admin标记可见，Employee无标记，六格无溢出。该HIDDEN场景PASS，取代前几轮setup gap；脱敏证据见同目录 `crm-product-experience-v2-hidden-evidence.json`。其他未补齐矩阵不因此标PASS。

## 后续验收补测（自动续轮6）

- Employee1440/900实际新建本人记录、详情编辑保存、搜索导出读取CSV更新值；取消备注列后再次下载确认列省略，恢复默认列；上传映射CSV提交后搜索导入记录可见，全部PASS，无页面溢出。
- 记录1440 `ae326a99-e953-4fef-bc4a-460d68e493ad`、900 `ebb954ef-e128-42cf-a438-d87c6fb42707`。采用单格多次短调用，避免超时后把未返回的整体矩阵当通过。

## 后续验收补测（自动续轮7）

- Admin1440/900独立核对 `Slice1矩阵-Admin-{width}` 详情编辑值；下载读取流均包含编辑备注。个人列取消备注后再次下载，CSV保留目标记录且省略备注列；恢复默认。两宽度实际CSV映射导入提交后搜索可见，无页面溢出，PASS。
- 1440第一次详情关闭后立即菜单操作遇元素重挂载超时；拆开调用重试返回上述具体结果，不将首次超时当作内容验证通过。

## 后续验收补测（自动续轮8）

- 对照Task3逐项检查，补加载完成截图与焦点证据：Admin长标题列表1440/900/390查看按钮可聚焦；900截图固定操作列可见、标题在表格滚动区域内，390长标题在卡片换行。截图存同目录slice-1-browser-evidence；初次loading截图不作为稳定视觉验收。
- Employee本人长字段列表三宽度查看入口可见，无页面水平溢出；截图保存。
- Employee三宽度键盘Enter打开视图管理，关闭动画结束、dialog hidden后焦点回管理按钮，PASS。初始点击后立即检查false是动画尚未结束，未据此修改源码。
- Admin视图管理弹层三宽度经键盘打开、关闭按钮关闭并等待dialog hidden后均回焦点。两角色1440桌面批量修改备注后重新打开详情核对更新值，PASS。
- 两角色×1440/900/390对独立对象 `slice1-hidden-probe?page=2` 打开详情后按Escape，返回URL保留第二页；该对象发布默认排序updatedAt desc，分页20+1。

## 后续验收补测（自动续轮11）

- Employee390取消个人备注列→导出读取CSV，目标记录仍在、备注列省略；恢复默认列，PASS。Admin390卡片选择→批量备注提交，详情核对 `Slice1 Admin390批量确认`，PASS。
- Admin390 Fake AI ADD_ACTIVITY_NOTE：proposal确认后已执行，审计ID `01a10193-14ba-7d5d-b254-ba9a6ee8b8d0`；再发送proposal并拒绝，显示已拒绝/未写入数据。真实Provider未调用；拒绝数据无变化尚未独立读取核对。
- PR#24最新f75d194六项required checks全部SUCCESS；本轮后续文档提交仍需核对新SHA。

## 后续验收补测（自动续轮12）

- Admin与Employee390各重新提出ADD_ACTIVITY_NOTE并拒绝；独立读取activities API前后完整JSON一致、各total=1，无新增备注。Admin此前确认备注HTTP note也由该API读到，确认/拒绝数据路径PASS，仅Fake Provider。
- 两角色×1440/900/390：键盘Enter打开更多操作，列设置/导入CSV菜单项键盘Enter打开，关闭弹层后等待实际焦点条件，全部回到更多操作按钮，12格PASS。立即检查body焦点属于动画尚未结束，未据此改源码。
- 仍需批量弹层键盘回焦点的逐角色三宽度复核；AI和两项移动缺口已补齐，早期限制为历史状态。

## 当前页批量选择修复（本次合并前）

- 用户补充手机复现：第一页选A、第二页选B，菜单累计2但抽屉与请求仅有B。原先单页验收不覆盖该边界，不能作为跨页一致性的证明。
- 正式两页交互回归先复现手机菜单数量错误；桌面入口同测，验证菜单、抽屉数量和实际请求只包含第二页B及其observed version。外部筛选URL变化且记录仍存在时，两种选择均清空。
- 最小修复将选择明确限定当前查询页；查询范围变化清空选择，菜单/表格/卡片/抽屉共用当前页记录投影，不增加跨页批量能力。
- 本地验证：RecordList29 + BatchEdit1测试、Web typecheck、两受改文件ESLint、diff-check全部exit0；jsdom既有pseudo-element提示保留，无unhandled errors。远端最新SHA门禁与浏览器边界证据另据实际结果记录。
- 本轮用户明确授权Slice1门禁通过后Ready/合并，并从最新主线联合实现Slice2＋3；Slice4与部署未授权。

## 已知限制与合并影响

- 本轮完成已观察证据的汇总与视觉核对；稳定截图见 [Admin900](slice-1-browser-evidence/admin-long-900.png)、[Admin390](slice-1-browser-evidence/admin-long-390.png)、[Employee390底部动作](slice-1-browser-evidence/employee-long-390-actions.png)。
- 续轮13补批量弹层两角色×1440/900/390：选择记录，键盘打开更多操作及批量菜单，关闭后等待焦点返回更多操作，六格PASS。批准的Task3浏览器矩阵完成；早期NOT OBSERVED按各续轮证据取代，900批量按计划抽查复用桌面能力。仍保持Draft/NOT MERGED，Slice2未批准。
- 既有全 Web lint 四项错误：与 baseline 相同，不是本轮新增；不属于六项 required checks，也不修改 CI 绕过它们。
- 无 published workflow 的 fixture 详情 workflow GET 返回409，属于既有业务状态；Next dev/jsdom getComputedStyle 噪声不作产品失败。
- 历史 AI E2E hardcode `55433/crm_v1b_test` 属独立 setup 问题；本轮未使用该库，未验证真实 Provider/生产部署。
- 六项远端检查以 Draft PR 最新 SHA 实查为准；本地测试通过不替代 Database Integration / Critical API E2E 的远端状态。


## Post-merge status

2026-10-04 PR #24已按仓库保护合并，merge `9cd2523319557d47fd877646716b01698d7e1193`；合并前最新 `4484ed9` 六门SUCCESS，run37198879692，无未解决review thread。此节不回填、不重算历史验收。手机390当前页回归确认第二页选择后菜单与抽屉均1条；两页手机/桌面真实组件请求断言见正式测试。当前用户已批准Slice2＋3联合实现，Slice4与部署未批准。
