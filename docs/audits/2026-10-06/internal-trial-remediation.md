# 内部试用修复证据账本

日期：2026-10-06，2026-10-07 补 P2-R。状态：**PR #26 OPEN / NOT MERGED / NOT DEPLOYED**。已核实 CI：代码 `58da1ce` / run `37444823699`、remediation `3432aa4` / run `37445633285`、文档 follow-up `df90be3` / run `37446164020` 六门全部 SUCCESS。2026-10-07 P2-R（旧保存后服务器刷新丢失新草稿）修复提交在 `df90be3` 之后，其 CI 以 PR #26 当前 HEAD 的检查为准；任何 SHA 都不是永久 latest。

## 范围与基线

- 工作树：`.worktrees/crm-product-experience-v2-slice-4`；本地分支 `codex/internal-trial-preparation`，基线 `c400b32`。PR #26 远端分支为 `codex/crm-product-experience-v2-slice-4`，根 `main` 落后，禁止用作本轮入口。P2-R 修复见下文“P2-R”一节。
- 代码 SHA `58da1ce` 已推送至 PR #26；GitHub run `37444823699` 六项 required checks 全部 SUCCESS，`gh checks --watch` exit0。该 Build 2m50 包含无缓存 full Docker、offline pnpm 与 internal-network migration 两次门禁 PASS。其后 `3432aa4`（run `37445633285`）与 `df90be3`（run `37446164020`）六门同样 SUCCESS，`58da1ce` 不是永久 head。旧 run `37417884483` 仅作历史证据。
- 用户授权 D01-D04、F01-F03、验证码修复验证及 PR 更新/push；仍禁止合并、部署、清理。本文记录当前工作树证据，不代表已合并或已部署。
- 保留用户的 `internal-trial-independent-review.md` 与 `docs/superpowers/briefs/2026-10-06-frontend-polish-handoff.md`，不修改或清理。本文按主 agent 提供的观察记录，不代表文档 agent 独立重跑浏览器/测试。

## 逐项状态

| 项目 | 当前改动与已取得证据 | 未完成边界 |
|---|---|---|
| D01 根 tsconfig 缺失 | Docker COPY 已加入根 `tsconfig.base.json`；独立 COPY 布局曾复现 TS5083；run `37444823699` 的无缓存 full Docker Build PASS | 代码/自动门禁已验证；生产部署仍未执行 |
| D02 migration 运行时下载 pnpm | tooling 在构建期准备 pnpm 11.19.0，build/runtime 共用，runtime `COREPACK_ENABLE_NETWORK=0`；空 cache + `--network none` RED 已复现，fixed tooling 离线 pnpm 11.19.0 exit0 | run `37444823699` Build 2m50 的无缓存 full Docker、offline pnpm、internal-network migration 两次门禁均 PASS；本地网络失败只保留为历史，不再作为当前 PENDING |
| D03 双域 Cookie/SSR | Compose 统一公开 `WEB_ORIGIN`；Caddy `/api/v1/*` 反代 API，其余到 Web。真实浏览器登录→`/workspace/nebula-demo`→刷新完整 dashboard；Secure/HttpOnly/host-only localhost session cookie；退出清 cookie 后访问 workspace 回 login | 仅真实本地 Caddy `https://localhost:3443`，内部自签证书绕过浏览器信任。公网 DNS/TLS、完整生产 Compose 启动 NOT VERIFIED |
| D04 代理短信 IP 共额/伪造头 | 固定 edge `172.30.26.0/24`，Caddy `.2`、API `.3`、Web `.4`，API 只信精确 Caddy IP；Caddy 覆盖 XFF。真实 `.10`/`.11` 两客户端同伪造 XFF 得真实各自 IP，Echo upstream remote `.2`；bounded-proxy 8 tests pass，含 untrusted spoof/default deny/safe exactIP；实际 Nest auth-proxy 主复验3 suites/11 tests pass，63次HTTP验证：同客户端20→429、第二客户端独立20→429、untrusted spoof20→429，拒绝时无 challenge/send；repository/sender 边界 fake，实际 controller/service/limiter | Echo 证明代理转发边界，不等于真实短信 provider 验收；公网拓扑和真实 SMS limiter PENDING |
| F01 旧保存关闭新编辑会话 | 真实浏览器 delayed PATCH200，取消并重新编辑后新 remark retained，saveEnabled=true；聚焦回归通过 | 仅该已观察路径，非所有角色/视口/异步矩阵。该证据未覆盖旧保存后服务器刷新带回新版本的路径，后者即 P2-R，见下文 |
| F02 AI 重命名失败关闭/旧请求干扰新弹窗 | 真实本地 Playwright + AntD：隔离 DB fixture 会话，无 AI provider 调用；route 注入 PATCH500，dialog visible=true，输入 `draft retained browser`，role alert 显示“重命名失败，请重试”，标题输入仍保留。实际 UI500 failure-retention PASS | 旧会话 race 仍仅组件测试证据；不把该一次真实失败路径扩大为完整 AI 浏览器矩阵 |
| F03 停用/关闭租户邀请注册 | 单一 `0023` 迁移补最小列权限及 tenant SELECT policy，函数仅允许 DRAFT/ACTIVE；干净隔离库23迁移成功。实际 crm_app 函数调用、DRAFT bootstrap、停用/关闭拒绝、角色/ACL/RLS 数据库回归通过 | 生产数据库未迁移；真实外部短信仍未验证 |
| 验证码错误次数事务回滚 | RED：真实 AuthService + Prisma 首错 expected1/actual0、8并发 expected5/actual0。修复后主 agent 首轮（连接池修复前，历史）独立执行 Critical API E2E：2 suites / 11 tests / exit0；REGISTER 每次持久化、第5次LOCKED，8并发只计5且均400；RESET并发锁定；成功消费后业务异常回滚，随后成功消费与密码写入通过 | 使用真实 PostgreSQL、crm_app runtime；短信发送与密码哈希边界是测试替身，不代表真实短信送达。原自写 SQL 并发测试已移除，不作为产品路径证据 |

