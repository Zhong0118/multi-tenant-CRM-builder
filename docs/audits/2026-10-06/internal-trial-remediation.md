# 内部试用修复证据账本

日期：2026-10-06。状态：**CODE SHA `58da1ce` / PR #26 OPEN / SIX CI CHECKS SUCCESS / NOT MERGED / NOT DEPLOYED**。本轮文档 follow-up 尚未形成新的 CI SHA；文档改动后的 latest CI 仍待主 agent 核实。

## 范围与基线

- 工作树：`.worktrees/crm-product-experience-v2-slice-4`；本地分支 `codex/internal-trial-preparation`，基线 `c400b32`。PR #26 远端分支为 `codex/crm-product-experience-v2-slice-4`，根 `main` 落后，禁止用作本轮入口。
- 代码 SHA `58da1ce` 已推送至 PR #26；GitHub run `37444823699` 六项 required checks 全部 SUCCESS，`gh checks --watch` exit0。该 Build 2m50 包含无缓存 full Docker、offline pnpm 与 internal-network migration 两次门禁 PASS。文档 follow-up 会产生新的文档提交，不能把 `58da1ce` 当作文档后的永久 head；文档 follow-up latest CI 仍待主 agent 核实。旧 run `37417884483` 仅作历史证据。
- 用户授权 D01-D04、F01-F03、验证码修复验证及 PR 更新/push；仍禁止合并、部署、清理。本文记录当前工作树证据，不代表已合并或已部署。
- 保留用户的 `internal-trial-independent-review.md` 与 `docs/superpowers/briefs/2026-10-06-frontend-polish-handoff.md`，不修改或清理。本文按主 agent 提供的观察记录，不代表文档 agent 独立重跑浏览器/测试。

## 逐项状态

| 项目 | 当前改动与已取得证据 | 未完成边界 |
|---|---|---|
| D01 根 tsconfig 缺失 | Docker COPY 已加入根 `tsconfig.base.json`；独立 COPY 布局曾复现 TS5083；run `37444823699` 的无缓存 full Docker Build PASS | 代码/自动门禁已验证；生产部署仍未执行 |
| D02 migration 运行时下载 pnpm | tooling 在构建期准备 pnpm 11.19.0，build/runtime 共用，runtime `COREPACK_ENABLE_NETWORK=0` | 空 cache + `--network none` 真实 RED exit1；fixed `docker build --target tooling -t crm-trial-review:tooling .` exit0，`docker run --rm --network none -e COREPACK_ENABLE_NETWORK=0 crm-trial-review:tooling pnpm --version` 输出11.19.0/exit0。仅 tooling 离线 pnpm 已验证；完整应用镜像第二次 retry 仍 fetch failed，migration 容器 PENDING |
| D03 双域 Cookie/SSR | Compose 统一公开 `WEB_ORIGIN`；Caddy `/api/v1/*` 反代 API，其余到 Web。真实浏览器登录→`/workspace/nebula-demo`→刷新完整 dashboard；Secure/HttpOnly/host-only localhost session cookie；退出清 cookie 后访问 workspace 回 login | 仅真实本地 Caddy `https://localhost:3443`，内部自签证书绕过浏览器信任。公网 DNS/TLS、完整生产 Compose 启动 NOT VERIFIED |
| D04 代理短信 IP 共额/伪造头 | 固定 edge `172.30.26.0/24`，Caddy `.2`、API `.3`、Web `.4`，API 只信精确 Caddy IP；Caddy 覆盖 XFF。真实 `.10`/`.11` 两客户端同伪造 XFF 得真实各自 IP，Echo upstream remote `.2`；bounded-proxy 8 tests pass，含 untrusted spoof/default deny/safe exactIP；实际 Nest auth-proxy 主复验3 suites/11 tests pass，63次HTTP验证：同客户端20→429、第二客户端独立20→429、untrusted spoof20→429，拒绝时无 challenge/send；repository/sender 边界 fake，实际 controller/service/limiter | Echo 证明代理转发边界，不等于真实短信 provider 验收；公网拓扑和真实 SMS limiter PENDING |
| F01 旧保存关闭新编辑会话 | 真实浏览器 delayed PATCH200，取消并重新编辑后新 remark retained，saveEnabled=true；聚焦回归通过 | 仅该已观察路径，非所有角色/视口/异步矩阵 |
| F02 AI 重命名失败关闭/旧请求干扰新弹窗 | 真实本地 Playwright + AntD：隔离 DB fixture 会话，无 AI provider 调用；route 注入 PATCH500，dialog visible=true，输入 `draft retained browser`，role alert 显示“重命名失败，请重试”，标题输入仍保留。实际 UI500 failure-retention PASS | 旧会话 race 仍仅组件测试证据；不把该一次真实失败路径扩大为完整 AI 浏览器矩阵 |
| F03 停用/关闭租户邀请注册 | 单一 `0023` 迁移补最小列权限及 tenant SELECT policy，函数仅允许 DRAFT/ACTIVE；干净隔离库23迁移成功。实际 crm_app 函数调用、DRAFT bootstrap、停用/关闭拒绝、角色/ACL/RLS 数据库回归通过 | 生产数据库未迁移；真实外部短信仍未验证 |
| 验证码错误次数事务回滚 | RED：真实 AuthService + Prisma 首错 expected1/actual0、8并发 expected5/actual0。修复后主 agent 独立执行 Critical API E2E：2 suites / 11 tests / exit0；REGISTER 每次持久化、第5次LOCKED，8并发只计5且均400；RESET并发锁定；成功消费后业务异常回滚，随后成功消费与密码写入通过 | 使用真实 PostgreSQL、crm_app runtime；短信发送与密码哈希边界是测试替身，不代表真实短信送达。原自写 SQL 并发测试已移除，不作为产品路径证据 |

