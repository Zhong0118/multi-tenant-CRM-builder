# 通用公海发布前复验

日期：2026-10-18。用户在本地试用说明后授权推送并供公司在服务器测试，本次授权替代此前“仅本地”的发布限制。基线为 `dc41d250a43e26575399261e409446a17bc2a2b0`，仅发布通用公海、未指定负责人筛选及相关复核修复；不纳入现有未跟踪的 `docs/user-guide/`。

## 本轮新执行的验证

- API：104 suites / 1460 tests 通过；既有 Redis 专项 1 suite / 3 tests 未在此本地命令运行，交由 CI 的独立 Redis 服务验证。
- Web：降低为 2 workers 后全量 97 files / 814 tests 通过，架构检查通过。首次默认高并发运行有 3 项等待/测试超时，受控并发重跑没有修改产品代码或放宽断言。
- Worker、Contracts、Database schema、Tenant Templates 单元测试通过。
- 全工作区类型检查通过，重新生成的 OpenAPI 与待发布文件哈希完全一致。
- 独立 PostgreSQL 空库应用 32 份迁移，25 项保护、到期和配置并发测试通过；32 项新旧公海和动态记录 HTTP 回归通过。
- HTTP 测试启动时必须显式设置 DATABASE_URL、DATABASE_ADMIN_URL、TEST_DATABASE_URL、TEST_DATABASE_ADMIN_URL 指向同一个隔离库。仅在 harness 中后设 DATABASE_URL 会晚于 ConfigModule 加载本地 .env，出现 401；显式指定后全部通过。测试期间没有修改真实业务记录。
- Web 受影响文件 ESLint 通过。API 除 records.service.spec.ts 的 14 项既有问题外通过；对 HEAD 原文件运行 ESLint 并比较规则及消息，14 项完全相同，无新增问题。不宣称全仓 lint 通过。
- 已跟踪改动的 git diff --check 通过；新增文件暂存检查提示 0030 迁移末尾多一个空行。该迁移已在本地应用，为保持校验和一致保留原文件，属于格式提示。隔离测试容器及其临时卷已删除。

## 发布操作及数据保护

计划使用 GitHub 的 Internal Trial Image 构建 Linux amd64 镜像，源站保持当前 HTTPS IP。部署前校验包哈希、镜像架构及 revision 标签。保留旧镜像，备份私密配置、数据库与附件；短暂停止 API 写入后比较 22 类业务表的记录数量及原有列摘要，新增字段不参与原列摘要比较。只有一致才启动新 API/Web，PostgreSQL、Redis、Caddy 及原数据卷不重建。

迁移仅追加字段、索引、触发器或替换函数，不自动启用分阶段流转，不将旧记录归类。公司管理员需要在业务表的公共池设置中显式启用并配置成交保护来源。生产检查使用只读事务，不通过生产客户进行领取/释放演练，不额外发送短信或调用真实 AI。

本文记录发布前验证，实际发布提交、CI 结果、备份路径和线上检查结果以最终部署记录为准。
