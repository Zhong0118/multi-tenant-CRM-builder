# CRM Product Readiness & System Usability Audit

> 日期：2026-09-22  
> 环境：localhost:3000 / :3001，租户 `nebula-demo`，本地 Postgres `:5432`  
> 范围：判断是否达到「可稳定演示、可供真实用户试用」的 MVP  
> 约束：本文件只记录已观察事实。Audit 阶段不顺手改产品代码。未开始 V1B，未改 CI，未部署。

## Executive Summary

产品主干（对象发布、记录 CRUD、OWN 范围、跟进、AI 只读助手、管理员配置）在 **Tenant Admin + Employee** 路径上可以走通，适合用 `nebula-demo` 做受控演示。

Human review 后重判：

- **没有已确认的产品 P0。** F-01 目前只证明「没有已知密码的可重复平台管理员夹具」，不能证明 Auth 链损坏。后端 `normalizeChineseMobile()` 已接受 11 位与 `+86`。
- **已确认的代码 P1 只有 F-02：** 演示 Dashboard 带 `stage IN (...)` 的「跟单商机 / 成交金额」因 `filterFields: []` 在 runtime 抛 `Compiled dashboard filter metadata missing` → `QUERY_FAILED`。
- F-03 是 demo fixture 空态（赵晨无 Follow-up），产品 empty state 合法。
- F-04 是员工 settings 的显式 `notFound()` fail-closed。
- F-05 是 admin-only 路由反馈不一致。
- F-06 是 UI 11 位国标号 → 后端 E.164，属设计而非必然 bug。

```text
CRM MVP READINESS:
NOT BLOCKED BY A CONFIRMED P0
CONFIRMED P1: F-02 Dashboard seeded filtered widgets
PLATFORM JOURNEY: REQUIRES CLEAN RE-VERIFICATION WITH KNOWN CREDENTIAL
AI UI V2: VISUALLY ACCEPTED, NOT YET MERGED TO MAIN
```

前置确认：

| 项 | 状态 |
|---|---|
| AI Assistant V1A docs closeout | PR #18 MERGED；merge `6eaac2382277fc7960bdad14937fd37c030d8a27`；post-merge run `35701694540` 六门 SUCCESS（Unit Tests 首次为已知 `window is not defined` teardown flake，rerun 后绿） |
| AI Assistant UI V2 visual review | 一次完成。1440/1280/900/390 无横向 overflow；桌面 rail 280 + canvas 860；平板/手机会话 Drawer。**无明显视觉/响应式 blocker**。不再继续 polish。 |
| AI V1B | 未开始 |

---

## Platform Admin Journey

尝试账号（文档 HANDOFF §6）：`13800000999`、`15562266465`、`13966660001`，口令 `Demo@123456`。

观察：

- 登录页对 11 位国内号提交后：**「手机号或密码不正确」**（有请求编号）。
- `+8613800000999` 被前端拦截：**「请输入有效的中国大陆手机号」**。
- 数据库（admin 只读）：三名平台管理员均为 `ACTIVE` / `is_platform_admin=true`，phone 存 `+86138…` 形式。
- 因此 **创建公司 → 邀请首位管理员 → 模板/无模板 → 启用公司 → 公司详情 → 平台日志/设置** 本轮 **未能在真实浏览器完成**。这不能证明平台认证链损坏：`seed-demo-company.ts` 不为平台管理员写入 `DEMO_PASSWORD`；这些账号来自历史注册 + `platform-admin:grant`，密码未知。正确复验是新注册已知密码用户再 grant。
- 员工会话访问 `/platform`、`/platform/tenants`：被重定向回 `/workspace/nebula-demo`（未进入平台日常业务数据，符合隔离方向，但失败反馈不是「无平台权限」页）。

未观察到：DRAFT/ACTIVE/SUSPENDED 文案、平台 Empty State、平台 destructive confirmation。

---

## Tenant Admin Journey

账号：陈静 `18800001001`。登录成功 → `/workspace/nebula-demo`。

观察到：

