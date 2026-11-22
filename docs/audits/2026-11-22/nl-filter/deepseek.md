# 自然语言筛选评测

Provider / 模型为 openai-compatible / deepseek-flash。
使用同一模型与固定上下文分别运行两组语料。

样本角色为普通员工，租户时区为 Asia/Shanghai，时钟固定在 2026-11-22 16:00 UTC（当地次日零点）。留出集冻结于 3021158。

本次真实模型首先遇到传输格式错误。原先数字和字符串构成的联合类型又被包在值的联合类型内，DeepSeek 在推理前返回 HTTP 400，两组均未得到生成结果。将备选 JSON 类型平铺后，用独立请求确认成功，再完整运行 20 条开发样本与 10 条冻结留出样本各一次。下文为修正后的结果。此次修正只涉及传输格式，样本、标注与提示词保持原样。

## 开发集

| 主题 | 通过 / 总数 |
| --- | ---: |
| 多条件、选项与金额 | 4 / 4 |
| 或和混合逻辑 | 2 / 3 |
| 相对日期 | 3 / 3 |
| 不存在的字段或已停用选项 | 3 / 3 |
| 隐藏字段及越权的系统条件 | 3 / 3 |
| 含糊的等级、金额门槛或时间 | 2 / 4 |
| 合计 | 17 / 20 |

模型主动弃答 7 条，服务端拦截输出 0 条，调用或执行故障 0 条。

- D07（或和混合逻辑） 期望 unavailable，得到 clarify。
  输入：我要大型客户，而且还得是我负责或者处于报价阶段，两项至少占一项。
  期望：{"kind":"unavailable"}
  模型输出：{"rules":[{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"$owner","operator":"in","value":["$me"]}]},{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"stage","operator":"in","value":["quote"]}]}]}
  预览：{"kind":"clarify","options":[{"id":"1","label":"客户规模 是其中之一 大型 且 负责人 是其中之一 我","value":{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"$owner","operator":"in","value":["$me"]}]}},{"id":"2","label":"客户规模 是其中之一 大型 且 阶段 是其中之一 报价","value":{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"stage","operator":"in","value":["quote"]}]}}]}
- D17（含糊的等级、金额门槛或时间） 候选未完整覆盖标注，或共同条件、候选条件不符。
  输入：最近联系过的报价客户，帮我筛一下。
  期望：{"kind":"clarify","candidates":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]}]}
  模型输出：{"rules":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"last_month"}]}]}
  预览：{"kind":"clarify","options":[{"id":"1","label":"联系日期 相对日期 近 7 天 且 阶段 是其中之一 报价","value":{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]}},{"id":"2","label":"联系日期 相对日期 近 30 天 且 阶段 是其中之一 报价","value":{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]}},{"id":"3","label":"联系日期 相对日期 上月 且 阶段 是其中之一 报价","value":{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"last_month"}]}}]}
- D20（含糊的等级、金额门槛或时间） 期望 unavailable，得到 clarify。
  输入：既是大客户又是最近才联系过的，具体口径都还没定。
  期望：{"kind":"unavailable"}
  模型输出：{"rules":[{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"this_week"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"this_month"}]}]}
  预览：{"kind":"clarify","options":[{"id":"1","label":"客户规模 是其中之一 大型 且 联系日期 相对日期 近 7 天","value":{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]}},{"id":"2","label":"客户规模 是其中之一 大型 且 联系日期 相对日期 近 30 天","value":{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]}},{"id":"3","label":"客户规模 是其中之一 大型 且 联系日期 相对日期 本周","value":{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"this_week"}]}},{"id":"4","label":"客户规模 是其中之一 大型 且 联系日期 相对日期 本月","value":{"version":1,"match":"all","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"contacted","operator":"relative","value":"this_month"}]}}]}

## 冻结留出集

| 主题 | 通过 / 总数 |
| --- | ---: |
| multi | 2 / 2 |
| or | 2 / 2 |
| date | 2 / 2 |
| missing | 1 / 1 |
| restricted | 1 / 1 |
| ambiguous | 1 / 2 |
| 合计 | 9 / 10 |

模型主动弃答 3 条，服务端拦截输出 0 条，调用或执行故障 0 条。

- holdout-10（ambiguous） 期望 clarify，得到 rule。
  输入：从已成交的客户里挑出大客户。
  期望：{"kind":"clarify","candidates":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["won"]},{"fieldKey":"size","operator":"in","value":["large"]}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["won"]},{"fieldKey":"level","operator":"in","value":["a"]}]}]}
  模型输出：{"rules":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["won"]},{"fieldKey":"size","operator":"in","value":["large"]}]}]}
  预览：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["won"]},{"fieldKey":"size","operator":"in","value":["large"]}]}}

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

## 试用边界

越权和隐藏字段相关语料及独立权限检查均通过。四个语义失败都发生在需要辨别含糊含义或布尔分组的请求中。用户仍需检查预览后点击应用。例如「大客户」可能只生成规模条件；「必须是大型，并满足另两个条件之一」可能被拆成两个澄清选项，选择其中任何一个都会漏掉另一种情况。后续改进用开发样本验证，下一次独立测量另行冻结语料。

## 合并前三条开发样本复核

调整真实模型的输出契约后，使用同一 `deepseek-flash` 各运行一次 D06、D07、D17。D06 保留了顶层「或」；D07「大型客户，而且还得是我负责或者处于报价阶段」整体弃答；D17「最近联系过的报价客户」也弃答，标注要求给出时间范围候选，因此未通过。本次为定向回归，上文 17/20 和 9/10 是修改前的全量结果。
