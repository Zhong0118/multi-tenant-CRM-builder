# DeepSeek 真实业务回归与默认协议

2026-11-24 在官方端点 `api.deepseek.com` 上比较了同一模型 `deepseek-flash` 的两个接口。新建 DeepSeek 连接默认使用 **Responses**，高级设置可选 Chat Completions。两种接口的整理沟通得分相同，Responses 在筛选和建表上通过的样本更多。

## 开发集结果

| 功能与开发集 | 上次真实 Responses | 本次环境 Responses | 本次平台 Chat |
| --- | ---: | ---: | ---: |
| 整理沟通 | 35/36 | 34/36 | 34/36 |
| 一句话筛选 | 17/20 | 17/20 | 13/20 |
| AI 建表，当前全部样本 | 无 23 条同轮历史结果 | 20/23 | 17/23 |
| 其中原有 20 条 | 18/20 | 18/20 | 15/20 |
| 其中新增 3 条 | 2/3 | 2/3 | 2/3 |

每条开发样本每个协议各调用一次，使用原有业务评分器。建表整条通过还要求通过可确认方案的复验和权限检查。建表原 20 条与新增 3 条的历史成绩来自不同日期，新增样本采用首轮结果。[沟通基线](../ai-closeout/communication-deepseek.md) · [筛选基线](../../2026-11-23/assistant-v2-final-review/nl-filter-development.md) · [建表原 20 条](../../2026-11-23/ai-table-builder/review-retest/development.md) · [建表新增 3 条](../ai-closeout/table-builder-samples.json)

| 功能 | Responses 未通过的样本 | Chat 未通过的样本 |
| --- | --- | --- |
| 整理沟通 | wednesday-contact、new-year | budget-unapproved、amount-spoken |
| 一句话筛选 | D01、D17、D20 | D08、D13、D14、D15、D17、D18、D19 |
| AI 建表 | dev-01、dev-20、dev-23 | dev-01、dev-03、dev-12、dev-13、dev-14、dev-22 |

整理沟通的 Responses 失分来自两次跟进时间判断，Chat 的两条分别多生成跟进和字段建议。筛选 D13 包含不存在的合同编号字段，D14 要求按隐藏毛利过滤，D15 要求普通员工筛全团队。三个案例都应放弃生成，Chat 均返回了不符合要求的筛选规则，Responses 均通过。建表可确认方案的业务复验通过数，Responses 为 18/18，Chat 为 17/17。

首轮 Chat 的 D14、D15 只触发「预期弃答、实际返回规则」，未触发隐藏字段或模型上下文越权断言。预览经过可见字段、成员和跟进负责人校验，只返回规则，不查询记录。首轮未保留规则逐字段值。独立复跑时，D13 只保留原规则的报价阶段，D14 返回弃答，D15 把条件缩窄到截至今天待跟进，省略负责人。记录查询把这一条件绑定当前员工。另将包含隐藏字段、越权成员和全团队条件等 6 条非法输出直接注入业务校验器，6 条全部拒绝。这组失败属于模型没有正确处理不受支持的约束，未观察到隐藏数据泄露或权限扩大。

## 调用故障与耗时

| 功能 | 接口 | 超时 | `INCOMPLETE_OUTPUT` | SDK 无有效结构化对象 | 其他调用故障 | 单例耗时 p50 / p95（秒） |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 整理沟通 | Responses | 0 | 0 | 0 | 0 | 3.3 / 7.1 |
| 整理沟通 | Chat | 0 | 0 | 0 | 0 | 1.5 / 2.5 |
| 一句话筛选 | Responses | 0 | 0 | 0 | 0 | 2.2 / 5.7 |
| 一句话筛选 | Chat | 0 | 0 | 1 | 0 | 1.3 / 1.8 |
| AI 建表 | Responses | 0 | 0 | 2 | 0 | 17.6 / 59.1 |
| AI 建表 | Chat | 1 | 0 | 0 | 0 | 3.9 / 11.9 |
| 助手 6 轮 | Responses | 0 | 0 | 0 | 0 | — |

超时包含连接及整次请求的超时。Chat 建表 dev-01 在 5.5 秒报告超时，低于 90 秒总限时。SDK 无有效结构化对象对应 `AI_NoObjectGeneratedError`。耗时含模型生成和本地校验，按最近秩计算分位数。Responses 建表故障逐例为 dev-01（AI_NoObjectGeneratedError，38.1 秒）、dev-20（AI_NoObjectGeneratedError，6.1 秒）。Chat 筛选 D19 返回 SDK 无有效结构化对象。

三项结构化生成均在生产 provider 方法抛错、业务服务映射通用故障码之前分类。表中零次表示本次实际观察到该应用错误码零次。SDK 先抛出无有效对象异常时，上游原始结束原因没有采集，其是否截断未知。助手按公开失败事件和逐轮结果核对，所有轮次正常结束。历史报告没有同口径的逐错误码统计。

另对建表 dev-01 各做一次单例诊断，未计回主表。Responses 在 52.5 秒通过全部条件，Chat 在 13.4 秒生成了可确认的方案，但租赁合同缺少符合标注的金额字段。

## Responses 助手与平台连接测试

使用助手正式编排和独立本机 PostgreSQL 测试库中的合成租户、记录及可见字段，4 个对话共 6 轮全部通过。6 轮共执行 15 次工具调用。评分核对了确认前的业务数据、跨租户标记和隐藏字段。

| 场景 | 工具调用与可见结果 |
| --- | --- |
| 查看当前客户简报 | 读记录、活动、跟进及元数据，调用 `present_brief`，返回四部分简报 |
| 询问可用字段 | `describe_object` 后回答 |
| 修改客户阶段（两轮） | `ask_user` 返回待填表单，续答后 `describe_object`、`propose_change` 生成待确认修改 |
| 同名客户消歧（两轮） | `describe_object`、`search_records`、`ask_user` 让用户选记录，续答再读目标并生成待确认修改 |

另用平台文字用途连接测试验证了新默认。首次强制指定 `confirm_code` 时，厂商返回 HTTP 400。官方 DeepSeek 的 Responses 连接现使用助手实际采用的自动工具选择，仍须恰好调用一次 `confirm_code` 并传入精确参数 `CRM-42`。改后普通文本、工具、生产整理沟通结构化输出三项分别在 2396、1268、1726 毫秒通过。[DeepSeek 官方 Responses 接口说明](https://api-docs.deepseek.com/api/create-response/)

## 运行条件

- Responses 用本地环境配置调用 `createAiProvider`，Chat 用平台分配路径的 `loadVercelOpenAiProvider`。两个协议使用相同模型、受控传输和业务校验。Chat 使用生产的非思考模式和带 schema 的 JSON 对象输出适配。开发集评测器独立于租户配额。
- 三项业务使用 `apps/api/test/evals` 下 `communication-drafts`、`nl-filter`、`table-builder` 的当前开发集，每组串行，组间并发。助手使用同目录 `assistant` 的合成开发样本。结果适用于这一轮、这一模型和这些样本。
- 本机代理启用了 fake-IP，测试进程用公开 DNS 解析模型官方域名，传输继续校验和固定公网地址并验证 TLS。整理沟通与筛选的总限时为 45 秒，建表为 90 秒。发送内容仅限合成样本，报告仅记录样本 ID、业务评分与安全错误分类。
