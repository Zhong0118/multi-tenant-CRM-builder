# Excel / CSV 导入第一批验收

在本地隔离的演示公司通过浏览器登录刘洋、赵晨和孙悦的账号，使用真实导入 API 和 PostgreSQL。下列文件均为合成数据。普通导入可在所有套餐使用，仍须具有业务表导入权限。代码没有数据库迁移。

| 浏览器操作 | 结果 |
| --- | --- |
| 刘洋上传含标题、空行的客户清单 | 一次读文件即选中物理第 3 行。3 行数据映射到 2 位负责人，将「拜访来源」追加到「客户备注」，按客户名称查重。检查显示可导入 2、重复 1。 |
| 刘洋点击确认 | 数据库中「星桥设备」归赵晨，「云帆贸易」归孙悦，各 1 条。星桥的原备注「下周回访」后另起一行「拜访来源：行业展会」。 |
| 模拟服务器已写入，浏览器未收到第二组成功响应 | 浏览器显示确认成功 1 行，其余待重查。重新检查后可导入 0、重复或已导入 1。库内两条记录各 1 条，保留各自原负责人。自动化另覆盖并发重试和写入审计。 |
| 赵晨上传含「业务员：孙悦」的文件 | 业务员列禁选，页面提示仅公司管理员可按行指定负责人。确认后数据库中记录实际归赵晨。 |
| 孙悦向跟进活动表导入上海时间 2026-08-21 10:30 | 数据库存入 2026-08-21T02:30:00.000Z，重新打开详情页显示 2026-08-21 10:30。另一个值 20240305 保存为日历日期 2024-03-05。 |
| 孙悦向合同表导入 40 列文件 | 两种宽度下都有 40 个纵向对照行，页面和抽屉正文均无横向溢出。12万 保存为 120000.00，合同编号 000090 保留前导零，2024年3月5日 保存为 2024-03-05。 |

规则识别、手工对照、检查和确认后，浏览器验收数据库的 ai_model_calls 仍为 0。既有记录中的日期时间不会回写。旧版把不带偏移的时间按 UTC 处理，上海企业的旧记录可能相差 8 小时。

## 主流程截图

截图尺寸以 CSS 视口为准，PNG 保留设备的双倍像素。

| 主流程 | 1440 × 900 | 1280 × 800 |
| --- | --- | --- |
| 自动选第 3 行，选择追加目标 | [表头与映射](01-header-mapping-1440.png) | [表头与映射](01-header-mapping-1280.png) |
| 展开负责人和检查结果 | [按人检查](02-owner-check-1440.png) | [按人检查](02-owner-check-1280.png) |
| 确认后显示实际结果 | [导入完成](03-imported-1440.png) | [导入完成](03-imported-1280.png) |

同一组文件在修改前的阶段 B 前端（fc2a35a）也走了一遍。原文件把一格标题当表头，读文件就报错。移除前两行后，「客户名称：」仍须手动指定，而且只能为整批选同一负责人。第三张旧版截图只执行检查，未提交写入。

| 修改前 | 1440 × 900 | 1280 × 800 |
| --- | --- | --- |
| 原文件包含前导标题 | [表头错误](before-01-header-error-1440.png) | [表头错误](before-01-header-error-1280.png) |
| 移除前导行，仍须手动对列 | [手动对列](before-02-manual-mapping-1440.png) | [手动对列](before-02-manual-mapping-1280.png) |
| 手工指定客户名称后检查 | [旧版检查](before-03-check-1440.png) | [旧版检查](before-03-check-1280.png) |

## 自动化验证

| 范围 | 本次结果 |
| --- | --- |
| 全仓 pnpm typecheck、contracts:check | 通过 |
| API 单元测试 | 2,072 通过，4 项原有跳过 |
| Web 单元与组件测试 | 1,505 通过 |
| 全量 API E2E，真实 PostgreSQL | 46 个测试文件、463 项通过 |
| 数据库集成、数据库结构、契约、Web 架构、Worker | 分别 110、10、14、3、2 项通过 |
| 变更的导入和时区相关 Web 文件 ESLint、git diff --check | 通过 |

