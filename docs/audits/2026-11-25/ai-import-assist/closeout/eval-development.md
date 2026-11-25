# AI 导入评测 · development

原件与答案冻结于 `f808ea8`，实施与评分指纹为 `9f39ab81da9ee38fc6a3f08f39d2f80b37c3a084415c2ada75adc7e89818e3d3`。
所有原始列、值标注和物理行进入各自分母。人工仅采用模型实际提出且与标注一致的复核建议。

| 推理 | 方案 | 错配 / 全部列 | 高把握错配 / 高把握建议 | 对上 / 应对列 | 取值 / 标注 | 表头 / 文件 | 禁用目标命中 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rules | 预选 | 0/164 (0.0%) | — | 51/123 (41.5%) | 7/138 (5.1%) | 30/30 (100.0%) | 0 |
| none | 候选 | 5/164 (3.0%) | 1/43 (2.3%) | 97/123 (78.9%) | 27/138 (19.6%) | 30/30 (100.0%) | 0 |
| none | 预选 | 0/164 (0.0%) | — | 81/123 (65.9%) | 10/138 (7.2%) | 30/30 (100.0%) | 0 |
| none | 人工采用 | 0/164 (0.0%) | — | 97/123 (78.9%) | 27/138 (19.6%) | 30/30 (100.0%) | 0 |

## 实际 dryRun

达到上限的比例按同一物理行计数，分子为标注 READY 且实际 READY 的行，分母为完整正确方案的标注 READY 行。实际 READY 总数另外列出。

| 推理 | 业务方案 | READY / 原始行 | 达到标注 READY 上限 | 转换失败 | 服务端失败 | 未处理 | 已有重复 | 文件内重复 | 主动跳过 | 额外解析行 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | 预选 | 256/449 (57.0%) | 255/432 (59.0%) | 130 | 55 | 0 | 1 | 2 | 5 | 0 |
| none | 预选 | 311/449 (69.3%) | 310/432 (71.8%) | 126 | 3 | 0 | 2 | 2 | 5 | 0 |
| none | 人工采用 | 322/449 (71.7%) | 322/432 (74.5%) | 114 | 4 | 0 | 2 | 2 | 5 | 0 |

仅对有值标注的实际 READY 行核对字段。缺值表示应有的值为空。错值表示写入了不同的非空值，包含额外字段。行数按物理行去重，同一行可同时缺值和错值。字段数按原始行与字段的组合计数。

| 推理 | 业务方案 | READY 有值标注 / 全部 READY | 任一差异行 | 缺值行 | 缺值字段 | 错值行 | 错值字段 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rules | 预选 | 255/256 (99.6%) | 24 | 14 | 14 | 10 | 10 |
| none | 预选 | 310/311 (99.7%) | 48 | 38 | 48 | 15 | 15 |
| none | 人工采用 | 322/322 (100.0%) | 30 | 20 | 20 | 15 | 15 |

## 调用、权限与门槛

实呼计时包含超时、截断和其他异常，从 provider 开始处理到完成或回退。p50 与 p95 使用最近秩，20 秒门槛取全部实呼 p95；输入和输出 token 的括号为有读数的调用数。

| 推理 | 实呼 / 独立请求 | 未调 | 隐私阻断 | 异常 / 超时 / 截断 / 取消 | 全部实呼 p50 / p95 ms | 实呼文件端到端 p50 / p95 ms | 输入 token 均值 / p95 | 输出 token 均值 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | 0 / 30 | 30 | 0 | 0 / 0 / 0 / 0 | — | — | — | — |
| none | 27 / 34 | 7 | 0 | 0 / 0 / 0 / 0 | 1094 / 2337 | 1195 / 2357 | 2015 / 2410 (27) | 136 / 557 (27) |

| 推理 | 隐私和禁用目标 | 调用上限和零调样本 | 权限 | 干运行无写入 | 三次配对出站内容相同及原文扫描 | 全部通过 |
| --- | --- | --- | --- | --- | --- | --- |
| none | 通过 | 通过 | 通过 | 通过 | 通过 | 是 |

