# 完整流程模板继承实施计划

> 使用 subagent-driven-development 执行并审阅。用户已授权两个独立 PR 的开发、验收与合并；本轮不部署。

Spec: docs/superpowers/specs/2026-10-26-workflow-template-inheritance.md
Binding design review: docs/superpowers/specs/2026-10-26-workflow-template-review.md

## Global Constraints
- 保留既有模板草稿/版本/空公司限制，不覆盖已有业务记录、人员、成员例外权限。
- 捕获已发布业务配置和即时公海/全体目标；不捕获未发布草稿、不复制指定员工目标或具体成员ID；工作台保留现有模板值。
- 两张相互引用的初始化草稿必须可一次原子发布。只有同模板组从未发布、无任何记录的候选可参与；既有发布目标只读。
- 后端/数据库专用本地库与副本；无生产/其他工作树修改。无新依赖、无通用发布框架。

### Task 1 — Backend portable capture, inheritance and activation

Files: business-templates schema/DTO/presenter/policy/service/repository/application; objects controller/service/repository DTO; records pure protection rule helper; workflow.repository; migration0041 + Prisma model; focused policy/unit/e2e/integration tests; contracts.

- [x] RED：旧compile/hydrate丢流程与公海，MEMBER/ACTOR绑定不可移植，首次双向引用无法单独发布；运行记录。
- [x] 扩展可选workflow/automations/pool/goalRules，全部序列化/发布摘要/checksum贯通且旧checksum无变化。抽取小型纯配置图校验，复用现有字段/动作/自动化/公海校验；保存/发布/应用不可移植绑定均拦截。
- [x] 平台 capture-preview：同一只读一致事务，真实平台actor+来源tenant，读取ACTIVE发布快照+live公海+全体目标，稳定模板身份由草稿和发布历史恢复，报告排除项及阻断。固定接口见review。
- [x] 最小provenance migration；应用原子写入workflow states/transitions/actions、settings.automations、公海与全体目标，新ID/newversion=1。不创建虚拟成员。扩展空公司检查/锁和幂等保持一致。
- [x] 管理员template-initialization GET/POST：路由声明在参数路由前。按同来源组锁全部候选，集合/对象version/poolversion比对，统一候选+已发布依赖图校验，全部通过才创建发布/指针/审计。任何失败整批回滚，旧记录不动。
- [x] RED/GREEN/API本地完整客户领取→询单→跟进→订单→成交保护；跨租户与权限、拒绝固定成员、循环依赖、并发pool版本、旧模板与无成员新公司创建、幂等、invalid整批rollback。DTO契约生成、types/lint。仅提交后端所属文件。

### Task 2 — Frontend capture and initialize workflow
Files: features/templates template-draft/types/api/editor newcapturecomponent/tests; features/objects object-list newinitializationcomponent/api/tests.

- [x] RED：模板往返序列化保留所有扩展和dashboard；确认capture替换、阻断/dirty/version保护；初始化发布成功刷新及错误不误报。
- [x] 平台模板页“从公司复制流程”：选来源公司、读取摘要、显示对象/字段/状态/自动化/公海/目标数量及排除/错误，确认后只改本地草稿，仍沿用保存和发布。禁止替换未保存编辑，确保不丢已有内容。
- [x] 业务表管理页“发布初始化流程”：展示候选组与对象，确认携带对象/pool版本，成功后刷新业务表及侧栏；错误保留提示并可重新读取。未应用模板/无待发布对象时无空噪音入口；员工无配置权限。
- [x] 已有白蓝UI与图标/微交互，响应式/无横向溢出/reduced motion；不新增设计库。
- [x] 两角色浏览器完整流程测试，工作台模板不丢、源公司记录/配置哈希验证；全仓必要测试/build/types/contracts，独立审阅。详见验收记录。
- [ ] 推送 PR，当前提交的 CI 全绿后合并；不部署。

Additional compatibility: captured legacy underscore object codes are valid runtime references; preserve them through template storage/publication/graph checks, do not silently rename. Keep template's own code and new user-input naming policy unchanged. Include regression in backend capture and frontend draft roundtrip.
