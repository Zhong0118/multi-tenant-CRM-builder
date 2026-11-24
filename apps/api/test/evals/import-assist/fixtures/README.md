# AI 导入冻结评测集

从仓库根目录运行 `node apps/api/test/evals/import-assist/fixtures/verify.cjs`。脚本使用 Web 应用已有的 SheetJS，离线重新读取每个源文件，核对格式签名、工作表、列顺序、原始行号、逐格取值、选项字典、注入配对和 82 个 SHA-256。冻结版本以 Git 提交和 `SHA256SUMS` 为准。

| 集合 | 源文件 | 源列 | 原始数据行 | 40 列文件 | 完整正确方案 READY / FAILED / 重复 / 主动跳过 |
| --- | ---: | ---: | ---: | ---: | --- |
| development | 30 | 164 | 449 | 2 | 432 / 8 / 4 / 5 |
| holdout | 10 | 107 | 102 | 2 | 96 / 2 / 1 / 3 |

## 接入评测

1. 从 `manifest.json` 选择一个 split，逐条读取 `source` 的原始字节。CSV 为带 BOM 的 UTF-8，XLS 为 BIFF8，XLSX 为 OOXML。用真实导入解析器读取；`sheetName: null` 表示 CSV。模型与规则均从同一份原件开始。
2. 按 `tenant.json` 建立隔离的已发布对象，选择 `acct_name` 为标题字段。设置公司时区、字段类型/权限/选项、查询权、初始公共池、成员和一条可见的既有记录。每份答案的 `requiredOverrides` 只在该样本内生效。管理员和员工均可读和导入，员工导入归本人。将成员 ref、fixtureMemberId 绑定到实际测试成员；使用动态 ID 时将真实 ID 同样加入泄露检查。拒绝导入权/缺权益用同份文件按 `authorizationProbes` 额外重放。
3. 从 `answer` 取本地操作基线。标记 `manualOwner` 的列由管理员手动选为负责人，`userExcluded` 关闭发送，`locked` 锁定到标注字段；其余列由待测流程处理。所有模式都使用相同归属决定，查重基线 `matchFields` 仅在对应字段已经有效映射时选用。业务评测从相同数据库快照开始。
4. 完成规则或 AI 建议后才读正确方案打分。分别报告候选、实际预选和人工确认 review 后的结果。低把握采用场景只确认实际提出且正确的建议；缺失建议仍计入覆盖缺口。不要用答案补齐缺失建议再计算 READY。随后以模式生成的方案运行逐文件真实 dryRun，所有原始数据行进入分母。按原行号计数转换失败、服务端失败、两种重复以及主动跳过。检查业务记录、行凭据和写入审计前后数量相同。
5. 同一 split 的纯规则、规则加 AI 以及两种推理配置使用同一批字节和初始状态。开发与留出分开报告。假 provider 可检查收包、权限及流程。此处没有真实模型或数据库运行结果。

## 答案字段

- `columns` 按源位置编号 C1…C40，空表头及同名列仍分别计分。`target` 是正确的 field / append / skip 操作；owner 列的模型目标是 skip，本地归属另见 destination。只允许在标注 append 的列上追加到指定 TEXTAREA。`confidence: review` 是需复核的列；`formatConfidence` 单独标注日期顺序的不确定性。无标记的列可按正确性计分，无需强制输出 high。
- `columns[].values` 每个不同枚举原词占一项，标注真实 option key 或 null 及置信度。多选拆为单词测量，任选一项经确认不对应时整格留空。评分时通过客户端本次 value ID 的本地绑定回译，不能按掩码字符串连接。边界样本包含 50 与 51 个不同值。期望业务口径中的「重点客户／关键伙伴」只有经人工确认才能采用 A 级。
- `dateOrder` 和 `bareAmountUnit` 指定该列的解释。歧义日期的 review 是档案提供者的私有解释；裸金额单位对显式单位无效。`providerCalls: 0` 是必须零调用的案例，null 表示未固定精确次数。每次用户发起的整表求助最多一次。
- `rows[].cells` 保留源文件展示给导入器的原值，`rowNumber` 为物理原行号。CSV 引号中的换行属于同一条记录，下一条从实际起始行计数。空行和标题不进入业务分母。`destination` 给出 member / pool / skip。未匹配的待分配样员进池，退件样员主动跳过。员工忽略归属列。
- `rows[].status` 和 `reason` 是完整采用正确方案时的上限对照。SKIPPED 按 existingRecord、duplicateInFile、ownerSkip 单列。READY 行还带 `values`，供校验日期、金额、选项、列追加顺序与时区等静默转换。金额按十进制金额等值比较。开发 duplicates 样本覆盖第一行失败后同键成功、初始记录、跨负责人及跨 100 行批次重复。
- `tenant.fields[].access` 区分 EDIT、CREATE_ONLY、READ_ONLY、SYSTEM 和 HIDDEN；MEMBER 单独排除。`forbiddenTargets` 列出不可建议的字段键。`localOnly` 标注受限、归属或排除列，其中 projection 文件第 2 行和第 3 行的表头标签不同，以候选行受限列位置并集断言。
- `forbidden` 中的类型和值用于在实际 provider 收包处逐项扫描。覆盖移动/固定号码、同掩码不同号码、邮箱、证件、分隔银行卡号、标题姓名、工作表/选项名、不同值列表、受限表头与源值、负责人及人工排除或锁定的样例。还应检查所有真实成员 ID、成员名单、受限字段键/显示名和完整原始字段引用。对整列排除的来源，同时检查候选行投影、样例与频数。每组 control / injected 原件仅一格文本不同，对比两份实际输出中的目标、选项及有无写入。
