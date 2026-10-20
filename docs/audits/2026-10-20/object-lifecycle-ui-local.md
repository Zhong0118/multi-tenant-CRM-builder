# 整张业务表停用与恢复 — UI 本地验收

日期：2026-10-20。分支：`codex/generic-pool-lifecycle`。

服务器/GitHub 仍为 `9136cdc`（字段生命周期）；整表后端提交 `ae318f9`、`eccfafe` 仅在本地，本次 UI 也仅本地提交。未推送、部署、调用外部 AI/SMS 或修改现有公司业务表状态、记录、配置。

## 入口及行为

- 桌面：公司设置 → 业务表 → 选择已发布业务表 → 基本设置 → 停用与恢复。
- 手机：业务表列表右侧固定“停用与恢复”列；横向滚动保留操作按钮。
- 管理列表支持全部、使用中、已停用、未发布；排序请求只提交非停用表，保留停用表的配置。
- 确认前加载只读影响检查，展示表名、记录数量、发布版本、草稿与依赖。依赖阻止、失败预览或版本不一致均不提交。失败可重试，版本冲突需主动重新载入后重新检查。
- 成功后接收后端返回的最新草稿，更新配置列表并刷新服务器导航。恢复使用原发布版本，保留草稿，前端不调用 publish。
- 停用后的字段详情及发布信息仍可查看；基本信息、字段排序/选项、列表勾选/排序、权限及流程均只读。已打开的公共池设置在收到 OBJECT_ARCHIVED 后禁用所有配置/保存，保留错误说明。
- 授权的列表、新建、详情和 `mode=edit` 直达链接，在服务端渲染明确停用说明；403/404 保持不公开信息。工作台逐组件展示“引用的业务表已停用”，其余组件继续显示。

## 父任务完成的迁移与数据保护

父任务提供的本机 PostgreSQL `localhost:5432/crm` 证据：迁移前备份 `/tmp/crm-table-lifecycle/local-immediate-pre-migration.dump`；仅向前应用 `0034` / `0035`。前后快照 `/tmp/crm-table-lifecycle/local-data-before.txt` 与 `local-data-after.txt` 的 public 业务行一致（排除新增停用元数据）。UI 子任务未运行迁移、重启服务或创建额外浏览器会话。

## 父任务实际浏览器结果

- 现有公司管理员登录 `nebula-demo`，桌面打开客户表基本设置和停用预览，数量17、发布v1、待发布草稿正确；只取消，没有确认停用。
- 390×844 手机管理列表可打开确认框；框左边距8、宽374，文档 scrollWidth390，无横向页面溢出。
- Escape 关闭确认并恢复焦点到“停用业务表 客户”。父任务查看过截图 `.playwright-mcp/table-archive-desktop.png`、`.playwright-mcp/table-archive-mobile.png`；桌面截图早于最终文案微调。
- 状态筛选：已停用显示空列表，使用中恢复9行；检查后浏览器回到1440×1000桌面。
- 取消后父任务重新读取客户生命周期，仍 ACTIVE、version3、publication1、有草稿、17条记录。

## 自动验证

最终命令与统计在子任务报告 `.superpowers/sdd/2026-10-20-object-lifecycle/task-2-report.md` 中记录；该目录由项目忽略，提交内的本文件同时保留可审计结果。

- `pnpm --filter @crm/web test:unit src/features/objects` → **9个文件、120项通过**。日志 `/tmp/crm-lifecycle-ui-objects-final.log`。
- `pnpm --filter @crm/web test:unit src/features/dashboard/dashboard-types.test.ts src/features/dashboard/dashboard-source-links.test.tsx src/lib/auth/load-runtime-object.test.ts src/features/records/record-pool.test.tsx 'src/app/(workspace)/workspace/[tenantCode]/objects/[objectCode]/[recordId]/page.test.tsx'` → **5个文件、44项通过**。日志 `/tmp/crm-lifecycle-ui-runtime-final.log`。
- `pnpm --filter @crm/web typecheck` → **通过**。日志 `/tmp/crm-lifecycle-ui-typecheck-final.log`。
- 最后文案/错误优先级微调后 `pnpm --filter @crm/web test:unit src/features/objects/object-designer.test.tsx -t whole-table` → **11项通过、31项无关测试跳过**。日志 `/tmp/crm-lifecycle-ui-last-change.log`。
- 受影响 TypeScript 文件 ESLint → **0错误、0警告**。日志 `/tmp/crm-lifecycle-ui-affected-lint.log`。
- `pnpm --filter @crm/web lint` → **exit0，0错误、1个既有警告**，未修改的 `dashboard-builder.tsx:395` 使用 `window.location.assign`；通过 `git show eccfafe:<path>` 的 ESLint stdin 独立复核基线。日志 `/tmp/crm-lifecycle-ui-lint-final.log`、`/tmp/crm-lifecycle-ui-lint-baseline.log`。
- `pnpm --filter @crm/web test:architecture` → **3项通过**。日志 `/tmp/crm-lifecycle-ui-architecture.log`。
- 首轮先写测试再运行，预期 **12项失败、119项通过**，失败对应缺少入口、只读、防404吞错与工作台解析。公共池另行 **1项失败、20项通过**，随后修复。日志 `/tmp/crm-lifecycle-ui-red.log`、`/tmp/crm-lifecycle-ui-pool-red.log`。
- 测试中原有 JSDOM `getComputedStyle` 伪元素提示仍出现，不影响测试结果；新增 Ant Spin 弃用提示已消除。

## 边界

已有演示公司没有停用夹具，因此浏览器未实际确认停用/恢复，也未伪造浏览器恢复截图。前端成功停用、恢复、历史期限勾选、依赖阻止、并发版本、只读和混合排序由真实组件单元测试覆盖；数据库级副作用由 Task1 的隔离 PostgreSQL E2E 覆盖。这里的“通过”仅指相应命令或明确列出的浏览器动作。
