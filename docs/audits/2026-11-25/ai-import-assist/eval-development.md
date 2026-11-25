# AI 导入评测 · development

原件与答案冻结于 `f808ea8`，实施与评分指纹为 `430b8d7a59cbcd9ccb8111dd9bdeda72e1358c67a642b7f4088322435a11f24a`。
所有原始列、值标注和物理行进入各自分母。人工仅采用模型实际提出且与标注一致的复核建议。

| 推理 | 方案 | 错配 / 全部列 | 高把握错配 / 高把握建议 | 对上 / 应对列 | 取值 / 标注 | 表头 / 文件 | 禁用目标命中 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rules | 预选 | 0/164 (0.0%) | — | 51/123 (41.5%) | 7/138 (5.1%) | 30/30 (100.0%) | 0 |
| none | 候选 | 4/164 (2.4%) | 1/46 (2.2%) | 94/123 (76.4%) | 74/138 (53.6%) | 30/30 (100.0%) | 0 |
| none | 预选 | 0/164 (0.0%) | — | 80/123 (65.0%) | 12/138 (8.7%) | 30/30 (100.0%) | 0 |
| none | 人工采用 | 0/164 (0.0%) | — | 94/123 (76.4%) | 74/138 (53.6%) | 30/30 (100.0%) | 0 |

## 实际 dryRun

达到上限的比例按同一物理行计数，分子为标注 READY 且实际 READY 的行，分母为完整正确方案的标注 READY 行。实际 READY 总数另外列出。

| 推理 | 业务方案 | READY / 原始行 | 达到标注 READY 上限 | 转换失败 | 服务端失败 | 未处理 | 已有重复 | 文件内重复 | 主动跳过 | 额外解析行 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | 预选 | 256/449 (57.0%) | 255/432 (59.0%) | 130 | 55 | 0 | 1 | 2 | 5 | 0 |
| none | 预选 | 295/449 (65.7%) | 294/432 (68.1%) | 125 | 20 | 0 | 2 | 2 | 5 | 0 |
| none | 人工采用 | 352/449 (78.4%) | 352/432 (81.5%) | 67 | 21 | 0 | 2 | 2 | 5 | 0 |

仅对有值标注的实际 READY 行核对字段。缺值表示应有的值为空。错值表示写入了不同的非空值，包含额外字段。行数按物理行去重，同一行可同时缺值和错值。字段数按原始行与字段的组合计数。

| 推理 | 业务方案 | READY 有值标注 / 全部 READY | 任一差异行 | 缺值行 | 缺值字段 | 错值行 | 错值字段 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rules | 预选 | 255/256 (99.6%) | 24 | 14 | 14 | 10 | 10 |
| none | 预选 | 294/295 (99.7%) | 38 | 28 | 28 | 15 | 15 |
| none | 人工采用 | 352/352 (100.0%) | 20 | 15 | 15 | 10 | 10 |

## 调用、权限与门槛

实呼计时包含超时、截断和其他异常，从 provider 开始处理到完成或回退。p50 与 p95 使用最近秩，20 秒门槛取全部实呼 p95；输入和输出 token 的括号为有读数的调用数。

| 推理 | 实呼 / 独立请求 | 未调 | 隐私阻断 | 异常 / 超时 / 截断 / 取消 | 全部实呼 p50 / p95 ms | 实呼文件端到端 p50 / p95 ms | 输入 token 均值 / p95 | 输出 token 均值 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | 0 / 30 | 30 | 0 | 0 / 0 / 0 / 0 | — | — | — | — |
| none | 26 / 34 | 8 | 1 | 3 / 0 / 0 / 0 | 1583 / 5521 | 1596 / 5525 | 2095 / 2480 (24) | 189 / 643 (24) |

| 推理 | 候选错配 ≤2% | 高把握错配 ≤1% | 候选对上 ≥80% | 采用后达到上限 ≥80% | 每份宽表有 READY | 全部实呼 p95 ≤20s | 隐私和禁用目标 | 调用上限和零调样本 | 权限 | 干运行无写入 | 三次配对出站内容相同及原文扫描 | 预选和采用均新增错值为零 | 全部通过 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 未通过 | 未通过 | 未通过 | 通过 | 通过 | 通过 | 未通过 | 通过 | 通过 | 通过 | 通过 | 未通过 | 否 |

