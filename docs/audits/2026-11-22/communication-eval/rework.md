# 沟通草稿返工验收

基线 `d4aa8b0`。新版分别运行 30 条开发样本和 20 条冻结留出样本。此前报告中的 DeepSeek 分数对应旧的语言解析方式。

## 模型与服务端的分工

- 模型决定是否有待办、建议修改哪些字段、引用哪段原话，以及时间属于绝对日期、相对天数、本周或下周的某天、月末或未定中的哪一类。取消约定由模型输出 `followUp: null`。无法确定时间的待办仍可保留，日期为空。
- 服务端验证引文是本次原话的非空子串。仅接受可见、可编辑、非系统字段及活动选项，按 CRM 的字段类型校验值。数值要在引用范围内出现为完整数值，保留十进制精度并识别数量级，如「18 万」。销售确认时仍会重新校验权限和版本。
- 日历以公司时区计算。具体日期没有钟点时默认 09:00，已过去、超过当地 90 个日历日的同一钟点、夏令时跳过或重复的钟点均返回空日期。客户端和已保存草稿沿用原有的日期格式。[模型输出契约](../../../../apps/api/src/modules/ai/communication-output.ts) · [日历计算](../../../../apps/api/src/modules/ai/communication-date.ts)
- 开发集的价格异议样本允许省略待办，或建议无日期的方案说明；仍禁止擅改销售阶段和生成确定日期。模型需要对语义负责，通用规则通过并不能证明模型读懂了这次谈话。

## 开发集和留出集

留出集由未查看现有规则、开发集和失败记录的独立作者编写，语料及标注在 `51b8664` 冻结。格式化前后核对了序列化样本的 SHA-256，均为 `629c046e1ce6e7c2df9416f894e9618ff77a8341a4db9cff6b3ffe0063d09d6c`。分别统计两组，单条须同时满足跟进意图、日期、字段及引用要求。留出集只用于最终测量。[开发集](../../../../apps/api/test/evals/communication-drafts/cases.ts) · [留出集](../../../../apps/api/test/evals/communication-drafts/holdout.ts)

| 评测对象 | 开发集 · 30 条 | 留出集 · 20 条 |
| --- | --- | --- |
| DeepSeek Flash · 返工版 | 待真实调用 | 待真实调用 |
| 本地模拟 provider | 13/30 | 只用于开发集冒烟 |

模拟 provider 对演示里的「下周再联系」返回固定的结构化日期，其余模拟待办返回未定日期。它的分数反映脚本覆盖的语言范围。复跑时分别指定数据集，默认运行开发集。真实评测需本机环境提供 `AI_API_KEY`、`AI_MODEL=deepseek-flash`、`AI_BASE_URL=https://api.deepseek.com` 和 `COMMUNICATION_EVAL_PROVIDER=real`。

```sh
pnpm --filter @crm/api eval:communication --dataset development --report /tmp/communication-development.md
pnpm --filter @crm/api eval:communication --dataset holdout --report /tmp/communication-holdout.md
```

## UPDATE_RECORD 确认请求的 HTTP 解析错误

旧测试未显式启动 Nest 的监听器。Supertest 会在预览和确认时分别申请临时端口，本机的隐式监听走 IPv6，而 Supertest 的客户端连接 IPv4。原失败日志有预览 GET 200，没有随后应有的确认 POST。历史连接没有抓包，因此无法鉴定当时的响应进程。

在原 UPDATE_RECORD 用例中用一个自有的 IPv4 TCP 测试服务占住端口，并让第二次隐式监听选择同一端口。旧版产生两次隐式监听，测试服务收到一次误投的请求，稳定复现相同的 `Parse Error: Expected HTTP/, RTSP/ or ICE/`。修复后套件显式绑定 `127.0.0.1:0` 并复用同一个监听器。相同实验中隐式监听和误投请求均为零，预览与确认均返回 200。回归断言在预览后检查监听地址，旧版失败、新版通过。[修复与回归断言](../../../../apps/api/test/ai-confirmation.e2e-spec.ts)

## 改动量与自动化

以 `git diff d4aa8b0..60e2e49 --numstat -- apps` 统计。生产代码新增 119 行、删除 267 行，净减 148 行。测试和评测新增 523 行、删除 201 行，其中冻结留出集占 290 行。合计新增 642 行、删除 468 行。规格与审计 Markdown 单独归档。

全仓类型检查通过。API 单测 1827 项通过，3 项既有跳过；评测工具 12 项、相关 HTTP E2E 80 项、数据库集成 95 项通过。