## 验证码连接池收口

AuthService + Prisma 已改为 consume mismatch 只抛 private `ChallengeCodeMismatch`；REGISTER/RESET 在 await transaction catch 后 increment，preflight 外部完成，避免 nested second connection。Critical API E2E 2 suites/12 tests、DB integration 36 tests、full build/typecheck/contracts 均 PASS；12 concurrency 已绿色。连接池 Important 已 root eliminated。数据库 `queryconnection_limit` 并非有效配置，默认 pg pool10，不得宣称该参数提供额外保护。

`58da1ce`、`3432aa4`、`df90be3` 的六门 CI 均已核实成功（run 见顶部）；外部短信、AI provider、生产 DNS/TLS、数据库/Redis/备份仍 NOT VERIFIED。

## 历史 Important：验证码连接池并发（已由上一节取代）

旧版 12 并发负载曾通过但未稳定复现 RED，作为过程证据保留；后续统一事务释放后再计数的修复已通过12并发回归，连接池 Important 已消除。此前 PENDING 结论已被本节最新证据取代。

## 聚焦验证（`58da1ce` 时点，历史）

- F01/F02 agent：11 files / 85 focused tests passed；主 agent 复验：2 files / 12 tests passed。F02 另有真实本地 AntD/Playwright PATCH500 UI failure-retention PASS（隔离 fixture，无 AI provider 调用）；旧会话 race 仍为组件测试证据。
- Web83 files / 615 unit + architecture3、API99 suites / 1281 tests、worker2 已报告全仓 `pnpm test` 通过；`pnpm typecheck`、`pnpm contracts:check` exit0。另有 Web/API typecheck、API auth/config/trustedproxy 36 tests passed。不同运行可能重叠，不累加成总测试数。
- 上述 API 36 tests 不等于验证码数据库回归；不得与原自写 SQL 36 pass 混用。
- 本地 D03/F01 浏览器环境：Web3100、API3101、PostgreSQL55435/`crm_browser_review`，真实 Caddy `https://localhost:3443`。没有部署到生产服务器。
- 本次旧 Docker 网络获取中断保留为历史；最新 run `37444823699` 已提供无缓存 full Docker、offline pnpm、internal migration 两次 PASS。
- 代码 SHA `58da1ce` 的六门 required checks（Typecheck、Contracts、Unit Tests、Database Integration、Build、Critical API E2E）全部 SUCCESS；其后 `3432aa4`、`df90be3` 的 CI 也已核实，见顶部。

## P2-R：旧保存后的服务器刷新丢失新草稿（2026-10-07，`df90be3` 之后）

