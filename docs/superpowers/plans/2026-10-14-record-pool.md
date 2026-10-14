# Record Pool Implementation Plan

**Goal:** 按表启用通用公共池，在本地完成四类流转且不自动公开历史数据。

**Architecture:** 共享记录增加系统属性；独立运行设置立即生效；受权限与并发控制的流转事务；API 后台周期回收；业务表内切换视图。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Next.js、Ant Design、Jest、Vitest。

**Spec:** docs/superpowers/specs/2026-10-14-record-pool-design.md

## Constraints

- 本地修改测试，禁止服务器操作、推送或部署；保留 docs/user-guide/。
- 默认关闭，不回填现有数据，不放宽私有记录或字段权限。
- 后端与前端按固定接口独立实现，生成契约和整体验证由主任务收口。
- 复用依赖；测试先失败再实现；不顺手重构。

## Task 1: 存储、权限与流转

- [x] 先补默认状态、权限、CAS、到期与禁用测试，确认失败。
- [x] 修改 packages/database/prisma/schema.prisma，增加向前兼容迁移。
- [x] apps/api/src/modules/records 内实现配置/流转服务、DTO、控制器、后台回收，并接入 records.module.ts。
- [x] 修改列表、详情、投影及普通负责人更新的一致性约束，保留现有导出/导入安全性。
- [x] 后端测试和 typecheck；报告准确命令和限制。

## Task 2: 前端流程

- [x] 为 scope URL、配置、按钮权限和操作刷新编写失败测试。
- [x] apps/web/src/features/records 添加公共池 API 和 UI 组件，接入列表/卡片/详情，运行时类型对接生成契约。
- [x] 配置规则文案、冲突提示、分配成员、释放确认，复用现有交互与动画。
- [x] Web focused tests、typecheck、相关 lint。

## Task 3: 集成验收

- [x] 生成 OpenAPI/客户端并验证接口与 UI 一致。
- [x] 确认只使用本地数据库，备份/快照后应用迁移，核对旧记录未变化。
- [x] 真实本地 API 测试权限、对象隔离、并发领取、期限回收；浏览器桌面/移动完整流程。
- [x] 独立审查安全边界并修复；运行必要回归、build、契约检查。
- [x] 写本地验收与使用步骤，保存本地提交，不部署。

## Completion

本地验收详见 docs/audits/2026-10-14/record-pool-local-acceptance.md。未部署、未推送、未合并 main。
