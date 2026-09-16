# CRM Lean Stage Briefs

> 日期：2026-09-16  
> 作用：Lean Roadmap 的阶段级设计索引

## 文档层级

```text
Full Capability Roadmap
→ Lean Execution Roadmap
→ Stage Brief
→ Promote 某阶段
→ Task Design Spec
→ 用户批准
→ Implementation Plan
→ Development
→ Acceptance / Audit
```

Stage Brief 是“阶段级完整文档”：完整回答为什么做、范围、不做什么、依赖、安全边界、可能影响系统、验收大纲、粗略工作量、Promote 条件。

它不是 implementation-ready：不会提前锁死 API、DTO、数据表、migration、逐文件改动、测试代码、commit 划分和执行命令。

Production Essentials 是 Umbrella Stage，未来应拆为 Production Configuration & HTTP Security、Logging & Redaction、Monitoring & Alerting、Database Backup & Restore、Private Object Storage，各自单独 Design/Plan/Acceptance。
