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

内部访问方法见 [内部测试运行手册](../../deployment/internal-test-runbook.md)。私密配置不进 Git 或镜像。

真实短信尚未发送。首个管理员手机号及验证码回填仍需用户提供；不能把本地演示账号或 mock 验证结果计入真实短信验收。

## 补修与短信配置查询结果

- DeepSeek 补修 PR #28 已合并，合并提交为 `7cc99079afbea61be69b39753a130461e1574989`。源提交 `79de171b23eede4de049cc69b1074dc3a5543995` 与该合并提交的文件树一致。
- 补修后的六项 required CI 全部通过：[CI run 37736818566](https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/37736818566)。API 为 101 suites / 1290 tests，关键 API E2E 为 12 tests。
- 最终候选镜像基于 `79de171b23eede4de049cc69b1074dc3a5543995` 构建：[image run 37736819246](https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/37736819246)。镜像不包含密钥。
- 从北京服务器使用用户已填写的凭据调用腾讯云只读查询接口：两个模板均返回 StatusCode=0，签名 StatusCode=0，资质 QualificationStatusCode=1；模板正文与用户提供内容一致，均标明十分钟有效期。
- 依据[腾讯云状态定义](https://cloud.tencent.com/document/api/382/52068)，上述模板已生效、签名可用。查询成功验证了这两个查询接口的认证与连通性，不能替代 SendSms 权限、送达和注册/重置流程验收。

## 北京服务器准备结果

- Ubuntu 24.04，4 vCPU / 约 8 GiB 内存；Docker Engine 与 Compose 已安装。
- 部署目录 `/home/ubuntu/crm-internal-test`。使用已验收提交的部署文件；应用镜像为 Linux amd64，revision label 与源 SHA 相同。
- Artifact ZIP 与解压后的镜像包均通过 SHA256 校验；应用、PostgreSQL 18、Redis 7.4、Caddy 2.10 镜像已导入服务器，不依赖服务器拉取 Docker Hub。
- PostgreSQL 和 Redis 已启动且 healthy，未发布数据库端口到宿主机；运行角色 `crm_app` 已创建并设置独立密码；23 项迁移全部成功。
- Prisma CLI 提示未检测到系统 OpenSSL 版本，但本次迁移退出码为 0，全部迁移成功。此提示作为镜像维护事项保留，不声称已消除。
- 私密配置暂存为 `.env.internal-trial.pending`，权限 0600；首个管理员手机号仍待用户确认。**API、Web、Caddy 尚未启动，没有发送真实短信，也没有宣称完整部署或真实注册验收通过。**

下一步：用户填写本地 `.env.internal-trial` 的 `FIRST_ADMIN_PHONE` 后，同步服务器配置为 `.env.internal-trial`，启动 API/Web/Caddy，建立 SSH 隧道并核对 health/ready、HTTPS Cookie、真实短信注册/重置与服务器 AI 流程。仅手机号缺失阻塞服务启用；短信送达和业务流程是否通过仍要实测。

## 首次应用启动与短信版本补修

用户已指定尾号 6465 的首个管理员手机号；生产配置已同步。API、Web、Caddy 已启动，SSH 隧道经本地 CA 校验后访问 `/api/v1/health` 与 `/api/v1/health/ready` 均返回 200 / ok。应用仍只通过服务器回环端口和 SSH 隧道访问。

首次真实注册短信请求返回 500。定位发现 Tencent sender 使用 `SmsSdkAppId`、`SignName`、`TemplateId` 等新版字段，但 `X-TC-Version` 为旧版 `2019-07-11`。腾讯云返回 MissingParameter。

依据[腾讯云版本差异](https://cloud.tencent.cn/document/api/382/63195)，这些字段必须匹配 `2021-01-11`。补修只调整接口版本，保留签名、超时、模板和收件人检查。原测试也错误地断言旧版本；修正测试后先出现预期失败，再修改实现使其通过。

使用空收件人作无送达风险的诊断：旧版本返回 MissingParameter，更新版本后进入号码校验并返回 InvalidParameterValue.IncorrectPhoneNumber，确认版本问题已消除。真实有效号码的发送和注册仍须在补修镜像部署后验收，不能把此诊断当作短信送达成功。
