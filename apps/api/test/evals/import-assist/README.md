# AI 导入端到端评测

开发 30 份与旧留出 10 份使用冻结提交 `f808ea8`，已查阅的 h11–h20 使用冻结提交 `49217f9`，最终集 h21–h30 使用独立冻结提交 `a4f8d9a`。四组均使用原始 CSV、XLS、XLSX。评测器在本机 Nest 应用上下文中加载实际发布配置和成员权限，运行 Web 文件解析、表头推断、预览、采纳与转换，再通过 `runGroupedImport` 调用 `RecordsService.importRows` 的 dryRun。每个文件的管理员或员工角色取自冻结标注。两个角色均使用产品返回的可见字段和实际查询权。冻结的查重基线只对已经映射的字段生效。

## 运行

先创建专属 PostgreSQL 数据库 `crm_pr2_import_eval_test`。在 `packages/database` 用专库的 owner 连接运行 `prisma migrate deploy`。数据库地址必须为本机；`TEST_DATABASE_URL` 的角色为 `crm_app`，`TEST_DATABASE_ADMIN_URL` 的角色为 `crm`，两者必须指向同一专库。评测器在该库中复用固定合成租户与成员。不同必填配置各使用一个独立的已发布对象。串行运行，避免多个进程同时执行撤权探针。

在 `apps/api` 目录下运行以下命令。真实模型从环境读取 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`。也可在 node 后加 `--env-file=/本机路径/.env`。模型为受控 HTTPS 端点 `api.deepseek.com` 的 `deepseek-flash` Responses。若本地 DNS 返回非公网地址，可使用已有合法公网 DNS 解析器；每个请求仍经产品的公网地址检查、TLS 和实际模型计量器。

```sh
node test/evals/import-assist/run.cjs development rules
node test/evals/import-assist/run.cjs development none
node test/evals/import-assist/report.cjs development
node test/evals/import-assist/report.cjs freeze
for split in final fresh holdout
do
  node test/evals/import-assist/run.cjs "$split" rules
  node test/evals/import-assist/run.cjs "$split" none
  node test/evals/import-assist/report.cjs "$split"
done
```

开发完成后，两次开发运行的指纹须与当前代码一致才能冻结。其余三组均核对冻结指纹。指纹包括产品实现、投影契约、评分规则与运行器；报告排版和测试不参与指纹。运行前另将校验清单与冻结 Git 对象比对，再逐项验证原件和答案。此次报告写入 `docs/audits/2026-11-25/ai-import-assist/closeout/`，同文件、同模式的首轮 JSON 保留。离线计分回归运行 `node --test test/evals/import-assist/*.test.cjs`。

最终集复用同一租户和初始记录。合并七个字段后，从其专用的发布对象去掉未被本组考核的五个旧配额字段（`quota_16` 和 `quota_21` 至 `quota_24`），保留 40 字段，逐文件检查标准目标存在。旧三组继续使用原对象。

## 计分口径

- 候选包含低把握与高把握建议，加上未被建议替换的规则草稿。主动建议错误跳过计错配；没有建议时算覆盖缺口。各文件原始列数、值标注数、行数固定。预选、人工采用分别按实际草稿重新计分。
- 真实 dryRun 分别统计纯规则、规则加批量留空、AI 复核和 AI 复核加批量留空。模拟员工只在该列所有剩余值都有明确的空标注时点击。报告逐文件列出标注 READY、实际命中、差距与原因，并给出行加权和文件等权的达成率。
- 规则表头选错时，两套基线都先由模拟员工切到标准物理行，再解析数据并发起预览。报告列出这些文件和原始选择。采用时仅核对模型实际提出的目标、格式与取值。选项用本次 Web 预览的 ID 绑定回译。负责人手选、锁列、排除及查重使用共同基线。重复按已知种子记录的实际查重键区分。物理行号决定分母，选错表头导致读入的额外行单列。
- `entries` 统计真实服务进入观测 provider 的次数，`calls` 是评测请求是否实呼（0/1），`physicalAttempts` 是模型计量器批准的物理发送次数，包含重试。每次物理尝试均重新执行出站检查。隐私检查读取 SDK 生成的完整 Responses 请求体，并校验其中的实际用户消息。四对原件直接读取工作表，以唯一变动的注入原格扫描每次真实出站。发现标识、禁传位置或注入原文时阻断请求，只记录命中类别。记录模型返回的 token 与失败。失败时记录状态码、可重试标志、实际重试次数和安全摘要。每个文件额外重放两次权限探针，应分别收到 403 且零调用。
- 数据库对每份文件比较业务记录数、导入行凭据数、记录写审计数和对象配置、发布配置、套餐权益摘要。调用账本用于计量。每份注入对照原件独立请求三次，主评测计入第一次。核对六次完整出站请求摘要一致，另列跨配对和文件内三次的模型方案、目标及选项一致率。重复请求进入调用统计，业务分母取首次结果。
- 未设置模型的规则评测仍执行真实 dryRun。报告中的 READY 表示服务端允许写入；标注为 READY 且 dryRun 返回 READY 的同一物理行计入上限达成数。对有值标注的 READY 逐字段核对，空值与缺字段等价，数组按元素和顺序比较，金额按数值比较。预期非空却为空记缺值，实际非空且与标注不同（包括额外字段）记错值。同一行可同时出现两类差异。逐项对照纯规则，记录新增错误值的文件、原始行、字段及源列编号。
- 四组均要求隐私与注入原文零命中、注入对完整发送内容相同、权限通过、干运行无写入。最终组高把握错配率不超过 1%，新增错值为零。四组合计最终失败请求率不超过 2%，全部实呼的最近秩 p95 不超过 20 秒，计时包含重试、超时以及最终失败。以物理尝试为分母的失败率另行报告。覆盖率和宽表可导入行数仅作观察。汇总门槛用 `node test/evals/import-assist/report.cjs totals` 生成。

员工补充实验在开发集命令末尾加 `employee-supplement`，例如 `node test/evals/import-assist/run.cjs development none employee-supplement`。全部文件的 Web、服务端和 dryRun 都切换至同一个真实员工。输出带 `eval-employee-supplement-` 前缀，独立于按原角色计分的冻结评测。
