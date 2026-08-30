# 平台端公司初始化闭环 UI 实施计划

> 依据：`docs/superpowers/specs/2026-08-30-core-flow-ui-redesign-design.md`
>
> 范围只覆盖平台超级管理员核心路径：总览、公司列表/详情、业务模板列表/设计器、将模板一次性应用到空白草稿公司。沿用现有 API、权限和幂等约束，不改后端模型。

## Task 1：公司详情成为清晰的初始化流程页

涉及：

- `apps/web/src/app/(platform)/platform/tenants/[tenantId]/page.tsx`
- `apps/web/src/features/tenants/tenants.module.css`
- `apps/web/src/features/templates/template-application.tsx`
- 对应定向测试

实现：

- 用 `ProcessRail` 显示“公司已创建 → 初始化业务表 → 管理员发布”；
- 用真实邀请、对象数量和公司状态推导进度，不制造完成状态；
- 把基础信息、管理员门槛、业务表初始化和状态操作改为 `ReadingPanel` / `DataPanel`；
- 模板应用继续一次创建全部启用对象草稿，明确说明后续由公司管理员发布。

验证：只运行模板应用和公司详情相关组件测试。

## Task 2：统一平台总览、公司列表与新增公司

涉及：

- `apps/web/src/features/tenants/platform-overview.tsx`
- `apps/web/src/features/tenants/platform-overview.module.css`
- `apps/web/src/features/tenants/tenant-table.tsx`
- `apps/web/src/features/tenants/create-tenant-form.tsx`
- `apps/web/src/features/tenants/tenants.module.css`
- 对应定向测试

实现：

- 指标保留真实数据，降低装饰性卡片感；
- 公司表格进入紧凑 `DataPanel`，状态和下一步清晰；
- 首次空状态使用明确的“新增公司”动作；
- 新增公司表单使用 960px 内的阅读面，表单说明不和操作控件混在一起。

验证：只运行平台总览、公司表格和创建表单测试。

## Task 3：统一模板列表和模板设计器

涉及：

- `apps/web/src/features/templates/template-list.tsx`
- `apps/web/src/features/templates/template-editor.tsx`
- `apps/web/src/features/templates/template-object-editor.tsx`
- `apps/web/src/features/templates/template-publication-panel.tsx`
- `apps/web/src/features/templates/templates.module.css`
- 对应定向测试

实现：

- 模板列表使用数据工具样式和统一状态标签；
- 设计器保持左侧对象清单 + 中间编辑区的工具密度；
- 保存草稿、未发布变更、当前发布版本使用统一状态语言；
- 发布检查保留真实阻断项和影响摘要；
- 小于 1024px 时不伪装可编辑，给出明确桌面端提示。

验证：只运行模板列表、编辑器、发布和应用测试。

## Task 4：阶段验证与交付

- 运行本阶段受影响测试；
- 运行一次 `@crm/web` typecheck；
- `git diff --check`；
- 不触碰 `register/page.tsx`、`chat会话.md`、`.superpowers/sdd` 和工具生成目录；
- 提交并推送 `main`。

浏览器登录态检查只有在用户即时授权提交本地测试凭据后执行，不阻塞代码层阶段交付。