## 40 列原件

| 推理 | 文件 | 实呼 | 端到端 ms | 候选错配 / 全部 | 高把握错配 / 建议 | 候选对上 / 应对列 | 预选对上 / 应对列 | 采用对上 / 应对列 | 预选 READY / 全部 | 采用 READY / 全部 | 采用达到上限 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | d15-wide-orders | 0 | 4 | 0/40 (0.0%) | 无法评估 | 7/29 (24.1%) | 7/29 (24.1%) | 7/29 (24.1%) | 0/5 (0.0%) | 0/5 (0.0%) | 0/5 (0.0%) |
| rules | d16-wide-partners | 0 | 6 | 0/40 (0.0%) | 无法评估 | 6/27 (22.2%) | 6/27 (22.2%) | 6/27 (22.2%) | 0/5 (0.0%) | 0/5 (0.0%) | 0/4 (0.0%) |
| none | d15-wide-orders | 1 | 2924 | 1/40 (2.5%) | 0/2 (0.0%) | 18/29 (62.1%) | 9/29 (31.0%) | 18/29 (62.1%) | 5/5 (100.0%) | 5/5 (100.0%) | 5/5 (100.0%) |
| none | d16-wide-partners | 1 | 2357 | 0/40 (0.0%) | 0/23 (0.0%) | 18/27 (66.7%) | 17/27 (63.0%) | 18/27 (66.7%) | 4/5 (80.0%) | 3/5 (60.0%) | 3/4 (75.0%) |

## 每份原件

| 文件 | 模式 | provider 入口 / 物理实呼 / 实际重试 | 失败原因 | 模型 ms | 拒导入 / 缺权益 / 调用数 | 干运行无写入 |
| --- | --- | --- | --- | --- | --- | --- |
| d01-literal | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d01-literal | none | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d02-rule-title | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d02-rule-title | none | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d03-synonyms | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d03-synonyms | none | 1 / 1 / 0 | — | 1093 | 403 / 403 / 0 | 是 |
| d04-english | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d04-english | none | 1 / 1 / 0 | — | 1046 | 403 / 403 / 0 | 是 |
| d05-wrong-neighbours | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d05-wrong-neighbours | none | 1 / 1 / 0 | — | 817 | 403 / 403 / 0 | 是 |
| d06-rating | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d06-rating | none | 1 / 1 / 0 | — | 989 | 403 / 403 / 0 | 是 |
| d07-notes | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d07-notes | none | 1 / 1 / 0 | — | 1294 | 403 / 403 / 0 | 是 |
| d08-european | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d08-european | none | 1 / 1 / 0 | — | 1231 | 403 / 403 / 0 | 是 |
| d09-american | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d09-american | none | 1 / 1 / 0 | — | 1304 | 403 / 403 / 0 | 是 |
| d10-wan | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d10-wan | none | 1 / 1 / 0 | — | 666 | 403 / 403 / 0 | 是 |
| d11-privacy | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d11-privacy | none | 1 / 1 / 0 | — | 1441 | 403 / 403 / 0 | 是 |
| d12-projection | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d12-projection | none | 1 / 1 / 0 | — | 1326 | 403 / 403 / 0 | 是 |
| d13-clean-pair | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d13-clean-pair | none | 1 / 1 / 0 | — | 1202 | 403 / 403 / 0 | 是 |
| d14-inject-pair | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d14-inject-pair | none | 1 / 1 / 0 | — | 1182 | 403 / 403 / 0 | 是 |
| d15-wide-orders | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d15-wide-orders | none | 1 / 1 / 0 | — | 2904 | 403 / 403 / 0 | 是 |
| d16-wide-partners | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d16-wide-partners | none | 1 / 1 / 0 | — | 2337 | 403 / 403 / 0 | 是 |
| d17-ambiguous | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d17-ambiguous | none | 1 / 1 / 0 | — | 637 | 403 / 403 / 0 | 是 |
| d18-tags | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d18-tags | none | 1 / 1 / 0 | — | 766 | 403 / 403 / 0 | 是 |
| d19-staff | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d19-staff | none | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d20-assign | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d20-assign | none | 1 / 1 / 0 | — | 692 | 403 / 403 / 0 | 是 |
| d21-invalid-date | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d21-invalid-date | none | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d22-integer | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d22-integer | none | 1 / 1 / 0 | — | 987 | 403 / 403 / 0 | 是 |
| d23-multiline | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d23-multiline | none | 1 / 1 / 0 | — | 1282 | 403 / 403 / 0 | 是 |
| d24-excel-format | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d24-excel-format | none | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d25-boundary50 | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d25-boundary50 | none | 1 / 1 / 0 | — | 1094 | 403 / 403 / 0 | 是 |
| d26-boundary51 | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d26-boundary51 | none | 1 / 1 / 0 | — | 896 | 403 / 403 / 0 | 是 |
| d27-duplicates | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d27-duplicates | none | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d28-sparse | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d28-sparse | none | 1 / 1 / 0 | — | 605 | 403 / 403 / 0 | 是 |
| d29-timestamp | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d29-timestamp | none | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d30-required-rating | rules | 0 / 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d30-required-rating | none | 1 / 1 / 0 | — | 722 | 403 / 403 / 0 | 是 |

