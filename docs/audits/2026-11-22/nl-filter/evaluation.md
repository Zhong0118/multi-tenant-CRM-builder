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
- D02（多条件、选项与金额） 期望 rule，得到 unavailable。
- D03（多条件、选项与金额） 期望 rule，得到 unavailable。
- D04（多条件、选项与金额） 期望 rule，得到 unavailable。
- D05（或和混合逻辑） 期望 rule，得到 unavailable。
- D06（或和混合逻辑） 期望 rule，得到 unavailable。
- D08（相对日期） 期望 rule，得到 unavailable。
- D09（相对日期） 期望 rule，得到 unavailable。
- D10（相对日期） 期望 rule，得到 unavailable。
- D17（含糊的等级、金额门槛或时间） 期望 clarify，得到 unavailable。
- D18（含糊的等级、金额门槛或时间） 期望 clarify，得到 unavailable。

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
- holdout-02（multi） 期望 rule，得到 unavailable。
- holdout-03（or） 期望 rule，得到 unavailable。
- holdout-05（date） 期望 rule，得到 unavailable。
- holdout-06（date） 期望 rule，得到 unavailable。
- holdout-09（ambiguous） 期望 clarify，得到 unavailable。
- holdout-10（ambiguous） 期望 clarify，得到 unavailable。

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