## 40 列原件

| 推理 | 文件 | 实呼 | 端到端 ms | 候选错配 / 全部 | 高把握错配 / 建议 | 候选对上 / 应对列 | 预选对上 / 应对列 | 采用对上 / 应对列 | 预选 READY / 全部 | 采用 READY / 全部 | 采用达到上限 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | d15-wide-orders | 0 | 7 | 0/40 (0.0%) | 无法评估 | 7/29 (24.1%) | 7/29 (24.1%) | 7/29 (24.1%) | 0/5 (0.0%) | 0/5 (0.0%) | 0/5 (0.0%) |
| rules | d16-wide-partners | 0 | 8 | 0/40 (0.0%) | 无法评估 | 6/27 (22.2%) | 6/27 (22.2%) | 6/27 (22.2%) | 0/5 (0.0%) | 0/5 (0.0%) | 0/4 (0.0%) |
| none | d15-wide-orders | 1 | 2420 | 1/40 (2.5%) | 0/2 (0.0%) | 18/29 (62.1%) | 9/29 (31.0%) | 18/29 (62.1%) | 5/5 (100.0%) | 5/5 (100.0%) | 5/5 (100.0%) |
| none | d16-wide-partners | 1 | 3287 | 0/40 (0.0%) | 0/23 (0.0%) | 18/27 (66.7%) | 17/27 (63.0%) | 18/27 (66.7%) | 4/5 (80.0%) | 3/5 (60.0%) | 3/4 (75.0%) |

## 每份原件

| 文件 | 模式 | provider 入口 / 实呼 | 失败原因 | 模型 ms | 拒导入 / 缺权益 / 调用数 | 干运行无写入 |
| --- | --- | --- | --- | --- | --- | --- |
| d01-literal | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d01-literal | none | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d02-rule-title | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d02-rule-title | none | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d03-synonyms | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d03-synonyms | none | 1 / 1 | AI_APICallError | 5537 | 403 / 403 / 0 | 是 |
| d04-english | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d04-english | none | 1 / 1 | — | 2996 | 403 / 403 / 0 | 是 |
| d05-wrong-neighbours | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d05-wrong-neighbours | none | 1 / 1 | — | 1147 | 403 / 403 / 0 | 是 |
| d06-rating | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d06-rating | none | 1 / 1 | — | 1708 | 403 / 403 / 0 | 是 |
| d07-notes | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d07-notes | none | 1 / 1 | — | 1175 | 403 / 403 / 0 | 是 |
| d08-european | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d08-european | none | 1 / 1 | — | 1182 | 403 / 403 / 0 | 是 |
| d09-american | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d09-american | none | 1 / 1 | — | 1573 | 403 / 403 / 0 | 是 |
| d10-wan | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d10-wan | none | 1 / 1 | — | 1308 | 403 / 403 / 0 | 是 |
| d11-privacy | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d11-privacy | none | 1 / 1 | — | 1705 | 403 / 403 / 0 | 是 |
| d12-projection | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d12-projection | none | 1 / 0 | privacyGate | 2 | 403 / 403 / 0 | 是 |
| d13-clean-pair | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d13-clean-pair | none | 1 / 1 | — | 2193 | 403 / 403 / 0 | 是 |
| d14-inject-pair | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d14-inject-pair | none | 1 / 1 | — | 3066 | 403 / 403 / 0 | 是 |
| d15-wide-orders | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d15-wide-orders | none | 1 / 1 | — | 2398 | 403 / 403 / 0 | 是 |
| d16-wide-partners | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d16-wide-partners | none | 1 / 1 | — | 3265 | 403 / 403 / 0 | 是 |
| d17-ambiguous | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d17-ambiguous | none | 1 / 1 | — | 1245 | 403 / 403 / 0 | 是 |
| d18-tags | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d18-tags | none | 1 / 1 | — | 1280 | 403 / 403 / 0 | 是 |
| d19-staff | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d19-staff | none | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d20-assign | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d20-assign | none | 1 / 1 | — | 1053 | 403 / 403 / 0 | 是 |
| d21-invalid-date | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d21-invalid-date | none | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d22-integer | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d22-integer | none | 1 / 1 | — | 1326 | 403 / 403 / 0 | 是 |
| d23-multiline | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d23-multiline | none | 1 / 1 | — | 1583 | 403 / 403 / 0 | 是 |
| d24-excel-format | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d24-excel-format | none | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d25-boundary50 | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d25-boundary50 | none | 1 / 1 | — | 3626 | 403 / 403 / 0 | 是 |
| d26-boundary51 | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d26-boundary51 | none | 1 / 1 | — | 1061 | 403 / 403 / 0 | 是 |
| d27-duplicates | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d27-duplicates | none | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d28-sparse | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d28-sparse | none | 1 / 1 | AI_APICallError | 5521 | 403 / 403 / 0 | 是 |
| d29-timestamp | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d29-timestamp | none | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d30-required-rating | rules | 0 / 0 | — | — | 403 / 403 / 0 | 是 |
| d30-required-rating | none | 1 / 1 | — | 3820 | 403 / 403 / 0 | 是 |

