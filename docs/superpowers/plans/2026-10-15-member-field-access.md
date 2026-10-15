# 员工列权限与分页 Implementation Plan

> 执行：使用 subagent-driven-development，在共享分支分配不重叠文件；根任务负责分页、整合与最终验证。本轮无推送或部署。

**Goal:** 六档分页与可批量设置的员工表/列例外权限。
**Architecture:** 复用成员表权限，新增成员列权限表并进入统一权限解析；UI使用固定API契约。
**Tech Stack:** Prisma/PostgreSQL、NestJS、Next.js、Ant Design。
**Spec:** docs/superpowers/specs/2026-10-15-member-field-access.md

## Tasks
- [x] 分页：DTO、service.list、record-query-state、record-list六档；明确批量100上限；先测试红再实现。
- [x] 后端权限：schema/migration、effective-access、published-object repository/service、memberships DTO/service/repository/controller；先权限测试，再实现与隔离数据库验证。测试清理新表。
- [x] 前端权限：成员列表批量入口、新批量权限抽屉、单成员当前列权限展示；保存后刷新，失败保留选择，批量只改明确项。
- [x] 整合：生成契约、本地迁移（先备份）、全量类型/相关测试、HTTP权限与AI/导出回归、浏览器检查。
- [x] 独立代码审查，修复确定问题，记录验收与通俗使用说明。

## Rulings
- 只在本地实现；线上权限/记录保持原状。
- 表权限继承与字段继承分开恢复，避免仅改列时覆盖已有成员表策略。
- 分页扩大不自动扩大批量写入事务；选中超过100明确禁用对应入口并提示。
