# 项目全局梳理与 V2 开发前审计

日期：2026-10-03。审计基线：fetch 后的 `origin/main = 70884f5eff78669e369cd36e6fbd8d9f9ac9d089`。
工作位置：`.worktrees/crm-product-experience-v2-design`，分支 `docs/crm-product-experience-v2-design`，HEAD `47f4cb5`，只比该基线多两份 V2 方向文档；应用代码与该基线一致。

这是一轮全局盘点、关键代码路径检查和自动化验证，不是逐行安全审计，也不等于生产验收。本轮没有运行真实浏览器、真实 AI Provider 或生产部署。

## 1. 先看结论

产品已具备可配置 CRM 的主要业务闭环，AI V1A/V1B 也已进入主线。当前主要问题是开发入口过时、历史文档状态漂移，以及记录列表的状态保持缺陷。V2 应先修复这些小范围缺陷，再做已有页面的体验整理。

- 当前用户根目录 `main = aa505d3`，落后最新主线 **112** 个提交；不能从它开始下一阶段开发。
- 共 **18 个工作树（含根目录）**。大部分是已合并历史现场，不能把每个目录当作一项未完成任务。
- 本轮复现 **3 个 P2 产品 bug**，均在记录列表/详情导航。保留了真实组件复现脚本；没有改业务源码。
- 全仓已有单元测试、类型检查、构建、契约检查通过；数据库集成 **34/34**、Critical API E2E **7/7** 通过。
- AI 两套独立 E2E 的 **37 项**在 setup 阶段被固定数据库地址保护拒绝，未执行产品断言。本轮不能宣称 AI E2E 全绿。
- 没有在本轮检查范围内确认 P0/P1；这不证明不存在未发现缺陷。

## 2. 项目能力地图

| 层 | 已有内容 | 主要代码入口 | 当前判断 |
| --- | --- | --- | --- |
| 账号/平台 | 注册登录、会话、平台公司生命周期、邀请首位管理员、模板初始化 | `apps/api/src/modules/auth/`、`tenants/`、`invitations/`、`business-templates/`、`platform-operations/` | 已有业务与测试；生产配置另行验收 |
| 租户与权限 | TenantContext、WorkspaceGuard、RLS、对象范围 OWN/ALL、字段权限、成员覆盖 | `apps/api/src/common/tenancy/`、`memberships/`、`objects/`、`packages/database/` | 是所有人工/AI 操作的共同边界 |
| 动态业务数据 | 对象/字段/默认视图、草稿与发布快照、记录 CRUD、搜索/筛选/排序、批量、导入导出 | `objects/`、`records/`、`imports/`；`apps/web/src/features/records/` | V2 整理已有操作，不重建 CRM |
| 日常协作 | Follow-up、NOTE 活动、关联、附件、审计 | `follow-ups/`、`record-relations/`、`attachments/`、`audit/` | 任务、历史、动态“活动”对象是不同概念 |
| 流程执行 | Workflow V1 状态转换、Action Engine 顺序动作与事务 | `workflows/`、`actions/` | 已合并；不是未来 Automation |
| 工作台 | 已发布 Dashboard、权限投影、员工个人跟进时间桶 | `dashboards/`；Web `features/dashboard/`、`features/follow-ups/` | Sales Workbench Lite 已完成 |
| AI | V1A 受限只读工具、会话/SSE/预算；V1B Proposal→Preview→Confirm→Typed Command→Audit | API `modules/ai/`；Web `features/ai/` | 已合并；真实 Provider 仍未验证 |
| 工程 | contracts 生成、数据库迁移、6 项 CI job、worker 基础包 | `.github/workflows/ci.yml`、`packages/contracts/`、`apps/worker/` | worker 的存在不代表完整 Automation 已实现 |

技术栈以当前仓库为准：Node 24、pnpm 11.19.0、Next/React/Ant Design、NestJS、Prisma/PostgreSQL、共享 TypeScript contracts。

```mermaid
flowchart LR
  UI[员工与管理员页面] --> API[鉴权与租户上下文]
  AI[AI 受限工具与确认提案] --> API
  API --> Domain[对象发布与权限投影 / 记录 / 跟进 / 工作流]
  Domain --> DB[事务与 PostgreSQL RLS]
  Domain --> Audit[审计]
  Draft[管理员配置草稿] --> Publish[发布快照]
  Publish --> Domain
```

AI V1B 的三类写入是 `UPDATE_RECORD`、`CREATE_FOLLOW_UP`、`ADD_ACTIVITY_NOTE`。`ai-proposal.schema.ts` 拒绝额外 Actor 字段；`ai-proposal.service.ts` 在确认事务中锁定提案、Actor、对象/权限与记录，重新检查权限、发布版本及记录版本，复用领域命令。不能在 V2 中把它简化为“聊天即写入”。

