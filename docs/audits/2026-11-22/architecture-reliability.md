# 架构可靠性复核 · 2026-11-22

**优先采纳工作台配置共用校验和字段归一化的编译期检查。优先交付的业务修复是成员撤权后的动作执行、公海生命周期，以及自动化的事务、版本和审计。** 组件长度有助定位改动热点，6.5/10 缺少量表、权重和历史对照，不能推导上线风险或改造工期。

主线取已 fetch 的 `848280b4906658946b2ce7e1126dc097fb84def7`。原审查来自本机 `7847fdb4037ef93d3270f5e2a613111b3bf2cf4f`，本分支 `98ef810` 保留同一文件内容和原作者信息。原文、各节编号及原始估算均可追溯。[Claude 原审查](architecture-review.md)

### 按业务影响排序的修复

| 顺序 | 修复前的行为与证据 | 本地提交与回归 |
| --- | --- | --- |
| 1 · 字段与记录访问 | 已发布动作读取源字段时，只有独立组员列规则经过裁剪。普通员工的实时隐藏规则没有覆盖同一路径。普通成员字段映射也可能把未配置的同名原型属性当作授权。公海列表会隐藏本人标题不可读的记录，领取命令却只检查了组员读取范围。 | `4b1c611`、`80908d6`。统一按当前记录的有效字段构造动作输入，对权限映射只读自有键，领取复用本人标题规则。`action-engine`、`action-value-resolver`、`group-field-access`、`record-ownership` 单测覆盖拒绝、错误脱敏和零副作用。 |
| 2 · 发布与撤权 | 对象快照读取、成员列授权查询和数据库公海保护函数叠加读取了草稿字段状态。对象发布与组员权限 E2E 对同一行为给出相反要求。 | 按产品确认，字段在**发布后**退出运行时，成员撤权从下一次请求起生效。`128e008`、`31866b9` 统一三个入口，保留历史记录值。`object-publication`、`member-group-access` 共 47 个 HTTP 用例通过。数据库测试逐步改变草稿、实时授权和发布标题，验证每一步的保护判断。 |
| 3 · 批量写入与失败审计 | 关系触发器拒绝单行时，原始驱动异常越过批量保存点的业务错误处理，可能连带回滚同批成功行，并丢失失败审计关联。 | `a3dc333` 在标记失败审计前按驱动 SQLSTATE 和完整业务消息翻译，保留事务出口的翻译。`cross-table-automation` E2E 检查失败源版本、同批成功记录、执行数及一条归属正确的失败审计。独立执行回滚后的失败审计仍依赖第二个事务成功。 |
| 4 · 自动化版本与重复执行 | 手动动作建关系后，数据库保护触发器已推进源版本，命令再使用旧版本会自行触发 409。字段触发的编辑能成功，却返回旧版本，用户下一次合法编辑会冲突。 | `d50a677` 在同一事务中先取得手动命令版本，字段自动化实际执行后回读最终行。两种触发的真实 PostgreSQL E2E 均检查仅建一个目标、一次执行和最终保护版本，既有并发重试测试同时通过。 |
| 5 · 员工导入 | 开启新公海生命周期后，员工单笔创建有待联系阶段与期限，同一员工导入却落为空阶段，后续到期处理找不到这条记录。 | `d7a1d41` 复用 `initialPoolPlacement`。`record-pool-lifecycle` 并发提交同一批次，验证一次创建、一次跳过、同一负责人、期限和一条创建审计。存量记录需要单独决定哪些应纳管。 |
| 6 · 草稿、字段和搜索 | 标量操作符接受数组后，API 可保存，Web 无法重开。原发布分析已能阻断无效条件。隐藏必填字段的默认值诊断与写入引擎也有偏差。文本包含查询会把用户输入的通配符扩展成额外命中。 | `eb8047c` 共用解码器，新草稿严格校验，旧草稿保留原值供修改。`ccb0aa4` 复用字段枚举与静态默认值引擎。`bdc813b` 让 Prisma 查询、原始 SQL 及工作台使用同一字面匹配规则（百分号、下划线、反斜杠）。API/Web 解码测试、发布测试、真实数据库两条列表路径及工作台绑定参数测试覆盖这些行为。 |