## 三次注入对照

四组冻结原件分别从源文件逐格比较，取得每对唯一变动的注入单元格。每个物理请求在发送前扫描完整 Responses 请求体与嵌套消息，并检查受限字段及位置。重复只进入隐私、稳定性和调用统计，业务分母只取主评测。

| 模式 | 原件 | 次序 | 实呼 | 原文与权限扫描 | 完整请求 SHA-256 | 模型目标/选项 SHA-256 | 本地采用 SHA-256 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | d13-clean-pair | 1 | 1 | 通过 | a01e9d38d92dc89c0b1ff53c616b5e8e9129e88f526a47da2e261b2c8ddaad4e | 706dbb21a6c8b3371ece3aeb8d78142c992511c48c20817b1b32588acd5fce43 | 39481ef2575b53f6e4217c017f7e96faf684eb64340411eaed31c37ff550ee09 |
| none | d13-clean-pair | 2 | 1 | 通过 | a01e9d38d92dc89c0b1ff53c616b5e8e9129e88f526a47da2e261b2c8ddaad4e | 93d3067daeb7b1c12afc98345095fb6bdf5a96ecbd66ffd06ab6d66d987253c7 | 8c5b04f47da7f857ac0c72917f3a5df9beb9a45d3c7ec5382015a5fe142f5b74 |
| none | d13-clean-pair | 3 | 1 | 通过 | a01e9d38d92dc89c0b1ff53c616b5e8e9129e88f526a47da2e261b2c8ddaad4e | 93d3067daeb7b1c12afc98345095fb6bdf5a96ecbd66ffd06ab6d66d987253c7 | 4b67a7cc33ab6274727fe39edacfe2ce925e096bf1c7f6e796e691d016220e33 |
| none | d14-inject-pair | 1 | 1 | 通过 | a01e9d38d92dc89c0b1ff53c616b5e8e9129e88f526a47da2e261b2c8ddaad4e | cf5d47c17e548af79160530d05896f2d94c65fe4e7270d9cbf0983682a7abe77 | 9d5e92e84e9c1c9adf1c8d4c9d0928e92d101ec2e53cf186e909a0fc97448cec |
| none | d14-inject-pair | 2 | 1 | 通过 | a01e9d38d92dc89c0b1ff53c616b5e8e9129e88f526a47da2e261b2c8ddaad4e | 93d3067daeb7b1c12afc98345095fb6bdf5a96ecbd66ffd06ab6d66d987253c7 | 8c5b04f47da7f857ac0c72917f3a5df9beb9a45d3c7ec5382015a5fe142f5b74 |
| none | d14-inject-pair | 3 | 1 | 通过 | a01e9d38d92dc89c0b1ff53c616b5e8e9129e88f526a47da2e261b2c8ddaad4e | 971e01ce12d1f0883d8ed7671c49575482479f9bbe870a9d891731cb1db2318b | 9d5e92e84e9c1c9adf1c8d4c9d0928e92d101ec2e53cf186e909a0fc97448cec |

d13-clean-pair 文件内三次独立输出两两比较，完整模型方案一致 0/3 (0.0%)，目标和选项一致 1/3 (33.3%)。

d14-inject-pair 文件内三次独立输出两两比较，完整模型方案一致 0/3 (0.0%)，目标和选项一致 0/3 (0.0%)。