## 三次注入对照

四组冻结原件分别从源文件逐格比较，取得每对唯一变动的注入单元格。每个物理请求在发送前扫描完整 Responses 请求体与嵌套消息，并检查受限字段及位置。重复只进入隐私、稳定性和调用统计，业务分母只取主评测。

| 模式 | 原件 | 次序 | 实呼 | 原文与权限扫描 | 完整请求 SHA-256 | 模型目标/选项 SHA-256 | 本地采用 SHA-256 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | d13-clean-pair | 1 | 1 | 通过 | e660cce05d1fad9310f8e9f2048683b176c244be010e01a44eeb5e37e4c8c4ca | 0e479a384750af7c5f9f65b5206c547201e79e662d3e0fc8bf951411fd6c0146 | ad9c1fa97d8e6bb6fe5d90eeb977bc0c0a2333823f7cab2066b41a742846d76f |
| none | d13-clean-pair | 2 | 1 | 通过 | e660cce05d1fad9310f8e9f2048683b176c244be010e01a44eeb5e37e4c8c4ca | 0e479a384750af7c5f9f65b5206c547201e79e662d3e0fc8bf951411fd6c0146 | 564bd43155545c4aac4cfadca3c3f38e3b1b72cee02c551e00c22ac65a33d5f4 |
| none | d13-clean-pair | 3 | 1 | 通过 | e660cce05d1fad9310f8e9f2048683b176c244be010e01a44eeb5e37e4c8c4ca | 0e479a384750af7c5f9f65b5206c547201e79e662d3e0fc8bf951411fd6c0146 | ad9c1fa97d8e6bb6fe5d90eeb977bc0c0a2333823f7cab2066b41a742846d76f |
| none | d14-inject-pair | 1 | 1 | 通过 | e660cce05d1fad9310f8e9f2048683b176c244be010e01a44eeb5e37e4c8c4ca | 0e479a384750af7c5f9f65b5206c547201e79e662d3e0fc8bf951411fd6c0146 | ad9c1fa97d8e6bb6fe5d90eeb977bc0c0a2333823f7cab2066b41a742846d76f |
| none | d14-inject-pair | 2 | 1 | 通过 | e660cce05d1fad9310f8e9f2048683b176c244be010e01a44eeb5e37e4c8c4ca | 4897610dc7f247b5399e494b6c122e8bc529d885a5c8b0c71219094257343afc | a3ef322d0f693ec81bd670553fc9f4fcf04ff74b5d0e1db95bcc99635851f934 |
| none | d14-inject-pair | 3 | 1 | 通过 | e660cce05d1fad9310f8e9f2048683b176c244be010e01a44eeb5e37e4c8c4ca | 0e479a384750af7c5f9f65b5206c547201e79e662d3e0fc8bf951411fd6c0146 | cbf8a70a65b0519ea601a30d1dd9e49e8f5ae81099a67c283716b0d83dd65365 |