- 导航完整：业务对象、管理工作台、跟进、AI、成员、审计、设置。
- 设置页说明清楚：草稿 → 员工视角 → 发布。
- 业务表列表：8 张表（含 walkthrough 用 `AI权限检查`），「新建业务表」，状态「已发布」。
- 对象设计器（`ai-permission-check`）：已发布 v2，步骤「基本设置 / 字段 / 列表视图 / 员工权限 / 流程 / 发布记录」，「员工端预览」「发布变更」。
- 员工权限步骤可见查看范围/修改范围（先前 walkthrough 已用 OWN + HIDDEN 跑通）。
- 成员管理：邀请表单（手机号 + 职责 + 发送邀请），文案「对方使用自己的手机号账号接受邀请，无需由管理员设置密码」。待处理邀请空表。
- 公司审计：有「发布业务表」等中文动作；筛选可用。
- 管理工作台：商机总数 16、预计金额可见；**「跟单商机」「成交金额」组件显示「此组件暂时无法显示 / 当前权限或组件状态暂时不允许显示此结果」**（管理员本人）。
- 记录列表可打开详情抽屉：保存、安排跟进、跟进记录存在。桌面列表同时有卡片/表格两套同 href 链接，点击需 force（可用性摩擦）。

未在本轮新建完整「从零对象到发布到邀请新员工」闭环（避免污染演示数据）；配置面现有对象可完成。

---

## Employee Journey

账号：赵晨 `18800001003`。

观察到：

- 首页「我的工作台」：文案「数据只显示你当前有权查看的结果」。商机总数 **1**、预计金额 ¥57,000、负责人排行有自己。跟进区「我的跟进」。
- **「跟单商机」「成交金额」同样「此组件暂时无法显示」**。
- 跟进待办：待跟进 0 / 已逾期 0，空状态「暂无待跟进事项，从业务记录详情安排下一步。」——首页没有强 CTA 指向「今天该做什么」。
- 销售线索列表：**共 0 条**（OWN；标题含「新线索 赵晨」的记录属管理员，此前 V1A 已记录）。他人线索不出现。
- 跟单商机：**共 1 条**，OWN 正向成立。
- AI 权限检查：**共 1 条**（自己的 Record A），钱宇记录不出现。
- AI 助手：只读 badge、空态「有什么可以帮你查的？」、会话 rail 可用。
- 成员管理：进入页面但 **「仅公司管理员可管理成员」**，可继续用已授权业务功能（有说明）。
- 设置：`/workspace/nebula-demo/settings` → **404「页面不存在」**。
- 审计：`/workspace/nebula-demo/audit` → **「页面加载失败 / 重新加载」**（不是清晰的 403）。
- 390px：工作台 / 线索 / AI / 跟进均无横向 overflow；有「打开导航」。

---

## Navigation

- Tenant Admin / Employee 侧栏信息架构清楚，角色差集正确（员工无成员管理入口的写能力、无设置）。
- 员工直打管理员 URL 时反馈不一致（404 vs 加载失败 vs 有文案的只读页）。
- 平台路由对非平台用户静默回到工作台。

## Forms

- 登录校验有请求编号，可用。
- 登录只接受 11 位大陆号，与库内 `+86` 存储不一致时，平台账号即使存在也无法输入完整 E.164。
- 邀请表单职责清楚。对象设计器仍偏桌面（已知）。

## Tables

- 线索/商机列表有筛选、保存筛选、分页文案。
- 同一记录桌面出现重复 title 链接（卡片+表），自动化/点击不稳定。
- 管理员线索列表含全员记录（ALL scope，符合管理员预期）。

## Permissions UX

- OWN 在员工线索 0 / 商机 1 / AI 权限检查 1 上表现一致。
- HIDDEN 已在 V1A 真实走查验证（本 audit 不重跑 token）。
- 失败态不统一，用户难以区分「没权限」和「坏了」。

## Empty / Error / Loading

- 跟进空状态有下一步提示。
- 工作台组件失败文案偏技术（「组件状态」），管理员和员工都会看到，演示时像系统坏了。
- 员工设置 404、审计加载失败。

## Responsive

| Viewport | 观察 |
|---|---|
| 1440×900 | Admin 设置/对象/成员/审计无横向 overflow；AI canvas 860 + rail 280 |
| 1280×800 | AI canvas 721，无 overflow |
| 900px | AI rail 收起，会话按钮出现 |
| 390px | 员工工作台/线索/AI/跟进无 overflow |

## AI integration

- V1A COMPLETED（实现 + walkthrough + docs closeout 已进 main）。
- UI V2 一次视觉复核：无 P0/P1 级视觉 blocker；不继续 polish。
- 只读边界仍在。员工空态与会话历史可用。