## 3. 分支/工作树判断

完整盘点见 [Git 工作区快照](git-inventory.md)。判断依据是祖先关系、`git cherry` 补丁等价及 squash 结果，不能只看 ahead/behind。

- **接下来维护的 V2 文档**：`docs/crm-product-experience-v2-design`，最新 main + 一个方向文档提交。
- **已包含在主线的历史工作树**：AI UI V2、AI V1A foundation/read runtime/workspace UI、AI V1B design/closeout、readiness audit、demo dashboard 修复、follow-up clock、record visibility、workbench、E2E stabilization 等。
- **看似 ahead，实为等价补丁**：`fix/critical-api-e2e-expiry-closeout`、`docs/enforce-admins-record`、`docs/sales-workbench-lite-closeout`；另有无工作树分支 `fix/db-integration-fixture-cleanup`，`git cherry` 同样为 `-`。
- **远端备份**：`origin/backup/v3-design-tokens` 比主线落后 321 个提交，独有提交 `e8812d8` 经 `git cherry` 判定补丁已包含；它不是另一个等待落地的 V3 产品。
- **squash 历史**：`ci/critical-api-e2e-gate-promotion` 的三个提交没有逐个补丁匹配，但其 tip `7250f75` 与已合并的 `4eac32c` **完整树 diff 为空**，无需重复合并。
- 根目录有 10 项未提交路径（包括 `.gitignore` 和用户文档），record visibility 工作树另有 4 份未跟踪评审稿。没有清理、暂存或覆盖这些文件。

建议先用现有 V2 文档工作树阅读本轮结果。实现时从 fetch 后最新 `origin/main` 建立 `codex/` 分支，并带入本轮必要文档；不要从旧根目录复制应用源码。历史工作树可在确认未提交材料已保存、没有运行服务后逐一归档，本轮不删除。

## 4. 已复现的产品 bug

统一复现命令（在本工作树根目录运行）：

```bash
python3 docs/audits/2026-10-03/reproduce-record-navigation.py
```

脚本从现有测试复用 fixture，临时创建两份 Vitest 测试并在 finally 删除；当前基线 **3 个断言失败**，修复后预期全部通过。原始断言输出见 [复现结果](record-navigation-reproduction.txt)。它不修改真实数据，也不接入 Provider。

| ID / 等级 | 触发与实际结果 | 根因与源码位置 | 修复/验收 |
| --- | --- | --- | --- |
| B01 / P2 | 列表 query.search 从旧关键词变为新关键词（应用保存视图等同一组件更新），输入框仍显示旧词；后续 Enter 会再次应用旧词 | `apps/web/src/features/records/record-list.tsx:112` 只用 props 初始化 useState，未随后续 query 同步 | 以已提交 URL query 同步输入草稿；新 query 到达后输入与数据一致 |
| B02 / P2 | 输入搜索后在 300ms 内离开列表；卸载后仍调用 navigate，目标是旧记录列表 | 同文件 `:186` 的 debounce 只在下次输入清理，未在卸载取消 | 卸载取消计时器；立即提交/选择视图等交互也不能被旧任务覆盖。组件复现证实回调发生，浏览器跳回体验本轮未重演 |
| B03 / P2 | 对象发布默认 `recordNo asc`，用户选择 `updatedAt desc` 后打开并关闭详情；恢复成 `recordNo asc` | `apps/web/src/features/records/record-workspace.tsx:95` 使用全局默认序列化，省略当前排序；路由读取按对象默认解析 | 列表和详情关闭使用同一 published defaults，断言 URL parse 后 query 不变 |

修复范围仅 Web 状态/导航，不涉及 DB、AI 或权限。安排进 V2 Task 0，不为每个小缺陷创建一套框架。

## 5. 测试可复现性与待验证风险

**T01 / P2 工程验证缺口**：`apps/api/test/ai-proposal.e2e-spec.ts:26` 与 `ai-confirmation.e2e-spec.ts:24` 写死 `127.0.0.1:55433/crm_v1b_test`。本轮新建的隔离 PostgreSQL 位于 `55435/crm`，两套测试在 beforeAll 拒绝它；37 个失败是同一 setup 问题，不能解读为 37 个 AI bug。

