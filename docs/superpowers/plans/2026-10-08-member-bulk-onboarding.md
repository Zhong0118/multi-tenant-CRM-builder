# 员工批量邀请与公司名册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 管理员批量创建邀请、维护公司内姓名并批量调整角色/启停，员工自行短信注册、设置密码、接受邀请。

**Architecture:** 保留独立个人账号；TenantInvitation 与 TenantMember 增加可空 displayName，接受邀请时拷贝公司姓名，历史数据回退到个人姓名。批量操作在前端顺序调用现有受保护单条接口，逐条显示成功/失败并仅重试失败项；不新增队列、批量事务或管理员代设密码。

**Tech Stack:** NestJS、Prisma/PostgreSQL RLS、Next.js/React、Ant Design、React Query。

**Spec:** 本轮用户已确认的方案：管理员批量邀请，员工自己设密码；名册导入姓名/手机号/角色，管理员维护本公司姓名、角色和启停，保留离职交接。

## Global Constraints

- 不改变全局 User 的手机号、密码、姓名，不开放匿名任意注册。
- 姓名 1–100 字；每批最多 100 行；CSV 文件不超过 1 MiB，支持粘贴含表头的制表符表格。
- 表头为姓名、手机号、角色；手机号规范化后检查本批重复；角色仅普通员工/公司管理员，空角色默认为员工。
- 邀请创建不额外发送短信；提供注册链接给员工，由员工自行请求已有注册验证码。
- 复用每条写入的租户隔离、当前管理员校验、最后管理员保护、有工作待交接不能直接停用、审计。
- 批量选择只针对当前页，排除自己；页面切换清除选择；批量执行中不允许改名单、动作或关闭结果窗口。
- 单条失败不撤销已成功项；结果可逐条辨识，只重试失败项；已有邀请/成员不重复创建。

## Task 1: 公司内姓名与邀请边界

**Files:** schema.prisma 与 0024_member_display_names/migration.sql；memberships service/repository/controller/dto；invitations service/repository；对应现有测试。
**Interfaces:** CreateInvitationDto.displayName?: string；PATCH /workspaces/:tenantCode/members/:memberId/name body {displayName:string}；TenantMemberResponseDto.displayName 保持字符串展示，优先公司姓名；邀请列表增加可选 displayName。

- [x] 先写邀请姓名传递与接受后保留姓名测试，运行看到失败；写管理员修改公司姓名、员工/跨租户/已降权操作者拒绝的行为测试。
```ts
expect(store.membership?.displayName).toBe('公司内姓名');
expect(store.audits.at(-1)?.action).toBe('membership.name_changed');
```
- [x] 加可空字段、向后兼容迁移和公司姓名更新接口；单条邀请携带姓名，拒绝现有成员重复邀请。
- [x] 相关负责人选择、跟进、工作台按公司姓名显示，个人账号资料不变。
- [x] 运行 memberships/invitations 相关测试、生成 Prisma 与 OpenAPI、类型检查。

## Task 2: 批量名单与邀请界面

**Files:** members/member-import.ts、member-import.test.ts、bulk-invite-members.tsx/test；invite-member-form.tsx；共享 CSV 解析器从 record-csv 原样提取到 lib/csv.ts 并增加 delimiter 参数，旧 export 保留。
**Interfaces:** parseMemberImport(text): {rows:Array<{line:number,displayName:string,phone:string,role:'EMPLOYEE'|'TENANT_ADMIN',error?:string}>}；顺序请求 memberApi.invite(tenantCode,{phone,role,displayName})。

- [x] 先写 CSV 引号/BOM、TSV、重复手机号/空姓名/坏角色/超限、失败项重试测试。
```ts
expect(parseMemberImport('姓名\t手机号\t角色\n张三\t13800138000\t员工').rows[0].phone).toBe('+8613800138000');
```
- [x] 导入/粘贴→校验预览→提交→逐行结果；成功项不重发，失败可重试或返回修改；展示可复制注册链接。
- [x] 单个邀请补姓名字段，列表显示邀请姓名；运行相关 Web 测试及已有 CSV 测试。

## Task 3: 名册批量操作与姓名修改

**Files:** members/member-table.tsx、member-name-editor.tsx、bulk-member-actions.tsx、对应测试和 members.module.css。
**Interfaces:** 已有 PATCH member status / role；新增 PATCH member name；成功后失效成员查询缓存。

- [x] 先写选择、页码清空、部分失败仅重试失败行、退出批量后刷新结果的交互测试。
- [x] 选择当前页成员，确认后批量设置员工/公司管理员、启用/停用；复用现有服务端逐条权限与交接检查。单条姓名弹窗仅更新公司字段。
- [x] 在 1440/900/390 验证表格滚动、抽屉、确认、结果和失败恢复，禁止新增无关功能。

## Task 4: 验证与发布

**Files:** API member-onboarding e2e，数据库既有 RLS integration fixtures；验收文档。

- [x] 在独立测试数据库执行 24 项迁移，以 crm_app（无超级用户/BYPASSRLS）跑邀请→注册→接受→名字隔离→权限变化→停用/交接约束，不触及生产测试数据。
- [x] 关键复核：批量不会越权、重复邀请不会改已有成员、个人姓名不被公司修改、只重试失败、最后管理员保护。
- [ ] 运行受影响 lint、typecheck、contracts、CI required checks；一次整分支独立 review。
- [ ] 构建公网镜像、校验哈希，备份生产配置/数据库/附件，先执行兼容迁移，再更新应用；验证公网登录、就绪及本轮界面，记录实际验收边界。