---

## Findings

| ID | Role | Route | Severity | Issue | Evidence | Recommended action |
|---|---|---|---|---|---|---|
| F-01 | Platform | `/login` | **夹具 / 待复验** | 文档平台号 + `Demo@123456` 登不上；**未证明 Auth P0** | 11 位号「手机号或密码不正确」；库中账号 ACTIVE。seed 不为平台管理员设演示口令。后端已 normalize 11 位与 `+86` | 新注册已知密码用户 → `platform-admin:grant` → 再跑开通链路。仍失败才升 P0 |
| F-02 | Tenant Admin / Employee | `/workspace/nebula-demo` | **P1（已确认根因）** | 带 `stage IN` 的 seeded widget 因 `filterFields: []` 查询失败 | 「跟单商机」「成交金额」QUERY_FAILED。`demoPublishedDashboard()` 共用 `filterFields: []`；runtime `filterFields.find` 缺失即抛错 | 按 widget.filters 填充 filterFields；补 deterministic 测试 |
| F-03 | Employee | `/follow-ups` | **P2 demo fixture** | 赵晨无 Follow-up，今日待办为空 | 待跟进 0 / 已逾期 0；空态已提示去记录详情安排 | 可选：给演示员工加一条今日 Follow-up。不是功能损坏 |
| F-04 / F-05 | Employee | `/settings`, `/audit` | **P2** | admin-only 直链反馈不一致 | settings 显式 `notFound()`；audit 打 API 后变「页面加载失败」。侧栏无这两入口 | 统一 unauthorized-route UX。非主流程 blocker |
| F-06 | Platform | `/login` | **P2 易用性** | UI 只要 11 位国标号 | `/^1[3-9]\d{9}$/`；后端再转 E.164。合理设计 | 可选支持粘贴 `+86`；不是 P1 |
| F-07 | Any | `/platform` as employee | **P2** | 无平台权限时静默回工作台 | 赵晨访问 `/platform` → 落到 `/workspace/nebula-demo` | 明确「无平台权限」 |
| F-08 | Tenant Admin | `/objects/leads` | **P2** | 同一记录两套可见链接，点击不稳定 | 卡片+表格同 href；Playwright 需 force click | 桌面只保留一套主列表交互 |
| F-09 | Employee | `/objects/leads` | **P2** | 种子标题「新线索 赵晨」实际非赵晨 OWN，试用易误解 | 列表 0 条；V1A 已记录属管理员 | 修正演示种子 owner，或改标题 |
| F-10 | Employee | `/members` | **P2** | 员工能进成员页但只读拒绝 | 有说明「仅公司管理员可管理成员」 | 可接受；侧栏也可直接不放入口 |
| F-11 | Tenant Admin | 对象设计器 | **P2** | 配置仍强依赖宽屏 | 已知「请在桌面端完成」 | backlog；演示用桌面 |
| F-12 | All | Hosted Unit Tests | **P2** | Web 测试结束后偶发 `window is not defined` | PR #18 post-merge 首次红、rerun 绿；`dynamic-field.test.tsx` + `@rc-component/useDelayState` | 独立 test-stabilization，不塞进产品 PR |
| F-13 | AI UI V2 | `/ai` | **P3** | 空态/工具行仍可再收一档间距 | 一次视觉复核无 blocker | 不修 |
| F-14 | Login | `/login` | **P3** | 错误文案含请求编号，偏工程 | 可见 UUID | 演示可留；对试用用户可后置 |

---

## Counts

- **Confirmed P0:** 0
- **Confirmed P1:** 1（F-02）
- **Fixture / pending re-verification:** F-01
- **P2:** F-03, F-04/F-05, F-06, F-07–F-12
- **P3:** 2（F-13, F-14）

下一步（已按 human review 收口）：修正本文件严重度 → 只修 F-02 → 用已知密码复验 Platform Journey → 把 main merge 进 UI V2（不 rebase）再开 PR → 短 readiness smoke。

---

## MVP READINESS

```text
NOT BLOCKED BY A CONFIRMED P0
CONFIRMED P1: F-02 Dashboard filtered widgets
PLATFORM JOURNEY: REQUIRES CLEAN RE-VERIFICATION WITH KNOWN CREDENTIAL
AI UI V2: VISUALLY ACCEPTED, NOT YET MERGED TO MAIN
```
