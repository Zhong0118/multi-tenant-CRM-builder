# AI 导入端到端评测

使用冻结提交 `f808ea8` 的原始 CSV、XLS、XLSX。评测器在本机 Nest 应用上下文中加载实际发布配置和成员权限，运行 Web 文件解析、表头推断、预览、采纳与转换，再通过 `runGroupedImport` 调用 `RecordsService.importRows` 的 dryRun。每个文件的管理员或员工角色取自冻结标注。两个角色均使用产品返回的可见字段和实际查询权。冻结的查重基线只对已经映射的字段生效。

## 运行

先创建专属 PostgreSQL 数据库 `crm_pr2_import_eval_test`。在 `packages/database` 用专库的 owner 连接运行 `prisma migrate deploy`。数据库地址必须为本机；`TEST_DATABASE_URL` 的角色为 `crm_app`，`TEST_DATABASE_ADMIN_URL` 的角色为 `crm`，两者必须指向同一专库。评测器在该库中复用固定合成租户与成员。不同必填配置各使用一个独立的已发布对象。串行运行，避免多个进程同时执行撤权探针。

在 `apps/api` 目录下运行以下命令。两种模型模式从环境读取 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`。也可在 node 后加 `--env-file=/本机路径/.env`。模型为受控 HTTPS 端点 `api.deepseek.com` 的 `deepseek-flash` Responses。若本地 DNS 返回非公网地址，可使用已有合法公网 DNS 解析器；每个请求仍经产品的公网地址检查、TLS 和实际模型计量器。

```sh
node test/evals/import-assist/run.cjs development rules
node test/evals/import-assist/run.cjs development default
node test/evals/import-assist/run.cjs development none
node test/evals/import-assist/report.cjs development
node test/evals/import-assist/report.cjs freeze
node test/evals/import-assist/run.cjs holdout rules
node test/evals/import-assist/run.cjs holdout default
node test/evals/import-assist/run.cjs holdout none
node test/evals/import-assist/report.cjs holdout
```

开发完成后冻结实现指纹。每个模式从同一批文件独立产生预测，留出运行必须匹配冻结指纹。报告保存在 `docs/audits/2026-11-24/ai-import-assist/eval-*`。结果 JSON 包含逐文件计数和权限探针，Markdown 汇总两套指标和 40 列子集。

## 计分口径

- 候选包含低把握与高把握建议，加上未被建议替换的规则草稿。主动建议错误跳过计错配；没有建议时算覆盖缺口。各文件原始列数、值标注数、行数固定。预选、人工采用分别按实际草稿重新计分。
- 人工场景可确认正确的备选表头、已提出的正确 review 目标、格式与取值。选项用本次 Web 预览的 ID 绑定回译。负责人手选、锁列、排除及查重使用共同基线。重复按已知种子记录的实际查重键区分。物理行号决定分母，选错表头导致读入的额外行单列。
- `entries` 统计真实服务进入观测 provider 的次数，`calls` 统计模型计量器已批准并即将通过受控 HTTPS 发送的次数。隐私检查在转交 SDK 前执行；如失败，会阻断该文件整个请求并保留隐私类别。记录模型返回的 token 与失败。每个文件额外重放两次权限探针，应分别收到 403 且零调用。
- 数据库对每份文件比较业务记录数、导入行凭据数、记录写审计数和对象配置、发布配置、套餐权益摘要。调用账本用于计量。比较注入配对的表头、最终目标和绑定到原词的选项；失败或阻断的模型输出无法证明注入稳定。
- 未设置模型的规则评测仍执行真实 dryRun。报告中的 READY 表示服务端允许写入；另报 READY 中与标注值不一致的行数（只对标有期望值的行比较）。高把握分母或宽表成功实呼为空时明确记为无法评估。

员工补充实验在开发集命令末尾加 `employee-supplement`，例如 `node test/evals/import-assist/run.cjs development default employee-supplement`。全部文件的 Web、服务端和 dryRun 都切换至同一个真实员工。输出带 `eval-employee-supplement-` 前缀，独立于按原角色计分的冻结评测。