### 原审查逐项判定

| 原节与建议 | 判定、反例与处置 |
| --- | --- |
| §1.1、§1.2、§2.6 · 分层与占位 | Web 业务调用遵守 REST 边界。三个空 Nest 模块（users、imports、integrations）另加三组 DTO 占位（fields、views、permissions）；真实导入和字段权限在 records/objects。模板包有架构测试锁定，实际模板由 API 与数据库管理。Worker 有 Redis 启动检查，尚无业务队列。27 个应用 src 目录 README 中包括指错路的 guards，本轮已更正。对象模块对 records/actions/workflows/automations 存在双向文件引用，其中包含 type-only 导入。AppModule 能启动；缺少 `forwardRef` 单独不能证明依赖图无环。保留用于替换仓储、时间和 ID 的注入令牌。 |
| §1.3、§2.3、§3.1 · P4 / A5 / B3、B6、B8 | RecordsService 混合查询、导入、导出和活动，成立。命令原本已在 patch 后调用 `store.runFieldAutomations`，真正难分的是事务、保存点和回滚后审计。数据库适配层统一翻译触发器错误，事务入口与自动化执行器复用，真实批写 E2E 覆盖结果。API 的 ESLint 规则检查数据库基础设施对业务模块的反向引用。只有在保留同一事务及锁顺序的前提下才拆执行适配器。下一步可独立提取纯查询解析。按 SQL 片段返回 mock 的测试证明不了真实锁，修改相关查询时以 DB 行为覆盖替换。长 SQL 仓储若职责集中，行数本身无需处理。 |
| §2.1、§2.2 · 权限、AI 和并发优点 | WorkspaceGuard、事务上下文、RLS、不可变快照和 `resolveEffectiveAccess` 确实复用。导航 `listAccessible` 独立组合解析与权限；动作和公海保护还各有投影、数据库判断。7 个 AI 读工具中 `listFollowups` 走 FollowUpsService。AI 确认先锁定、重验并复用领域命令，工作流只对写冲突重试整个事务、最多三次。跨租户邀请与成员写入、审计只追加由 [RLS 集成测试](../../../packages/database/test/integration/rls.test.mjs) 覆盖；跨租户自动化由 [API E2E](../../../apps/api/test/cross-table-automation.e2e-spec.ts) 覆盖。AI 重复确认有独立 E2E。Dashboard 先解析权限再执行组件查询，若要求一次请求内也能中途撤权，需另定一致性边界。 |
| §2.4、§3.2、§5.1 · P1 / B1 | 字段知识确有重复。原归一化函数返回 `unknown`，模拟增加联合成员时可静默返回 `undefined`；修复后同一变异触发 TS1360。对象、模板、工作台三个 DTO 已引用既有 12 种发布类型，Prisma 枚举另含 ATTACHMENT。删去约 175 行镜像默认值规则，保留成员存在性写入时查库。查询、标题、SQL 和 Web 编辑器各有能力边界。按原五个类型关键词搜 API/Web 非测试源命中 47 个文件，命中数、必须改的文件数和新人实际耗时各有不同口径。 |
| §3.2、§4.2 · P2 / A6、B5 | 草稿过滤器漂移成立并已修，契约复用现有 `@crm/contracts/dashboard-filter`，通过普通 API Jest、Web 测试和生产构建。自描述 REST DTO 与 OpenAPI 漂移门禁值得保留。378 处 object 字面量包括有属性的 DTO，工作台运行时组件已有 `oneOf`。Workflow Action、自动化映射和 AI 流仍有手写契约，迁移下一类前须验证旧快照、草稿和协议兼容。CSV 导出和导入使用不同的分隔符规则，全面往返兼容尚缺端到端证据。 |
| §2.5、§3.1 · P3 / A7、B2 | RecordList 主函数 1,353 行，列、选择、工具栏和导航一起变化，已有独立筛选和导入组件。ObjectDesigner 主函数 878 行，AST 中有 **17** 个 useState 和 11 个 useMutation；37 个 useState 调用是全文件数字。MemberTable 主函数 709 行。`d3200a9` 将有独立查询的发布历史区移出设计器，保留查询键、操作回调和 JSX，原有设计器两套 78 项测试通过。列表拆列与选择状态待销售合入。57 处内联 queryKey、51 次失效调用及 record-api 的 17 个导出类型提示缓存或协议调整的检查点；multipart、流式响应与下载仍需要专门处理。 |
| §3.3、§4.5 · P5 / A1、A2 | RecordDetailDrawer 在主线无生产引用，真实路由渲染 RecordDetailPage。三份直接引用它的测试中，两份同时验证在用的详情页（`record-group-access`、`record-workflow-visibility`）。销售分支仍在改抽屉；整删三个测试会损失活跃覆盖。已删除两分支均未引用的 employee-permission-comparison 及专属样式；实际对照表在 ObjectDesigner。filter-bar 只有测试引用，V3 设计仍列为页面模式。待销售合入后再清理抽屉和专属断言。`executionSummary` 仍是公开 API。已修 HANDOFF、README、V3 设计索引和权限指引；暂保留历史设计链接、根目录资料及脚手架契约。 |
| §3.2、§5.2 · AI 扩展 / A4、B4 | 候选 schema、预览、确认、持久化、流和卡片均参与新增操作。生成物由命令更新，原文的“14 降为 6”是估算。销售分支正新增沟通草稿与日期语义，待合入后用真实新增操作评估处理器表和共享联合。执行/预览仍需保留各自权限和幂等检查。 |
| §4.1、§4.3、§4.4 · A3、A8、B7 | 错误码和前端解析集中，生产 API 中 423 处 `throw new ApiException`。配置、手机号处理、运行状况等路径也抛普通 Error。通配符是字面查询行为问题，SQL 已参数化。`8060df7` 修两个旧验收前提，`242339e` 修三套依赖空库的断言，`b702815` 为日常 CI 加生产 lint，为手动 CI 加全量 E2E。保留测试 lint 结果供逐项处理。 |
| §6、§7 · 改造顺序 | 保留有界 switch、Action 编译、事务、RLS、发布快照、各领域编辑器和现有服务注入。采纳渐进共享 schema、局部 hooks 和 DB 行为测试。全仓改用新状态库、类插件、事件总线、重写 DTO 或增设业务包缺少可抵偿的维护收益。A1/A6/B7 可独立接收；B2/B3/B4 的收益须计入销售分支合并和回归成本。 |