`.github/workflows/ci.yml` 的 Critical API E2E 仅跑 `critical-api.e2e-spec.ts`，不覆盖上述两个完整 V1B suites。历史验收有通过记录，当前 required checks 通过也不能替代这两套测试。后续独立测试可靠性任务应保留防误连保护，将测试环境构造/校验集中到已有 helper，允许明确创建的可丢弃库并拒绝业务库；测试修复与 CI job 推广分开交付。本轮没有改地址保护、重用或清空旧 55433 夹具。

仍开放但本轮未验证成新 bug：

- Lean Roadmap 已记录的 `MEMBER` 默认值存在性、Action Engine 嵌套 `fieldErrors` 当前权限过滤；本轮看到后者仍组装 `actions.<key>.<field>`，未构造完整越权 HTTP 场景，不升级为已证实泄漏。
- 真实 AI Provider 调用、取消/断线的真实网络行为，以及历史验收未观察到的浏览器路径，仍需各自证据。
- 备份恢复、私有附件存储、生产配置、监控与告警仍属于 Production Essentials。不能由本轮 build 或 UI V2 验收替代。
- 旧审计的员工 `/audit` / `/settings` 直链反馈不一致可纳入 V2 Slice 4，先确认当前行为；不要放松后端授权来修提示文案。

## 6. 文档时效纠偏

| 文档问题 | 本轮处理 |
| --- | --- |
| `HANDOFF.md` 写死“main 与 origin/main 已同步”、某段仍写五门 | 改为启动时现场核验与六门；添加 V2 文档入口 |
| 9/22 readiness audit 写 F-02 尚未合并、AI UI V2 未合并、V1B 未开始 | 顶部标明历史快照并链接本审计；保留历史原文，不篡改当时证据 |
| 旧 F-08 把卡片与表格都在 DOM 等同于同时可见 | 当前 CSS 桌面 `.cardList { display:none }`、手机隐藏 table；没有本轮浏览器证据，不能断言仍是 bug |
| Lean Roadmap 未包含 Product Experience V2 | 添加“计划已细化、实现未开始”阶段及链接；Production Essentials 仍 PLANNED |
| V2 文档只给方向，没有开发先后/验收入口，且旧交付限制写“不写计划” | 增补原文与 [第一切片实施计划](../../superpowers/plans/2026-10-03-crm-product-experience-v2-implementation.md)；明确最新请求授权审计和改计划，不等于功能已实施 |

版本命名必须区分：**AI Assistant UI V2** 已合并；**CRM Product Experience V2** 是本轮规划；Full Roadmap 的 **V2.2 Sales Execution** 是另一项未批准长期能力。三者不是同一任务。

## 7. 本轮验证记录

Node `v24.19.0` / pnpm `11.19.0`，原样最新基线应用代码。

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm test` | exit 0；API 94 suites / 1235 tests；Web 76 files / 480 tests；其余 workspace/architecture suites 通过 |
| `pnpm typecheck` | 首次缺少 `DATABASE_ADMIN_URL` 失败；加入仅用于配置解析的无效端口占位 URL 后 exit 0，不连接业务库 |
| `pnpm build` | 同样提供配置占位 URL，exit 0 |
| `pnpm contracts:check` | exit 0，生成契约无 git diff |
| `pnpm --filter @crm/database test:integration` | 新隔离容器 `crm-audit-20261003` / 55435，20 个既有迁移，34/34 通过 |
| 三套 API E2E 串行执行 | Critical 7/7 通过；AI proposal + confirmation 共 37 项被 setup 地址守卫拒绝；组合命令 exit 1 |
| 新聚焦复现 | 3/3 预期正确行为断言失败，验证 B01–B03 确实存在；不是绿色回归 |
| 真实浏览器 / Provider / 远端 CI 状态 / lint | 本轮未执行；没有宣称全部六个远端门禁通过 |

隔离数据库测试使用 `TEST_DATABASE_ADMIN_URL=postgresql://crm:crm@127.0.0.1:55435/crm` 与 runtime `crm_app`。该容器是本轮创建的临时资源，检查完成后删除；既有 5432/5433/55433 服务未修改。测试结果摘要与复现记录保存在本目录，不提交包含完整 HTTP 请求日志的原始大文件。

## 8. 下一步开发入口

按 **Task 0 修列表状态 → Slice 1 公共框架与记录列表 → Slice 2 详情/跟进 → Slice 3 员工工作台 → Slice 4 管理配置一致性** 执行。第一切片计划给出真实文件、测试和退出条件；后续切片只冻结范围与验收，不提前制造尚未验证的 API 或模块。

先阅读 [更新后的 V2 设计](../../superpowers/specs/2026-10-03-crm-product-experience-v2-design.md)，再用实施计划逐项开发。AI 增强、Automation、Sales Execution 与 Production Essentials 都不混入这次 UI 交付。
