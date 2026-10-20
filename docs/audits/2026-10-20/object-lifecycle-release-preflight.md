# 整表停用与恢复发布前补核

2026-10-20。用户已在本地验收，授权推送 GitHub、部署并保护已有公司数据。

首次推送34b0698触发CI39416526364：类型、合同、构建、Critical API E2E通过；完整单元和数据库集成暴露了上轮聚焦验证遗漏。没有部署这个失败检查的版本。

- AI只读工具共用的内存测试夹具缺少新的 resolveCurrentObject 接口，4个文件10项失败，本地完整复现。补齐夹具，与已有服务单测内存存储一致；未改变生产权限/生命周期检查。
- 两项旧数据库测试仍要求源表单纯停用导致成交保护待复核，与新停用保留保护语义冲突。本地隔离库复现。并发断言区分实际规则撤销与单纯停用；“发布替换”旧测试实际只停用表，现改为真正撤销源发布，并仍要求待复核；增加停用/恢复前后完整保护元数据相等测试。

补修后的本地完整验证：

- pnpm test：API107 suites/1498passed/3既有skipped；Web99files/856passed及3项架构测试；Worker、Contracts、Database schema、Tenant templates通过。日志 /tmp/crm-table-release-all-tests.log。
- 独立 PostgreSQL 127.0.0.1:55436/crm_test 下运行 pnpm --filter @crm/database test:integration：80项通过，0失败。日志 /tmp/crm-table-db-final.log。
- 没有修改生产实现或迁移，没有调用真实AI/SMS，没有修改公司业务数据。

服务器切换前仍须备份、停止API写入、执行0034/0035增量迁移并比较业务行摘要；只新增元数据及触发函数，不能清库、复制本地演示数据或覆盖线上配置。实际部署结果另行记录。