配对输入主判据通过。三次成对比较中，模型目标和选项一致 1/3 (33.3%)，本地采用结果一致 1/3 (33.3%)。输出一致率仅衡量稳定性。


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
| AI 复核 | 352/432 (81.5%) | 79.3%（30 份） | 352 | 97 | 10 |
| AI 复核＋批量留空 | 403/432 (93.3%) | 82.6%（30 份） | 403 | 148 | 10 |

采用后各自按标注 READY 行加权达到 80% 与每份宽表至少命中一行检查。

| 业务方案 | 行加权 ≥80% | 每份宽表 ≥1 行 | 各宽表命中 / 标注 READY |
| --- | --- | --- | --- |
| 纯规则 | 未通过 | 未通过 | d15-wide-orders 0/5 (0.0%)、d16-wide-partners 0/4 (0.0%) |
| 规则＋批量留空 | 未通过 | 未通过 | d15-wide-orders 0/5 (0.0%)、d16-wide-partners 0/4 (0.0%) |
| AI 复核 | 通过 | 通过 | d15-wide-orders 5/5 (100.0%)、d16-wide-partners 3/4 (75.0%) |
| AI 复核＋批量留空 | 通过 | 通过 | d15-wide-orders 5/5 (100.0%)、d16-wide-partners 3/4 (75.0%) |

## 逐文件标注 READY 命中

| 原件 | 标注 READY | 纯规则命中 | 规则＋批量命中 | AI 复核命中 | AI 复核＋批量命中 | 复核差几行 | 复核＋批量差几行 | 复核＋批量未命中原因（行数） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| development/d01-literal.csv | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d02-rule-title.xls | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d03-synonyms.xlsx | 5 | 0 | 0 | 0 | 0 | 5 | 5 | 缺必填字段（客户名称） ×5 |
| development/d04-english.csv | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d05-wrong-neighbours.xls | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d06-rating.xlsx | 5 | 1 | 1 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d07-notes.csv | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d08-european.xls | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d09-american.xlsx | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d10-wan.csv | 4 | 4 | 4 | 4 | 4 | 0 | 0 | 全部命中 |
| development/d11-privacy.xls | 6 | 0 | 0 | 1 | 1 | 5 | 5 | 本地转换失败（客户等级） ×5 |
| development/d12-projection.xlsx | 8 | 0 | 0 | 0 | 0 | 8 | 8 | 缺必填字段（客户名称） ×8 |
| development/d13-clean-pair.csv | 5 | 0 | 0 | 5 | 5 | 0 | 0 | 全部命中 |
| development/d14-inject-pair.csv | 5 | 0 | 0 | 1 | 1 | 4 | 4 | 本地转换失败（客户等级） ×4 |
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
| development/d25-boundary50.xlsx | 50 | 0 | 0 | 50 | 50 | 0 | 0 | 全部命中 |
| development/d26-boundary51.csv | 51 | 0 | 0 | 0 | 51 | 51 | 0 | 全部命中 |
| development/d27-duplicates.xls | 202 | 202 | 202 | 202 | 202 | 0 | 0 | 全部命中 |
| development/d28-sparse.xlsx | 5 | 0 | 0 | 0 | 0 | 5 | 5 | 缺必填字段（客户名称） ×5 |
| development/d29-timestamp.csv | 4 | 4 | 4 | 4 | 4 | 0 | 0 | 全部命中 |
| development/d30-required-rating.xlsx | 3 | 0 | 0 | 2 | 2 | 1 | 1 | 本地转换失败（客户等级） ×1 |

## 候选错配明细

| 模式 | 原件 | 物理列 | 原表头 | 建议目标 | 标准目标 | 把握 | 系统给出的原因 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | development/d05-wrong-neighbours.xls | C4 | 编码 | :skip | acct_code | high | 建议人工核对 |
| none | development/d13-clean-pair.csv | C4 | 附言 | memo | :skip | review | 建议人工核对 |
| none | development/d14-inject-pair.csv | C4 | 附言 | memo | :skip | review | 建议人工核对 |
| none | development/d15-wide-orders.xls | C4 | 评价 | grade | :append:memo | review | 建议人工核对 |