## 既有 AI 模拟评测回归

助手、整理沟通、一句话筛选和 AI 建表共六份报告，与原分支留存的模拟报告逐行一致。在 #90 的 fc2a35a 与本次代码上分别跑销售日常的开发集和留出集，今日建议均为 20/20、10/10，帮我写均为 20/30、7/10，写日报均为 15/15、5/5。这组分数反映固定模拟输出能覆盖的样本。导入本身的真实模型评测安排在第二批。

## 第 2 节核对表

此次所有文件对照均在浏览器完成。第二批才会有模型入口。表内列出的第二批验证均为待验收项。

| 规则 | 本批证据或下一批的验证点 |
| --- | --- |
| 已发布表、导入权限、可导入字段、正式写入重新授权 | [抽屉测试](../../../../apps/web/src/features/records/record-import.test.tsx) 验证检查通过后字段变只读会撤销可确认状态，查重字段跟随可见范围。[API 测试](../../../../apps/api/src/modules/records/records.service.spec.ts) 覆盖只读和隐藏查重字段、记录可见范围、隐藏必填字段的错误消息。 |
| AI 专项套餐、缺权限 403、调用前后重新计算权限和发布版本 | 第二批对 import-assist 做直接 HTTP 验证，含调用中撤权。普通导入本批不设 AI 套餐门槛。 |
| 摘要只含当前表的受限投影、未解列与取值，单列 5 个样例、低基数 ≤50 附频数、单值 40 码点 | 本批直接使用本地文件。第二批检查浏览器请求和 provider 实际入参，包括规则已解、人工锁定、高基数、修改表头等情形。 |
| 负责人列整列隔离，成员对照仅在本地；系统、只读、隐藏字段及键名碰撞不外发 | [负责人解析](../../../../apps/web/src/features/records/record-import-groups.test.ts) 与员工抽屉测试覆盖本地归属。第二批在所有候选表头、前十行、枚举及样例中植入受限字段哨兵，断言模型收包中零命中。 |
| 服务端重新识别并先打码再截断，覆盖手机、座机、邮箱、身份证、银行卡，包括标题和选项 | 第二批直接构造未经清洗的请求，在模拟 provider 收包处断言。实际出站安全不能由本批零调用证明。 |
| 字段与枚举只用当次短引用，遮挡后同形的值由独立 ID 回填；模型不得接收成员名单、业务记录或完整文件 | 第二批覆盖碰撞、越界、跨字段和跨请求引用。 |
| 不明自由文本和前导区只给形状，安全列只给必要样例；预览发送范围，允许按整列排除 | 第二批验证隐藏列伪装、疑似人名、夹带指令和用户手动排除。 |
| 浏览器 ≤80 KiB、厂商输入 ≤48 KiB。预算不足先少发，保留引用完整性，没有待解内容零调用 | 第二批测 UTF-8 字节、多字节宽表、预算裁剪和无调用路径。此处上限与普通导入的单批 HTTP 大小不同。 |
| 治理入口、限流、预占与取消结算、审计和错误不记录原文 | 第二批对治理账本和日志做内容哨兵断言。本批浏览器实测确认零模型调用。 |

## 第 5 节核对表