### 可复核的基线与验证范围

- **统计基线**为 `848280b` 的跟踪文件。用 `git ls-tree -rz --name-only 848280b` 枚举、`git cat-file --batch` 取内容，行数按换行符。三个应用 src 排除生成物及 test/spec 后有 557 个 TS/TSX，26 个超过 700 行。函数按 TypeScript AST 起止行、Hook 按函数体调用计。API src 有 116 个 Jest 文件（含根目录 architecture.spec），Web src 有 137 个 Vitest 文件。API E2E 34 个文件含一个纯连接守卫套件，DB 集成 19 个测试文件另加 1 个 helper。
- **文档数**为 superpowers 90、audits 206、design 319（其中 95 PNG）。全仓跟踪 Markdown 为 50,382 行，superpowers 为 31,533 行。`git rev-list --merges --count 0a843d3..848280b` 得 63，一阶父链 46；仅凭 merge 数无法还原“65 个 PR”。跨分支/目录统计不宜混用。
- **数据库**在空的隔离集群应用主线 47 个迁移。查询 `pg_class` 的 public 普通表及 `relrowsecurity AND relforcerowsecurity` 得 41/37，另四张为 users、sessions、verification_challenges、_prisma_migrations。`pg_policies` 当前有 **72** 项；`git grep -hi 'create policy' 848280b -- 'packages/database/prisma/migrations/*/migration.sql' | wc -l` 为历次 78 行。`pg_roles` 中 crm_app 的 rolsuper 和 rolbypassrls 均为 false。本分支 48 个迁移，复查表与策略计数相同。表计数可执行 `SELECT count(*), count(*) FILTER (WHERE relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`。
- **lint 与 CI**按锁文件安装并构建 contracts/database 后，API `eslint "{src,test}/**/*.ts" -f json` 枚举 407 个文件，637 错误、7 警告，均在测试，302 个错误来自 Prettier。Web `eslint . -f json` 枚举 440 个文件、0 错误、1 个已有导航警告。未复测缺生成物时的 8,663。单跑 `eslint src` 仍会扫单测；本分支 CI 在构建前置包后显式排除 API spec，并运行 Web lint。主线 CI 六个 job 均成功，当时只有 11/34 个 E2E 文件纳入常规运行；同 SHA 的 Internal Trial Image 是另一个工作流。可用 `gh run view 43191575455 --repo Zhong0118/multi-tenant-CRM-builder --json jobs` 对账。[主线 CI](https://github.com/Zhong0118/multi-tenant-CRM-builder/actions/runs/43191575455)
- **在途工作**用 `git diff --name-only 848280b...8c90b99` 及 `git show` 只读核对 codex/sales-followup-main。该分支已有记录列表筛选/视图契约、列表呈现和 AI 沟通草稿，含 0049/0050。主线当时的 records 契约仍为空导出。记录列表有自己的组合条件，工作台有时间窗口、组件发布等语义。本轮只共享工作台筛选形状；已实测先部署 0051，再由 Prisma 补跑销售的 0049、0050。集成销售提交 `a0de5fe` 时应保留其 IPv4 断言，使用本分支共用 HTTP 夹具监听器，避免重复 listen。

| 本地命令 | 结果与边界 |
| --- | --- |
| `pnpm typecheck`、`pnpm contracts:check`、`pnpm build` | 全部通过。OpenAPI 再生成无差异，Next 生产构建通过。Node 24.19.0、pnpm 11.19.0，使用原生 PostgreSQL 18.4 和隔离的 Redis 8.0.1（CI 配置 7.4）。 |
| `pnpm test` | API 116 套/1,782 项，Web 137 文件/1,309 项及 3 个架构检查，其他包脚本报告 23 项，全部通过。首次全量单测发现一条工作台 SQL 参数断言仍期望旧通配符，改为字面匹配后重跑。 |
| `pnpm --filter @crm/api test:e2e --runInBand` | PostgreSQL 15.19 上的开发中快照首次 358/388，30 项失败涵盖旧端口限制、可见公海写入应为 403、字段停用时机，以及缺少 `pg_input_is_valid` 的 8 项日期/指标测试。按设计及 Compose 对齐 PG18；连接守卫继续要求同一 loopback 测试库与专用角色。PG18 重跑首次 382/392，三套含全库固定计数的断言受其他租户夹具影响。改为双租户夹具或真实期初计数后，同一库 **34 套、392/392**。 |
| `pnpm --filter @crm/api test:e2e:critical`、`pnpm --filter @crm/database test:integration` | PG18 常规 CI 子集 **11 套、121/121**。独立测试库上数据库集成 **90/90**，零跳过；PG15.19 单独执行同套数据库集成也通过 90 项。生产 API lint 0 错误，Web 仍有 1 个警告。 |
| CI 工作流语法及外部验证 | 本地解析六个 job，并对全部 run 命令运行 `bash -n`。执行手动分支又得 391/392（对象发布收到 401，应用无相应请求日志）。固定该套件监听端口后，另三套出现连接重置和超时，386/392。两个聚焦断言分别证实独立夹具与共享夹具都未持有监听器，无法鉴定旧 401 的响应进程。`0b27f3e`、`e222b03` 将已有 IPv4 loopback 监听方式用于全部 HTTP 夹具。四套聚焦复验 26/26，手动分支命令重跑 392/392 并正常退出。本分支只在本地提交，未产生托管 CI run；本机 Docker daemon 不可用，未跑镜像构建及离线容器 smoke。 |

**待决定**：存量员工导入若要追补期限，需区分本应纳管和刻意保留的历史记录。工作台撤权在单次在途请求内的时序、数据库不可用时是否要求失败审计持久投递，也需各自明确保证等级。销售分支集成后，再决定删除抽屉和拆分列表/查询边界的范围。