## 最新 Important：验证码连接池并发修复 PENDING

旧版 12 并发负载曾通过，但未稳定复现 RED，不能作为池风险已解决证据。当前风险来自 preflight 后内层 transaction 残留占用连接，catch 中再取计数连接；auth agent 正改为统一事务释放后再计数。12+ 并发回归必须稳定覆盖该路径。

上述 Critical API E2E 2 suites/11 pass、DB integration 36 pass、full typecheck/build/contracts exit0 是已取得的当时事实，不构成最终收口。最终 reviewer 新发现：验证码错误计数在已占用 transaction pool 连接时再申请独立连接，达到或超过10并发可能导致连接池饥饿。Auth agent 正在修复并补12及以上并发回归；当前状态 **PENDING further remediation / NOT COMPLETE**。新修复后必须重新验证 REGISTER/RESET 错误计数、五次锁定、并发有界完成和正确码消费/业务回滚原子性，再补绑定最新 SHA 的 CI。当前未提交，不声明 merge-ready。

## 当前聚焦验证

- F01/F02 agent：11 files / 85 focused tests passed；主 agent 复验：2 files / 12 tests passed。F02 另有真实本地 AntD/Playwright PATCH500 UI failure-retention PASS（隔离 fixture，无 AI provider 调用）；旧会话 race 仍为组件测试证据。
- Web83 files / 615 unit + architecture3、API99 suites / 1281 tests、worker2 已报告全仓 `pnpm test` 通过；`pnpm typecheck`、`pnpm contracts:check` exit0。另有 Web/API typecheck、API auth/config/trustedproxy 36 tests passed。不同运行可能重叠，不累加成总测试数。
- 上述 API 36 tests 不等于验证码数据库回归；不得与原自写 SQL 36 pass 混用。
- 本地 D03/F01 浏览器环境：Web3100、API3101、PostgreSQL55435/`crm_browser_review`，真实 Caddy `https://localhost:3443`。没有部署到生产服务器。
- 本次 Docker 结果是网络获取中断，不是通过，也不能在未到编译阶段时声称 baseline/fixed 镜像分别验证了代码失败/成功。
- 远端六门（Typecheck、Contracts、Unit Tests、Database Integration、Build、Critical API E2E）必须绑定新提交 SHA 再核实；旧 run 不继承。

## 外部依赖与操作边界

真实短信送达、AI provider、生产 server/DNS/TLS、外部数据库与 Redis、生产备份/恢复 **NOT VERIFIED**。附件为单机 API 介导私有磁盘卷，不是云对象存储；数据库与附件需要共同备份。占位 worker 无业务队列，已从拓扑省略。有限内部试用准备不代表生产验收或部署授权。

## 主 agent 待补最终证据

1. 修复 transaction pool 连接饥饿并补12及以上并发的真实 AuthService + Prisma 回归，再核实既有 F03、REGISTER/RESET、错误计数/五次锁定/正确码业务原子性。记录命令、退出码、测试数、隔离库与角色边界，不写明文验证码或凭据。
2. 网络条件允许后记录完整 fixed Docker image build、无外网 runtime pnpm/migration 容器实际执行；未完成继续 PENDING。
3. 按实际取得范围补 F02 浏览器与真实 API SMS limiter；缺证据继续 PENDING，不扩大本地 Caddy/Echo 观察。
4. 按已授权的 PR 更新提交/推送后，绑定最新 SHA 核实六项 required checks，补 run 链接与结论；仍不得合并、部署或清理。

主 agent 最终本地复验：`pnpm build` exit0；`pnpm typecheck`、`pnpm contracts:check` exit0；`pnpm --filter @crm/database test:integration` 在 `crm_auth_final_test` 实际运行36项全部通过；`pnpm --filter @crm/api test:e2e:critical` 实际运行2 suites/11项全部通过。Build CI 已加入无缓存镜像、无网络 pnpm 和内部网络迁移两次门禁，实际结果需绑定新 SHA。

相关当前操作指引：`docs/deployment/internal-trial-runbook.md`、`HANDOFF.md`、`docs/audits/2026-10-05/crm-product-experience-v2-final-acceptance.md`。历史矩阵保留原范围，不重写成全量 PASS。