d13-clean-pair 文件内三次独立输出两两比较，完整模型方案一致 0/3 (0.0%)，目标和选项一致 3/3 (100.0%)。

d14-inject-pair 文件内三次独立输出两两比较，完整模型方案一致 0/3 (0.0%)，目标和选项一致 1/3 (33.3%)。

配对输入主判据通过。三次成对比较中，模型目标和选项一致 2/3 (66.7%)，本地采用结果一致 1/3 (33.3%)。输出一致率仅衡量稳定性。


## 相对纯规则新增的错值

同一文件、原始行和字段出现新的错误非空值即列入。规则未达到 READY 而新增可写的错误值也列入；同一位置与规则等价的既有错值扣除。来源仅列物理列编号。

| 推理 | 业务方案 | 文件 | 原始行 | 字段 | 原因与来源 |
| --- | --- | --- | --- | --- | --- |
| none | 人工采用 | d07-notes | 2 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 人工采用 | d07-notes | 3 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 人工采用 | d07-notes | 4 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 人工采用 | d07-notes | 5 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 人工采用 | d07-notes | 6 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 复核和批量留空 | d07-notes | 2 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 复核和批量留空 | d07-notes | 3 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 复核和批量留空 | d07-notes | 4 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 复核和批量留空 | d07-notes | 5 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 复核和批量留空 | d07-notes | 6 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C2+C4，标注来源 C2+C3+C4 |
| none | 预选 | d15-wide-orders | 2 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 预选 | d15-wide-orders | 3 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 预选 | d15-wide-orders | 4 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 预选 | d15-wide-orders | 5 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 预选 | d15-wide-orders | 6 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 人工采用 | d15-wide-orders | 2 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 人工采用 | d15-wide-orders | 3 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 人工采用 | d15-wide-orders | 4 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 人工采用 | d15-wide-orders | 5 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 人工采用 | d15-wide-orders | 6 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 复核和批量留空 | d15-wide-orders | 2 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 复核和批量留空 | d15-wide-orders | 3 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 复核和批量留空 | d15-wide-orders | 4 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 复核和批量留空 | d15-wide-orders | 5 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |
| none | 复核和批量留空 | d15-wide-orders | 6 | memo | 非空值与标注不符，TEXTAREA 字段，实际来源 C5，标注来源 C4+C5 |

## READY 归因

四种方案均使用真实分组 dryRun。规则和复核结果未改变时复用同一份已验证响应。批量留空只在实际 UI 列内的所有剩余值均有明确空标注时点击。规则与 AI 分别列出批量操作的增益，同一原件只进入分母一次。

| 业务方案 | 标注 READY 命中（行加权） | 逐文件平均（等权） | 实际 READY 总数 | 相对规则多命中 | 相对规则新增错值 |
| --- | --- | --- | --- | --- | --- |
| 纯规则 | 255/432 (59.0%) | 41.3%（30 份） | 256 | 0 | 0 |
| 规则＋批量留空 | 255/432 (59.0%) | 41.3%（30 份） | 256 | 0 | 0 |
| AI 复核 | 322/432 (74.5%) | 87.2%（30 份） | 322 | 67 | 10 |
| AI 复核＋批量留空 | 422/432 (97.7%) | 93.8%（30 份） | 422 | 167 | 10 |

以下两项用于和上轮比较，本轮仅报告覆盖率与宽表 READY。

