# 收口轮测试

| 本机检查 | 结果 |
| --- | ---: |
| 全仓类型检查 | 通过 |
| OpenAPI 契约漂移检查 | 通过 |
| API 全量单测 | 2,101/2,101 |
| Web 全量单测 | 1,559/1,559 |
| 导入相关 HTTP E2E | 40/40 |
| PostgreSQL 集成测试 | 110/110 |
| 架构检查 | 3/3 |
| 评测计分器回归 | 7/7 |

HTTP E2E 覆盖 import-assist、record-pool-lifecycle、dynamic-records 和 create-only-fields，使用本机独立库。真实模型评测另用专库，权限拒绝和干运行写入情况逐文件记录。第一次全仓类型检查与临时截图页面删除撞在一起，清理完成后重新运行通过。截图通过项目的真实抽屉组件与合成 CSV 拍摄。该操作停在表头选择处。[截图及操作记录](browser/README.md)
