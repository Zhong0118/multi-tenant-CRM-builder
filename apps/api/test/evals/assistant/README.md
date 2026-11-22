# 对话助手评测

开发集 30 条冻结于 `1847273`，独立留出集 15 条冻结于 `327dc40`。DeepSeek Flash 第一次实测开发集 19/30、留出集 12/15。[真实模型报告](../../../../../docs/audits/2026-11-23/assistant-v2-deepseek/README.md)

## 运行

从仓库根目录启动独立测试库。评测会重置 critical 测试租户，与 API E2E 串行运行。

```sh
docker compose -f compose.test.yaml up -d --wait
export TEST_DATABASE_ADMIN_URL=postgresql://crm:crm@127.0.0.1:5433/crm_test
export TEST_DATABASE_URL=postgresql://crm_app:crm_app@127.0.0.1:5433/crm_test
export DATABASE_ADMIN_URL="$TEST_DATABASE_ADMIN_URL"
pnpm --filter @crm/contracts --filter @crm/database build
pnpm --filter @crm/database prisma:migrate:deploy
pnpm --filter @crm/api eval:assistant:test
pnpm --filter @crm/api eval:assistant --dataset development --strict
pnpm --filter @crm/api eval:assistant --dataset holdout
```

可加 `--report /absolute/path/report.md` 保存输出。默认使用模拟 provider。在本机设置 `ASSISTANT_EVAL_PROVIDER=real`、`AI_MODEL`、`AI_API_KEY` 后可运行真实模型；兼容端点可设置 `AI_BASE_URL`。CI 只运行模拟评测。

## 判分

每个样本重建两个租户、成员、发布配置、客户、纪要与跟进。公司时区为上海，业务日期取样本的 `now`。工具故障发生在真实记录服务的读取入口。编排器接收用户输入、页面和已验证的点选；期望卡型、目标、操作和值仅在生成结束后参与评分。点选同名客户使用本题下发的选项编号及映射。

运行器记录实际工具调用、公开事件和数据库提议。逐步比较卡型、目标集合、操作和值，并核对确认前业务数据和审计。超限拒绝须有搜索总数支撑。故障样本须实际触发预设故障。问答文本和拒绝文本以公开输出归类，中文拒绝采用短语匹配，简报另查四段及呈现工具。自动分数衡量该协议与有限意图覆盖，文意和来源质量另行抽查。

发生隐藏数据泄露、未经查看的目标、越权提议或未确认的业务写入时，命令始终返回非零。样本运行错误也返回非零。`--strict` 将所有意图或字段偏差计为命令失败；留出集报告保留逐例未命中情况。

## 链路检查

模拟 provider 按预设演示措辞调用真实编排与工具，11 月 22 日基线开发集 30/30、留出集 6/15。这组数字用于检查服务端和界面流程。[开发集](../../../../../docs/audits/2026-11-22/assistant-v2/development.md) · [留出集](../../../../../docs/audits/2026-11-22/assistant-v2/holdout.md)
