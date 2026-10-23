# Landing、后端审计和 Workspace UI 第一阶段整合验收

日期：2026-10-23。独立工作树：crm-backend-audit；发布分支：codex/release-workspace-ui-1。

## 范围与保留

整合 PR #47 后端一致性修复、PR #48 landing 及后续 storytelling/tag/login 备案链接修改、PR #49 第一阶段 UI。保留原始提交历史，不修改 UI agent 工作树。主工作区原有 launch.json 和用户说明书文件未动。

本轮不包含后续 UI 阶段，不追溯修改生产公司配置。packages/database 相对当前生产 42e59746d9780673ba28cc07a9a2e67cbaada4b6 无差异，仍为 38 个迁移；本轮发布不执行数据库迁移。

## 整合补修

- 保留确认联系/负责人流转后的刷新等待：编辑按钮在当前记录归属 mutation 完成前禁用，避免旧 version 保存冲突。
- 列显示恢复默认后显式保存默认值，防止旧版本 owner hidden 偏好在刷新后复活。
- 带 followUpId 的通知链接优先切到跟进标签，包括页面内 query 变化。
- 列表、批量选择、详情直接编辑入口共用 ALL/OWN/NONE 与公海预览权限判断；OWN 不再对他人的或未分配的记录展示编辑入口。
- Express body parser 的 entity.too.large 413 统一映射为既有 VALIDATION_FAILED，避免被当成服务 500；未扩大请求限制。
- 测试直接 require express，补上 API 显式开发依赖，保证干净安装可运行 trusted-proxy 测试；无额外版本升级。

## 验证结果

- Web：116 个文件，1009 项单元测试；另 3 项架构检查。
- 记录详情、列表、偏好补修：3 个文件，72 项测试。
- API：113 suites / 1566 tests，包含独立 Redis DB 15 限流集成验证。
- 全部 API E2E：21 suites / 198 tests。
- Database integration：82 项，串行使用 crm_v1b_test，与网页演示副本分离。
- Worker：2 项；Contracts/Database/共享架构 package 检查：18 项。
- monorepo build、typecheck、contracts:check 通过；本轮补修 TS 文件 ESLint、Prettier、git diff --check 通过。pnpm-lock.yaml 保留包管理器原格式，仅增加 3 行直接依赖条目。

自动测试不使用 crm_browser_1023 或 UI agent 的数据库。

## 网页完整流程

使用独立 crm_browser_1023 数据副本，localhost:3100/3101，真实演示角色刘洋（管理员）和赵晨（员工），没有重置账号密码。

新增客户 #20「整合发布验收1023-PR49」，ID 00fd58c3-3473-4141-99c8-efea92e73343；管理员不选负责人创建，进入线索公海。员工在公海仅预览，没有编辑入口；领取后进入我的待联系，期限 24 小时。

员工先标记普通业务进度「询单中」，仍保留领取期限；确认已联系后转为我的跟进客户，期限 720 小时。确认后立即编辑备注保存成功。新增有效跟进活动后，最近跟进与期限更新。执行「生成开单」并预览、确认，创建合同 #20 QA-20261023-004，金额 28800，ID 4f9ce318-b8a3-4a69-8ff1-19b55d31dfd3；保留来源客户，建立关联，负责人沿用赵晨。

员工没有正式确认签约入口；管理员执行确认签约后，合同普通状态同步为履行中，客户进入我的成交客户，回收截止消失，负责人保留。询单字段仍为询单中，与正式成交保护规则分离。

详情 1440 / 900 / 390 均无页面横向溢出，已检查桌面与手机实际截图。登录页可见鲁ICP备2026063095号-1。

## 范围边界

没有重放真实短信/AI Provider，本轮网页使用 fake AI；生产保留现有密钥与开关。普通无流程表的 workflow-not-published 409 仍是既有空态契约。侧栏切换离开未保存表单的全局 SPA 拦截、表格表头 sticky、千行表格虚拟化留给后续 UI 阶段；本轮不扩大改造。未宣称逐项穷尽所有页面或平台管理员浏览器验收。

## 发布门槛

整合 PR 的精确 head 必须通过全部 CI；镜像必须以 https://crm.baijiehub.com 构建并验证摘要和 revision。线上先备份数据库、附件和私密配置，仅更新 API/Web 应用容器，保留数据库/Redis/Caddy 和挂载。验收未通过则切回旧应用镜像，无迁移不恢复或重置业务数据库。
