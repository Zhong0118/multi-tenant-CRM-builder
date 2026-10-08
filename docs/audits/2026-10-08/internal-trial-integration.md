# 内部试用整合与真实 AI 复核

## 已完成的整合

- Redis INCR/EXPIRE 改为单次 Lua 操作，并修复历史无 TTL 键；真实 Redis 回归覆盖并发限额、历史键和窗口不延长。
- 系统 PR #26 与前端 PR #27 均在六项 required CI 通过后合并。整合后的 main 为 `45c5c180869bc44b9b1b1a402a02df42370d1665`。
- 本地整合验证：API 101 suites / 1285 tests；Web 654 tests 与 3 项架构测试；monorepo typecheck、build、contracts 通过。
- 浏览器测试覆盖 Admin/Employee、1440/900/390：核心流程 44 项、记录草稿 26 项、AI 22 项、重试 17 项、AI 快捷键 15 项通过。检查了响应式截图。
- 全仓 API lint 有既有 434 errors / 13 warnings，系统基线相同；Web 无 lint error，有一项既有 warning。不能将全仓 lint 声称为通过。

## 真实 DeepSeek 发现的问题

隔离演示数据库上的真实 CRM API 调用失败：`propose_change` 工具根 schema 是 discriminated union，而 DeepSeek 要求根 schema 为 object。该工具始终包含在请求中，因此只读查询也会失败。模拟 Provider 测试没有发现此问题。

修复：工具输入描述采用对象结构，字段约束复用原 schema；执行时继续使用原严格操作判别 schema，拒绝缺失字段、跨操作字段和 actor/tenant 注入。修改建议仍需人工确认，不扩大模型写权限。

验证：

- 先运行根对象回归测试，原实现失败；修复后通过。
- AI 模块 22 suites / 235 tests 通过；最后的 collector 9 项测试、API typecheck、修改文件 ESLint 通过。
- API build 通过。
- 使用真实 `deepseek-flash` 与实际 CRM Provider/Responses API：只读客户查询收到工具事件、来源和 `turn.completed`。
- 实际生成 `ADD_ACTIVITY_NOTE` 建议，收到 `proposal.ready` 和 `turn.completed`；通过拒绝接口返回 HTTP 200 / `REJECTED`，没有确认或执行记录修改。
- 独立只读代码复核未发现阻塞问题。

## 部署与验收边界

服务器 Docker/Compose 已准备。首次构建的旧镜像没有包含上述真实 Provider 修复，不能作为最终部署版本；需要从修复后的已验收提交重新构建。

内部访问方法见 [内部测试运行手册](../../../deployment/internal-test-runbook.md)。私密配置不进 Git 或镜像。

真实短信尚未发送。首个管理员手机号、两个模板的审核/报备状态及验证码回填仍需用户确认；不能把本地演示账号或 mock 验证结果计入真实短信验收。服务器运行结果应在实际部署后追加。
