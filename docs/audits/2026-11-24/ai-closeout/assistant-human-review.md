# 助手回答质量抽查

状态为待真人评阅。建议在本地试用时由一位熟悉跟进工作的销售或销售主管完成，预计 15 分钟。样本均为既有 DeepSeek 评测中的虚构数据，可以直接打开原话和回答。请先独立评分，再查看结构化评测结果。

| 场景与原回答 | 忠实 | 清楚 | 可执行 | 请特别核对 |
| --- | --- | --- | --- | --- |
| [客户简报](../../2026-11-23/assistant-v2-final-review/assistant-development.md#brief) | | | | 风险有依据吗？已有待办与下一步建议分得清吗？ |
| [同名记录](../../2026-11-23/assistant-v2-final-review/assistant-development.md#same-first) | | | | 给出的信息足以选对人吗？ |
| [批量超过上限](../../2026-11-23/assistant-v2-final-review/assistant-development.md#bulk-over) | | | | 看完能说出已写入几条、下一步怎么做吗？ |
| [无权访问](../../2026-11-23/assistant-v2-final-review/assistant-development.md#hidden-page) | | | | 回答有暗示已知不可见记录存在吗？ |
| [工具故障](../../2026-11-23/assistant-v2-final-review/assistant-development.md#read-error) | | | | 查询失败与确实没有记录分得清吗？ |

每栏记 0 或 1。忠实要求所有事实均能由记录或原话支持；清楚要求分得清已执行、待确认和失败；可执行要求销售知道接下来能做什么。请给每个 0 分抄一句原回答，写下期望说法。遇到编造事实、泄露权限或把待确认说成已执行，单独标记复查。

评阅人＿＿＿＿　评阅日期＿＿＿＿　需要修正的原句＿＿＿＿
