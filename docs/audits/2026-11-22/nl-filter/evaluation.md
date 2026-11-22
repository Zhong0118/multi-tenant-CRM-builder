# 自然语言筛选评测

Provider / 模型为 fake / fake。
模拟 provider 的分数仅衡量脚本覆盖的示例。真实模型语言理解能力未在此次运行中评估。

样本角色为普通员工，租户时区为 Asia/Shanghai，时钟固定在 2026-11-22 16:00 UTC（当地次日零点）。留出集冻结于 3021158。

## 开发集

| 主题 | 通过 / 总数 |
| --- | ---: |
| 多条件、选项与金额 | 0 / 4 |
| 或和混合逻辑 | 1 / 3 |
| 相对日期 | 0 / 3 |
| 不存在的字段或已停用选项 | 3 / 3 |
| 隐藏字段及越权的系统条件 | 3 / 3 |
| 含糊的等级、金额门槛或时间 | 2 / 4 |
| 合计 | 9 / 20 |

模型主动弃答 20 条，服务端拦截输出 0 条，调用或执行故障 0 条。

- D01（多条件、选项与金额） 期望 rule，得到 unavailable。
  输入：我负责的客户里，把处在报价或谈判阶段、预计金额超过十万元的挑出来。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"stage","operator":"in","value":["quote","negotiation"]},{"fieldKey":"amount","operator":"gt","value":"100000"}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D02（多条件、选项与金额） 期望 rule，得到 unavailable。
  输入：预计金额不超过 8050.75 元，并且阶段是成交。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"amount","operator":"lte","value":"8050.75"},{"fieldKey":"stage","operator":"in","value":["won"]}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D03（多条件、选项与金额） 期望 rule，得到 unavailable。
  输入：再加上预计金额至少 9.99 元。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"amount","operator":"gte","value":"9.99"}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D04（多条件、选项与金额） 期望 rule，得到 unavailable。
  输入：换成只看谈判阶段的客户。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["negotiation"]}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D05（或和混合逻辑） 期望 rule，得到 unavailable。
  输入：报价和成交这两个阶段里任意一个都行。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote","won"]}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D06（或和混合逻辑） 期望 rule，得到 unavailable。
  输入：要么是我负责，要么客户规模是大型，满足一个就行。
  期望：{"kind":"rule","rule":{"version":1,"match":"any","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"size","operator":"in","value":["large"]}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D08（相对日期） 期望 rule，得到 unavailable。
  输入：筛出今天联系过的客户。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"contacted","operator":"relative","value":"today"}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D09（相对日期） 期望 rule，得到 unavailable。
  输入：上个月有过联系，而且还是在谈判的客户。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"contacted","operator":"relative","value":"last_month"},{"fieldKey":"stage","operator":"in","value":["negotiation"]}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D10（相对日期） 期望 rule，得到 unavailable。
  输入：换成只看过去 30 天联系的客户。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D17（含糊的等级、金额门槛或时间） 期望 clarify，得到 unavailable。
  输入：最近联系过的报价客户，帮我筛一下。
  期望：{"kind":"clarify","candidates":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]}]}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- D18（含糊的等级、金额门槛或时间） 期望 clarify，得到 unavailable。
  输入：我手上的大客户都有哪些？等级重点和规模大型这两种口径你都展示一下，让我选。
  期望：{"kind":"clarify","candidates":[{"version":1,"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"level","operator":"in","value":["a"]}]},{"version":1,"match":"all","conditions":[{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"size","operator":"in","value":["large"]}]}]}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}

## 冻结留出集

| 主题 | 通过 / 总数 |
| --- | ---: |
| multi | 0 / 2 |
| or | 1 / 2 |
| date | 0 / 2 |
| missing | 1 / 1 |
| restricted | 1 / 1 |
| ambiguous | 0 / 2 |
| 合计 | 3 / 10 |

模型主动弃答 10 条，服务端拦截输出 0 条，调用或执行故障 0 条。

- holdout-01（multi） 期望 rule，得到 unavailable。
  输入：保留现在的阶段条件，再要求负责人是我、预计金额至少 87654.32 元。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote","negotiation"]},{"fieldKey":"$owner","operator":"in","value":["$me"]},{"fieldKey":"amount","operator":"gte","value":"87654.32"}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- holdout-02（multi） 期望 rule，得到 unavailable。
  输入：把现有筛选换成只看已成交、预计金额不到三万元的客户。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["won"]},{"fieldKey":"amount","operator":"lt","value":"30000"}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- holdout-03（or） 期望 rule，得到 unavailable。
  输入：满足下面任一项就显示：客户规模选了大型，或者阶段选了成交。
  期望：{"kind":"rule","rule":{"version":1,"match":"any","conditions":[{"fieldKey":"size","operator":"in","value":["large"]},{"fieldKey":"stage","operator":"in","value":["won"]}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- holdout-05（date） 期望 rule，得到 unavailable。
  输入：调出上个自然月联系过的客户。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"contacted","operator":"relative","value":"last_month"}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- holdout-06（date） 期望 rule，得到 unavailable。
  输入：只看昨天联系过且阶段为谈判的客户。
  期望：{"kind":"rule","rule":{"version":1,"match":"all","conditions":[{"fieldKey":"contacted","operator":"relative","value":"yesterday"},{"fieldKey":"stage","operator":"in","value":["negotiation"]}]}}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- holdout-09（ambiguous） 期望 clarify，得到 unavailable。
  输入：报价阶段里，最近联系过的有哪些？
  期望：{"kind":"clarify","candidates":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_7_days"}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["quote"]},{"fieldKey":"contacted","operator":"relative","value":"past_30_days"}]}]}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}
- holdout-10（ambiguous） 期望 clarify，得到 unavailable。
  输入：从已成交的客户里挑出大客户。
  期望：{"kind":"clarify","candidates":[{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["won"]},{"fieldKey":"size","operator":"in","value":["large"]}]},{"version":1,"match":"all","conditions":[{"fieldKey":"stage","operator":"in","value":["won"]},{"fieldKey":"level","operator":"in","value":["a"]}]}]}
  模型输出：{"rules":[]}
  预览：{"kind":"unavailable"}

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
