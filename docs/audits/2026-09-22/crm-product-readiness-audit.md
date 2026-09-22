# CRM Product Readiness & System Usability Audit

> 日期：2026-09-22  
> 环境：localhost:3000 / :3001，租户 `nebula-demo`，本地 Postgres `:5432`  
> 范围：判断是否达到「可稳定演示、可供真实用户试用」的 MVP  
> 约束：本文件只记录已观察事实。Audit 阶段不顺手改产品代码。未开始 V1B，未改 CI，未部署。

## Executive Summary

产品主干（对象发布、记录 CRUD、OWN 范围、跟进、AI 只读助手、管理员配置）在 **Tenant Admin + Employee** 路径上可以走通，适合用 `nebula-demo` 做受控演示。

当前 **不能** 宣称「任意真实用户可自助开通并试用」，主要卡在：

1. 本机 **Platform Super Admin 无法用文档记录的手机号 + 演示口令登录**（账号在库中 ACTIVE，但登录页拒绝）。未完成创建公司 / 邀请首管 / 启用公司的真实浏览器走查。
2. 员工首页工作台多个核心组件显示「此组件暂时无法显示」。
3. 员工「今天该做什么」几乎空白：跟进待办 0、销售线索列表 0（OWN），首页 CTA 弱。
4. 若干权限失败页不一致：设置 404、审计「页面加载失败」、平台路由被重定向回工作台。

**MVP READINESS: READY AFTER P0/P1 FIXES**

受控演示（已有 nebula-demo + 已知管理员/员工账号）：接近 READY。  
陌生用户自助开通 + 稳定试用：NOT READY，直到 P0/P1 关闭。

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
- 因此 **创建公司 → 邀请首位管理员 → 模板/无模板 → 启用公司 → 公司详情 → 平台日志/设置** 本轮 **未能在真实浏览器完成**。
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
| F-01 | Platform | `/login` | **P0** | 文档中的平台管理员无法登录；自助开通公司链路未验证 | `13800000999` / `15562266465` / `13966660001` + 演示口令 →「手机号或密码不正确」；库中三账号 ACTIVE 且 `is_platform_admin`；`+86` 输入被前端拒绝 | 修复登录规范化（11 位 vs `+86`）与平台种子口令；补一条可演示的平台登录路径 |
| F-02 | Tenant Admin / Employee | `/workspace/nebula-demo` | **P1** | 工作台核心组件失败，演示像坏了 | 管理员与员工均见「跟单商机」「成交金额」→「此组件暂时无法显示」 | 查发布 #8 组件配置/权限；失败时给出可理解空态或修复数据 |
| F-03 | Employee | `/workspace/nebula-demo` + `/follow-ups` | **P1** | 「今天该做什么」几乎为空，首页 CTA 弱 | 待跟进 0、已逾期 0；线索 OWN=0；空态把人赶到记录详情，但首页商机组件还是失败态 | 演示种子给试用员工至少 1 条今日跟进；首页失败组件不要压过「我的跟进」 |
| F-04 | Employee | `/workspace/.../settings` | **P1** | 无权限走 404 | 赵晨打开设置 →「页面不存在 / 返回登录」 | 403/无权限页，保留工作区壳，不要像路由写错 |
| F-05 | Employee | `/workspace/.../audit` | **P1** | 无权限走「页面加载失败」 | 赵晨打开审计 → 加载失败 + 重新加载 | 与 F-04 统一为权限拒绝 |
| F-06 | Platform | `/login` 字段 | **P1** | 库存储 E.164，UI 只接受 11 位 | `+8613800000999` →「请输入有效的中国大陆手机号」 | 登录规范化去掉/接受 +86，与存储一致 |
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

- **P0:** 1（F-01）
- **P1:** 5（F-02, F-03, F-04, F-05, F-06）
- **P2:** 6（F-07–F-12）
- **P3:** 2（F-13, F-14）

P2 进 backlog。P3 不修。P0/P1 待审阅后拆独立修复批次。

---

## MVP READINESS

**READY AFTER P0/P1 FIXES**

关闭 F-01（平台可登录并走完开通）以及 F-02–F-06（工作台组件、员工今日工作、权限失败页、手机号规范化）后，可宣称受控试用。在此之前：用 nebula-demo + 陈静/赵晨 做销售演示可以，但不要把「自助开通」和「员工打开首页即知今日工作」当成已验证能力。