| 分组、查重和重试规则 | 对应证据 |
| --- | --- |
| 在职且姓名精确唯一才自动匹配。重复姓名、空值、停用与未匹配待选择 | [分组测试](../../../../apps/web/src/features/records/record-import-groups.test.ts) 的 matches exact names。覆盖空值、内部空格、同名和停用。 |
| 管理员可选成员、已启用初始池或跳过。员工省略归属参数。禁用公共池、跨租户成员及员工伪造均须拒绝 | [抽屉测试](../../../../apps/web/src/features/records/record-import.test.tsx) 的 admin resolution、initial pool、employee assignment；[真实 HTTP 测试](../../../../apps/api/test/record-pool-lifecycle.e2e-spec.ts) 的 validates group ownership 对检查和写入均断言。 |
| 原始字节与工作表决定 batchId，表头、批次或归属不改变源行号 | [文件测试](../../../../apps/web/src/features/records/record-import-file.test.ts) 的 same bytes、third physical CSV line、absolute column positions；[分组测试](../../../../apps/web/src/features/records/record-import-groups.test.ts) 核对各组实际请求。 |
| 同一批次共享查重字段，串行 dryRun。每批 ≤100 行、行 ≤80 KiB、包约 90 KiB | [批处理测试](../../../../apps/web/src/features/records/record-import-batches.test.ts) 的 601 rows 和 UTF-8 request bodies；分组测试覆盖分组内跨 100 行。 |
| 查重限可查询字段及本人可读范围，空查重值失败。本机第一行失败时允许下一条有效行保留 | [API 单测](../../../../apps/api/src/modules/records/records.service.spec.ts) 的 requires submitted match fields、forbids matching without read access；[分组测试](../../../../apps/web/src/features/records/record-import-groups.test.ts) 和真实 HTTP 测试覆盖先失败及两个员工可见结果不同。 |
| 收齐检查后使用服务端 READY.matchKey 按源行号择首，无查重字段则不做业务键比较；中断不能确认 | [分组测试](../../../../apps/web/src/features/records/record-import-groups.test.ts) 的 checks owners serially、rejects a cancelled or incomplete run；[API 单测](../../../../apps/api/src/modules/records/records.service.spec.ts) 的 stable opaque matching keys 与 emits matching keys only for READY。 |
| 确认只写 READY。并发重复改为实际 SKIPPED。跳过、失败、成功合并显示 | [分组测试](../../../../apps/web/src/features/records/record-import-groups.test.ts) 验证实际请求行集及原顺序；[真实 HTTP 测试](../../../../apps/api/test/record-pool-lifecycle.e2e-spec.ts) 的 checks owner groups 包含确认前另一批新增同键记录。 |
| 丢响应标为待重查。相同文件重试不二次创建、不改派，已收到的成功项保留。检查不写审计、行凭据或业务记录 | 本报告的浏览器中断演练；[真实 HTTP 测试](../../../../apps/api/test/record-pool-lifecycle.e2e-spec.ts) 断言 dryRun 前后计数、并发双请求、最终负责人和每次创建的审计。 |
| 部分写入后修改剩余项须重新检查；更换文件须依靠业务查重；下载失败明细回到原行原值 | [抽屉回归](../../../../apps/web/src/features/records/record-import.test.tsx) 的 keeps a confirmed row 验证改对照后只重查、提交剩余行；[服务端回归](../../../../apps/api/src/modules/records/records.service.spec.ts) 验证纠正失败项并保留成功项；[文件测试](../../../../apps/web/src/features/records/record-import-file.test.ts) 验证原始行号、原值和 CSV 公式转义。 |

## 后续验收

第二批才登记 import_assist 及套餐目录，测同一次调用同时返回表头和列方案，分别报告 DeepSeek Responses 推理开启和关闭的准确率、对上率及延迟。40 列 p95 目标为 20 秒，本批没有测量模型延迟。#90 合并后按最新 main 变基并核对后续迁移编号。

## 第二轮试用复测

刘洋在本机客户表选择试用文件 customers.csv，抽屉显示文件名、5 行、7 列和「重新选择」。展开王五的归属菜单，前两项为公共池和「这些行不导入」，其后是公司成员。该表的公共池未启用，第一项显示禁用。本次仅预览文件和归属菜单。

| 浏览器宽度 | 选择文件后 | 展开负责人菜单 |
| --- | --- | --- |
| 1440 px | [文件预览](review-file1440.png) | [负责人选项](review-owner1440.png) |
| 1280 px | [文件预览](review-file1280.png) | [负责人选项](review-owner1280.png) |

抽屉回归测试覆盖取消文件选择时保留预览、重新选择同名文件、拖入替换文件，以及负责人菜单的排序和公共池禁用状态。