- 来源：用户本地审查 `docs/audits/2026-10-07/two-agent-review.md`。F01 只修了旧保存的 `finally` 关闭新会话；旧保存成功后 `router.refresh()` 带回新的 `openRecord.version`，而 `RecordWorkspace` 的 key 含 version，会重建会话并丢失新草稿。
- 修复：key 只含租户、对象、记录 id、编辑入口与跟进定位，不再含 version；同一记录的服务器刷新在会话内原地更新；关闭或删除后、路由切换前才到达的刷新不会重新打开抽屉。抽屉在点“编辑”时固定表单所基于的记录，刷新不会把未保存草稿悄悄换到新版本：保存仍提交原 version，由服务器返回 409 并提示“重新载入记录”。表单按当前 schema 的 `canUpdate`/`canCreate` 禁用保存，刷新后的字段可见性与可编辑性立即生效，只提交仍为 EDIT 的字段。
- 组件测试使用真实 `RecordWorkspace` + `RecordDetailDrawer` + `RecordForm`（仅外围面板替身）：延迟 PATCH → 取消 → 重新编辑并输入新草稿 → PATCH 200 → `router.refresh` → 以 v2 重渲染后草稿保留；撤销权限后保存禁用且不发请求；恢复后保存提交 version 1 并显示冲突；刷新后的字段权限只提交可编辑字段；记录 id、租户、对象、编辑入口、跟进定位变化仍重置草稿；关闭/删除后迟到的刷新不重开抽屉。分别还原 Workspace 改动、抽屉记录固定、迟到刷新保护时，对应用例各有 2 项失败。
- 浏览器：隔离 PostgreSQL/Redis 容器，本工作树 Web 3200 / API 3201，`nebula-demo` 演示租户，真实 API 与真实 Next RSC 刷新。[`harness/p2r-refresh.mjs`](harness/p2r-refresh.mjs) 拦住首个 PATCH，取消、重新编辑、输入新草稿后放行：服务器提交 v+1，RSC 刷新 200，URL 不变，编辑会话保持，新草稿保留；保存新草稿得到服务器真实 409，草稿仍在；取消后阅读视图显示已提交内容和新版本；最后恢复演示值。admin 1440/900/390、employee 1440/390 共 5 组，每组 13 项断言全部通过。同一脚本在未修复代码上：提交与刷新成功后编辑会话消失，2 项失败、exit 1。
- 边界：仅本地隔离环境，未部署；真实 AI Provider、真实短信、生产 DNS/TLS 不在此证据内。修复提交 SHA 与 CI 以 PR #26 当前 HEAD 为准。

## 外部依赖与操作边界

真实短信送达、AI provider、生产 server/DNS/TLS、外部数据库与 Redis、生产备份/恢复 **NOT VERIFIED**。附件为单机 API 介导私有磁盘卷，不是云对象存储；数据库与附件需要共同备份。占位 worker 无业务队列，已从拓扑省略。有限内部试用准备不代表生产验收或部署授权。

## 剩余边界

1. 文档 follow-up `df90be3` 的六项 required checks 已核实（run `37446164020`）；P2-R 修复及之后的提交需各自 HEAD 的 CI。
2. 保持 F02 浏览器证据与真实 API SMS limiter 边界；外部短信送达仍 NOT VERIFIED。
3. 保留生产 server/DNS/TLS、AI provider、外部 DB/Redis、备份恢复未验证边界；仍不得合并、部署或清理。

主 agent 连接池修复前本地复验（历史；之后 Critical API E2E 为 2 suites/12 tests，见“验证码连接池收口”）：`pnpm build` exit0；`pnpm typecheck`、`pnpm contracts:check` exit0；`pnpm --filter @crm/database test:integration` 在 `crm_auth_final_test` 实际运行36项全部通过；`pnpm --filter @crm/api test:e2e:critical` 实际运行2 suites/11项全部通过。Build CI 已加入无缓存镜像、无网络 pnpm 和内部网络迁移两次门禁，实际结果需绑定新 SHA。

相关当前操作指引：`docs/deployment/internal-trial-runbook.md`、`HANDOFF.md`、`docs/audits/2026-10-05/crm-product-experience-v2-final-acceptance.md`。历史矩阵保留原范围，不重写成全量 PASS。
