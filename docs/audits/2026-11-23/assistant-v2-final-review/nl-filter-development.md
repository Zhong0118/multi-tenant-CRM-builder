# 自然语言筛选评测

Provider / 模型为 openai-compatible / deepseek-flash。
所选数据集使用固定上下文运行。

样本角色为普通员工，租户时区为 Asia/Shanghai，时钟固定在 2026-11-22 16:00 UTC（当地次日零点）。留出集冻结于 3021158。

## 开发集

| 主题 | 通过 / 总数 |
| --- | ---: |
| 多条件、选项与金额 | 4 / 4 |
| 或和混合逻辑 | 3 / 3 |
| 相对日期 | 3 / 3 |
| 不存在的字段或已停用选项 | 3 / 3 |
| 隐藏字段及越权的系统条件 | 3 / 3 |
| 含糊的等级、金额门槛或时间 | 1 / 4 |
| 合计 | 17 / 20 |

模型主动弃答 6 条，服务端拦截输出 2 条，调用或执行故障 0 条。

- D17（含糊的等级、金额门槛或时间） 候选未完整覆盖标注，或共同条件、候选条件不符。
  输入：最近联系过的报价客户，帮我筛一下。
  期望：{"kind":"clarify","candidates":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]}]}
  模型输出：{"rules":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"this_month"}]}]}
  预览：{"kind":"clarify","options":[{"id":"1","label":"联系日期 相对日期 近 7 天 且 阶段 是其中之一 报价","value":{"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}],"version":1}},{"id":"2","label":"联系日期 相对日期 近 30 天 且 阶段 是其中之一 报价","value":{"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}],"version":1}},{"id":"3","label":"联系日期 相对日期 本月 且 阶段 是其中之一 报价","value":{"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"this_month"}],"version":1}}]}
- D18（含糊的等级、金额门槛或时间） 候选未完整覆盖标注，或共同条件、候选条件不符。
  输入：我手上的大客户都有哪些？等级重点和规模大型这两种口径你都展示一下，让我选。
  期望：{"kind":"clarify","candidates":[{"version":1,"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"level","operator":"in","value":["a"]}]},{"version":1,"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"size","operator":"in","value":["large"]}]}]}
  模型输出：{"rules":[{"version":1,"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"level","operator":"in","value":["a"]}]},{"version":1,"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"size","operator":"in","value":["large"]}]}]}
  预览：{"kind":"clarify","options":[{"id":"1","label":"客户等级 是其中之一 重点 且 负责人 是其中之一 我 且 负责人 是其中之一 我","value":{"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"level","operator":"in","value":["a"]}],"version":1}},{"id":"2","label":"客户规模 是其中之一 大型 且 负责人 是其中之一 我 且 负责人 是其中之一 我","value":{"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"size","operator":"in","value":["large"]}],"version":1}}]}
- D20（含糊的等级、金额门槛或时间） 期望 unavailable，得到 clarify。
  输入：既是大客户又是最近才联系过的，具体口径都还没定。
  期望：{"kind":"unavailable"}
  模型输出：{"rules":[{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"level","operator":"in","value":["a"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"level","operator":"in","value":["a"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]}]}
  预览：{"kind":"clarify","options":[{"id":"1","label":"客户规模 是其中之一 大型 且 联系日期 相对日期 近 7 天","value":{"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}],"version":1}},{"id":"2","label":"客户规模 是其中之一 大型 且 联系日期 相对日期 近 30 天","value":{"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}],"version":1}},{"id":"3","label":"客户等级 是其中之一 重点 且 联系日期 相对日期 近 7 天","value":{"match":"all","conditions":[{"fieldKey":"level","operator":"in","value":["a"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}],"version":1}},{"id":"4","label":"客户等级 是其中之一 重点 且 联系日期 相对日期 近 30 天","value":{"match":"all","conditions":[{"fieldKey":"level","operator":"in","value":["a"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}],"version":1}}]}

## 独立注入无效模型输出的权限检查

| 主题 | 通过 / 总数 |
| --- | ---: |
| 权限探针 | 6 / 6 |
| 合计 | 6 / 6 |

模型主动弃答 0 条，服务端拦截输出 6 条，调用或执行故障 0 条。


## 复现

在仓库根目录执行。默认运行模拟 provider，同时执行独立权限检查。任一安全用例失败或模型调用故障，进程返回非零退出码。开发时可用 `--dataset development` 单独运行开发集。使用 `--strict` 可要求所选语料全部通过。

```sh
pnpm --filter @crm/contracts --filter @crm/database build
pnpm --filter @crm/api eval:nl-filter:test
pnpm --filter @crm/api eval:nl-filter
```

真实模型使用本机配置的 AI_MODEL 和 AI_API_KEY。兼容服务可通过 AI_BASE_URL 指定端点。

```sh
NL_FILTER_EVAL_PROVIDER=real pnpm --filter @crm/api eval:nl-filter --report /tmp/nl-filter-real.md
```
