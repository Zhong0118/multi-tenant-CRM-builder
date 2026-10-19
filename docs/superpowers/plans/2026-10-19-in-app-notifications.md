# In-app Notifications Implementation Plan

> 执行：subagent-driven-development，沿用已授权的当前目录。任务按文件边界实现；先失败测试，再实现，再统一复核。没有 GitHub/服务器发布授权，不推送部署。

**Goal:** 通用站内到期、逾期、回收、保护复核消息，保留现有业务数据和权限。
**Architecture:** 一个通知表，数据库内扫描/事件原子写入，API 权限过滤与读状态，既有工作区 Shell 增加消息抽屉。
**Tech Stack:** PostgreSQL/Prisma/NestJS/Next.js/Ant Design/React Query。
**Spec:** docs/superpowers/specs/2026-10-19-in-app-notifications.md

## Global Constraints

旧数据不自动归入公海；只新增通知。扫描固定提前量并去重，撤销/续期后过时通知不显示。仅本人消息，链接重验权限，不泄露记录标题/字段。原有迁移不可改写，新迁移编号 0033。不改无关功能，不引入依赖。

### Task 1: 通知存储与生成

Files: packages/database/prisma/migrations/0033_member_notifications/migration.sql、schema.prisma、test/integration/member-notifications.test.mjs。
- [x] 用真实 PostgreSQL 测试：due 阈值、重复扫描、续期和转交失效、待办完结、回收回执原子性、复核二次事件、跨公司/收件人 RLS、运行角色禁止伪造通知。
- [x] 建立表、RLS、最小权限后台角色、sweep_member_notifications(integer DEFAULT 500) RETURNS integer、实时有效状态视图 current_member_notifications（security_invoker=true），触发器捕捉新回收/保护复核事件。
- [x] 当前视图返回通知表全部列，附加 object_code、object_name、record_no、record_owner_member_id；过滤删除/归档/停用、期限/收件人变化、resolved_at、复核状态。回收回执允许记录失去可读性但不可跨公司。
- [x] 测试失败先留证，再应用迁移验证、Prisma generate/build。

### Task 2: API 与定时任务

Files: apps/api/src/modules/notifications/*、app.module.ts、test/notifications.e2e-spec.ts。
- [x] 写本人/跨租户 HTTP 测试、分页/计数、已读快照边界、权限撤回、失效消息与不可访问链接。
- [x] 依照 spec API 接口实现；使用当前视图+权限范围 SQL 做精确分页/总数，不能先 LIMIT 后在 JS 过滤。
- [x] minute scheduler 调用限定扫描函数，重入保护、关闭清理、失败日志重试。
- [x] Swagger DTO 生成接口，主代理最后统一 contracts:generate。

### Task 3: 工作区消息入口

Files: apps/web/src/features/notifications/*、components/layout/app-shell.tsx、top-header.tsx、workspace-shell.tsx。
- [x] 先写用户行为测试：未读徽标、打开消息、读取失败重试、已读、全部已读、点击 target/null、租户切换分页归零、手机宽度。
- [x] 复用现有请求封装、Ant Design Drawer/Badge/图标，无新依赖。props api 可注入用于测试。
- [x] Shell 仅新增可选 headerActions 插槽，WorkspaceShell 插入通知按钮，平台 Shell 不显示公司通知。
- [x] 白底蓝色强调、类型图标与分组、有限滚动、进退场和微交互、减少动画偏好。

### Task 4: 整合复核与本地试用

- [x] 独立复核权限、去重/时序、通知事件与真实回收一致、UI 交互。
- [x] 隔离空库迁移、DB/API/Web 聚焦测试，类型检查、lint、契约、构建。
- [x] 本地业务库先备份并应用0033，比较业务表原有数据摘要；使用浏览器本地测试。
- [x] 写验收和使用说明，确认服务器未改动。