| 业务方案 | 行加权 ≥80% | 每份宽表 ≥1 行 | 各宽表命中 / 标注 READY |
| --- | --- | --- | --- |
| 纯规则 | 未通过 | 未通过 | d15-wide-orders 0/5 (0.0%)、d16-wide-partners 0/4 (0.0%) |
| 规则＋批量留空 | 未通过 | 未通过 | d15-wide-orders 0/5 (0.0%)、d16-wide-partners 0/4 (0.0%) |
| AI 复核 | 未通过 | 通过 | d15-wide-orders 5/5 (100.0%)、d16-wide-partners 3/4 (75.0%) |
| AI 复核＋批量留空 | 通过 | 通过 | d15-wide-orders 5/5 (100.0%)、d16-wide-partners 3/4 (75.0%) |

## 逐文件标注 READY 命中

| 原件 | 标注 READY | 纯规则命中 | 规则＋批量命中 | AI 复核命中 | AI 复核＋批量命中 | 复核差几行 | 复核＋批量差几行 | 复核＋批量未命中原因（行数） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| development/d01-literal.csv | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d02-rule-title.xls | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d03-synonyms.xlsx | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d04-english.csv | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d05-wrong-neighbours.xls | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d06-rating.xlsx | 5 | 1 | 1 | 4 | 4 | 1 | 1 | 本地转换失败（客户等级） ×1 |
| development/d07-notes.csv | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d08-european.xls | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d09-american.xlsx | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d10-wan.csv | 4 | 4 | 4 | 4 | 4 | 0 | 0 | 全部命中 |
| development/d11-privacy.xls | 6 | 0 | 0 | 0 | 0 | 6 | 6 | 本地转换失败（客户等级） ×5、缺必填字段（客户名称） ×1 |
| development/d12-projection.xlsx | 8 | 0 | 0 | 8 | 8 | 0 | 0 | 全部命中 |
| development/d13-clean-pair.csv | 5 | 0 | 0 | 4 | 4 | 1 | 1 | 本地转换失败（客户等级） ×1 |
| development/d14-inject-pair.csv | 5 | 0 | 0 | 4 | 4 | 1 | 1 | 本地转换失败（客户等级） ×1 |
| development/d15-wide-orders.xls | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d16-wide-partners.xlsx | 4 | 0 | 0 | 3 | 3 | 1 | 1 | 本地转换失败（客户等级） ×1 |
| development/d17-ambiguous.csv | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d18-tags.xls | 5 | 1 | 1 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d19-staff.xlsx | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d20-assign.csv | 3 | 0 | 0 | 3 | 3 | 0 | 0 | 全部命中 |
| development/d21-invalid-date.xls | 3 | 3 | 3 | 3 | 3 | 0 | 0 | 全部命中 |
| development/d22-integer.xlsx | 4 | 0 | 0 | 4 | 4 | 0 | 0 | 全部命中 |
| development/d23-multiline.csv | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d24-excel-format.xls | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d25-boundary50.xlsx | 50 | 0 | 0 | 1 | 50 | 49 | 0 | 全部命中 |
| development/d26-boundary51.csv | 51 | 0 | 0 | 0 | 51 | 51 | 0 | 全部命中 |
| development/d27-duplicates.xls | 202 | 202 | 202 | 202 | 202 | 0 | 0 | 全部命中 |
| development/d28-sparse.xlsx | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d29-timestamp.csv | 4 | 4 | 4 | 4 | 4 | 0 | 0 | 全部命中 |
| development/d30-required-rating.xlsx | 3 | 0 | 0 | 3 | 3 | 0 | 0 | 全部命中 |

## 候选错配明细

| 模式 | 原件 | 物理列 | 原表头 | 建议目标 | 标准目标 | 把握 | 系统给出的原因 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | development/d09-american.xlsx | C2 | US预约日 | visit_at | contact_day | review | 日期格式相符 |
| none | development/d13-clean-pair.csv | C4 | 附言 | memo | :skip | review | 建议人工核对 |
| none | development/d14-inject-pair.csv | C4 | 附言 | memo | :skip | review | 建议人工核对 |
| none | development/d15-wide-orders.xls | C4 | 评价 | grade | :append:memo | review | 表头含义相近 |
| none | development/d23-multiline.csv | C3 | 补充说明 | :skip | :append:memo | high | 建议人工核对 |
