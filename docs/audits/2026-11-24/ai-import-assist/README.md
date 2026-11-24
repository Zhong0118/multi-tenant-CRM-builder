# AI 帮我对列验收

迁移 0062 将「AI 导入」登记为数据处理功能。平台管理员可将它加入套餐。已有套餐沿用原来的功能清单。预览返回字段与取值对照，正式写入沿用现有导入接口。无套餐的用户仍可手动对照、检查和导入。

## 规格第 2 节 · 发给模型的内容

| 规则 | 证据及判定方法 |
| --- | --- |
| 当前成员、套餐、已发布表和导入权先于生成。取回方案时复核权限和发布版本 | [真实 HTTP E2E](../../../../apps/api/test/import-assist.e2e-spec.ts) 覆盖无权益、撤销导入权、跨租户、发布版本变化；未授权请求的模型计数应为零。 |
| 当前可导入字段、在用选项仅通过请求内引用传递。员工可见范围不同 | [策略测试](../../../../apps/api/src/modules/ai/import-assist-policy.spec.ts) 检查字典、选项冲突、跨列引用与占用。HTTP 测试在计量层后的模拟 provider 读取实际入参。 |
| 任一候选表头命中负责人、受限字段名或键时，所有候选均剔除同一物理列 | [浏览器预览测试](../../../../apps/web/src/features/records/record-import-assist.test.ts) 检查前十行证据；策略测试覆盖锁定表头、证据缺失和系统列。 |
| 只发未决项目；样例最多 5 个，低基数枚举不超过 50，频次来自整列。人工和规则锁定列受保护 | 浏览器预览测试覆盖已解数据零调用、人工映射后的未决选项、高基数、真实计数和多选。策略测试覆盖改用新表头时保留原占用。 |
| 手机、座机、邮箱、证件和银行卡先打码再截到 40 字。自由文本取形状，掩码碰撞分别使用值 ID | 浏览器预览测试和策略测试覆盖打码顺序与碰撞。HTTP 测试断言隐藏列的原值、字段键和完整个人信息均未到达模拟 provider。冻结样本另在真实调用前检查哨兵。 |
| 浏览器请求 ≤80 KiB，厂商预算 ≤48 KiB。裁剪后不能回译已移除的字段或枚举 | 浏览器预览测试的 maximum dictionary pressure、策略测试的 UTF-8 budget，以及[出站请求](../../../../apps/api/src/modules/ai/providers/vercel-openai.provider.ts)的整体预算检查。 |
| 取消、额度和计量沿用治理入口。账本只存用量元数据 | [模型请求测试](../../../../apps/api/src/modules/ai/governance/model-runtime.spec.ts) 检查两种推理模式均只发一次；[计量层测试](../../../../apps/api/src/modules/ai/governance/model-meter.spec.ts)覆盖额度和结算；[抽屉测试](../../../../apps/web/src/features/records/record-import.test.tsx)覆盖取消与手动草稿。 |

## 规格第 5 节 · 按行负责人、查重和重试

| 规则 | 证据及判定方法 |
| --- | --- |
| 仅管理员能按行指定在职成员。空白、重名、停用和未匹配需手选；未开公共池禁选 | [负责人分组测试](../../../../apps/web/src/features/records/record-import-groups.test.ts)、[API E2E](../../../../apps/api/test/record-pool-lifecycle.e2e-spec.ts)覆盖姓名匹配、员工和跨租户请求。 |
| 同一文件共用批号，保留物理行号，每批最多 100 行，执行既有字节限制 | [文件解析测试](../../../../apps/web/src/features/records/record-import-file.test.ts)及[分批测试](../../../../apps/web/src/features/records/record-import-batches.test.ts)；浏览器纯函数复用同一转换入口。 |
| 全组串行检查，按原行号归并，第一条可导行保留，按原权限查重 | 分组测试覆盖跨组、跨批 READY 和重复项；API E2E 覆盖已有记录、负责人和首行无效。 |
| 只对完整检查中的 READY 行执行。结果按行合并，断线待重查，同一行重试不重复写入 | 分组测试覆盖不完整检查、取消和未确认响应；API E2E 检查创建数、归属、审计及并发。 |
| 有部分成功时重新检查后续行，下载失败行仍能取回原文件值 | [第一批逐项测试和浏览器证据](../ai-import/README.md#第-5-节核对表)。 |

## 规格第 7 节 · 交付指标

| 规则 | 证据及判定方法 |
| --- | --- |
| 一条目录记录，无默认授权，正常计量 | [目录测试](../../../../apps/api/src/modules/ai/governance/feature-catalog.spec.ts)及[数据库集成测试](../../../../packages/database/test/integration/ai-governance.test.mjs)。 |
| 先冻结开发 30 份、留出 10 份，再调提示词 | [冻结清单和验证方法](../../../../apps/api/test/evals/import-assist/fixtures/README.md)。提交 f808ea8，CSV、XLS、XLSX 原件与标准答案有 82 个 SHA-256。 |
| 列错配和高把握错配分别 ≤2% 和 ≤1%，另报覆盖、枚举、表头 | 每组单独评分；手动采用的低把握建议与自动采用分开统计。高把握分母为空时不能据此判定达标。 |
| 注入和隐私零泄露 | 每份文件在 provider 入口检查隐私哨兵，比较注入对照文件，任何命中即阻断外发。被阻断的请求单列。 |
| 业务指标为真实 dryRun 的 READY / 原始行总数 | 使用相同身份、数据和源行比较规则基线与 AI；另核对 READY 的字段值以及记录、审计和行凭据计数。 |
| 每文件最多一次调用；默认推理与关闭推理分别报告耗时、token、40 列子集及超时 | 只有实际发出并返回的请求用于成功延迟统计。阻断、失败、零调用和超时单列。 |
