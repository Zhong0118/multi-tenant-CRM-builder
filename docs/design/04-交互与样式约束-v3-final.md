# CRM 平台交互与样式约束 V3（Final）

> **状态：唯一有效版本 / Canonical UI & UX Specification**  
> **适用范围：平台超级管理员、公司管理员、公司员工，以及登录/邀请/工作空间等公共页面。**  
> **目标：合并 V1 与 V2，消除冲突、去重，并保留两版中有价值的 UX 与工程实现规则。**  
> 后续开发、设计、AI 编码、代码审查均以本文件为准。V1、V2 仅保留归档，不再作为实现依据。

---

# 0. 规范定位

本文件回答的是：

- 页面整体应该长什么样；
- 公共布局尺寸是多少；
- Sidebar / Header / User Menu 如何实现；
- Button、Table、Form、Drawer、Modal、Tabs、Tag 等组件如何表现；
- 搜索、筛选、分页、详情、权限、反馈、异常、响应式如何交互；
- Dashboard 应如何避免沦为装饰；
- “只读 / 隐藏 / OWN / 代管”如何在界面上体现；
- 登录、注册、邀请与工作空间如何交互；
- 如何避免“AI 生成式 SaaS UI”；
- 开发完成后如何验收。

本文件**不定义具体业务页面内容**。  
例如“超级管理员有哪些页面”“获客页面有哪些列”“ABC 公司跟单流程”等，应由页面规范和业务需求文档定义。

---

# 1. 设计方向

## 1.1 产品定位

产品不是炫目的 SaaS 展示页，而是企业员工每天长时间使用的业务工作台。

用户原本使用：

```text
Excel
文件夹
个人表格
聊天记录
人工汇总
```

本产品要提供：

```text
统一数据
账号
权限
流程
历史
统计
协作
```

因此设计重点不是“视觉冲击”，而是：

1. **低学习成本**
2. **高信息密度**
3. **高可扫描性**
4. **权限边界清晰**
5. **业务动作明确**
6. **数据来路和下一步清楚**
7. **长时间使用不疲劳**
8. **不同角色体验一致**

---

## 1.2 Design Concept：Operational Ledger（业务账本）

保留 V1 的核心设计思想：

> **Operational Ledger（业务账本）**

产品应保留 Excel 的熟悉感：

- 表格
- 列
- 筛选
- 排序
- 数据密度

同时补足 Excel 的缺陷：

- 来源
- 负责人
- 权限
- 当前阶段
- 下一步
- 历史记录
- 审计
- 统计
- 多人协作

---

## 1.3 特色交互：Ledger Rail（账本轨）

“账本轨”是本产品可保留的一个差异化交互，但**只用于有明显生命周期的记录详情**，不作为全站装饰。

典型结构：

```text
来源
● Bot 外呼
│
当前阶段
● 已报价
│
下一步
○ 8 月 28 日再次联系
```

适用：

- 获客
- 跟单
- 客户转化
- 审核流程
- 服务阶段
- 项目阶段

不适用：

- 系统设置
- 权限配置
- 普通列表
- Dashboard KPI

账本轨的目的不是“好看”，而是让用户快速回答：

```text
这条数据从哪里来？
现在处于什么状态？
下一步应该做什么？
```

---

# 2. 视觉设计原则

## 2.1 关键词

```text
Enterprise SaaS
Operational
Neutral
Table-first
Dense but readable
Low decoration
Clear hierarchy
Long-session friendly
```

---

## 2.2 明确禁止的风格

不使用：

- 大面积渐变；
- 玻璃拟态；
- 霓虹发光；
- 彩色阴影；
- 3D 图标；
- 每个模块一种颜色；
- 大量彩色圆形 Icon 背景；
- 卡通机器人；
- AI 卡通用户头像；
- 大量胶囊按钮；
- 每个区域都使用浮动卡片；
- 为了“高级感”制造的大面积空白；
- 插画型空状态；
- 漂浮背景动画；
- 持续发光动画；
- 无业务意义的装饰图形。

设计原则：

> **弱装饰、强信息。**

---

# 3. Design Tokens

## 3.1 主色

统一采用 Work Blue：

| Token | Value | Usage |
|---|---|---|
| `--color-primary` | `#2563EB` | 主按钮、链接、焦点、选中 |
| `--color-primary-hover` | `#1D4ED8` | Hover |
| `--color-primary-active` | `#1E40AF` | Active |
| `--color-primary-soft` | `#EFF6FF` | 轻选中背景 |
| `--color-primary-border` | `#BFDBFE` | 选中/Focus 边框 |

---

## 3.2 中性色

| Token | Value | Usage |
|---|---|---|
| `--text-primary` | `#0F172A` | 页面标题、主文本 |
| `--text-secondary` | `#475569` | 次级说明 |
| `--text-tertiary` | `#64748B` | 辅助信息 |
| `--text-disabled` | `#94A3B8` | Disabled |
| `--border-default` | `#E2E8F0` | 普通边框 |
| `--border-strong` | `#CBD5E1` | 强边框 |
| `--bg-page` | `#F8FAFC` | 页面背景 |
| `--bg-surface` | `#FFFFFF` | Table / Form / Card |
| `--bg-hover` | `#F1F5F9` | Hover |
| `--bg-selected` | `#EFF6FF` | Selected |

### 取舍说明

V1 的 `#F4F7F9` 与 V2 的 `#F8FAFC` 存在冲突。  
V3 统一采用：

```text
#F8FAFC
```

原因：

- 更干净；
- 减少灰蒙感；
- 与 `#FFFFFF` Surface 区分足够；
- 更适合长时间后台系统。

---

## 3.3 状态色

保留 V1 更克制的业务语义色，同时使用工程化 Token 命名。

| Token | Value | Semantic |
|---|---|---|
| `--color-success` | `#0F766E` | 已完成、已验证、成功 |
| `--color-warning` | `#B45309` | 待审核、临期、风险 |
| `--color-danger` | `#B42318` | 错误、危险、逾期 |
| `--color-info` | `#2563EB` | 信息、处理中 |

状态必须同时包含：

```text
颜色 + 文本
```

不能只有绿色点或红色点。

---

# 4. Typography

## 4.1 字体

统一：

```css
font-family:
  Inter,
  "Noto Sans SC",
  "PingFang SC",
  "Microsoft YaHei",
  sans-serif;
```

数字：

```css
font-variant-numeric: tabular-nums;
```

不再单独使用 IBM Plex Sans Condensed。

原因：

- 减少字体依赖；
- 降低跨平台视觉差异；
- 避免工程复杂度；
- 当前 CRM MVP 不需要额外展示字体体系。

---

## 4.2 字号

| Scene | Font Size | Line Height | Weight |
|---|---:|---:|---:|
| 页面标题 | 24px | 32px | 600 |
| 区块标题 | 18px | 26px | 600 |
| Card 标题 | 15px | 22px | 600 |
| 正文 | 14px | 22px | 400 |
| Table | 14px | 20px | 400 |
| Control Label | 13px | 20px | 500 |
| 辅助文字 | 12px | 18px | 400 |
| KPI | 28px | 34px | 600 |

要求：

- 表格正文不得小于 13px；
- 不使用 700/800 超粗标题；
- 金额、数量、日期列使用 tabular numbers；
- 长文本优先截断 + Tooltip/详情，而不是压缩字体。

---

# 5. Spacing、Radius 与尺寸

## 5.1 间距

基础网格：

```text
4px
```

常用：

```text
4
8
12
16
20
24
32
40
```

禁止页面随意出现：

```text
13px
19px
27px
```

等无 Token 间距。

---

## 5.2 圆角

| Element | Radius |
|---|---:|
| Input / Button | 6px |
| Card / Container | 8px |
| Status Tag | 4px |
| Drawer / Modal | 8–10px |
| Avatar | 50% |

不使用大面积 16–24px 圆角 SaaS 风格。

---

## 5.3 Shadow

普通内容：

```css
box-shadow: none;
```

允许 Shadow：

- Dropdown
- Popover
- Drawer
- Modal
- Command Palette

普通 Card 只使用：

```text
White Surface + Border
```

---

# 6. Global App Shell

## 6.1 最终统一尺寸

V1：

```text
Sidebar 224
Header 56
```

V2：

```text
Sidebar 240
Header 64
```

V3 最终统一：

| Element | Size |
|---|---:|
| Sidebar Expanded | **240px** |
| Sidebar Collapsed | **64px** |
| Top Header | **64px** |
| Page Padding ≥1440 | **24px** |
| Page Padding 1024–1439 | **20px** |
| Page Padding <1024 | **16px** |
| Section Gap | **24px** |
| Card Padding | **20px** |
| Compact Control | **32px** |
| Default Control | **36px** |
| Primary Touch Target | **≥40px** |

---

## 6.2 Layout

```text
┌──────────── Sidebar 240 ────────────┬────────── Header 64 ──────────────┐
│ Logo / Workspace                    │ Breadcrumb     Search     User     │
│                                     ├───────────────────────────────────┤
│ Navigation                          │                                   │
│                                     │ Page Header                       │
│                                     │                                   │
│                                     │ Toolbar / Filters                 │
│                                     │                                   │
│                                     │ Main Content                      │
│                                     │                                   │
│ Collapse                            │                                   │
│ Logout                              │                                   │
└─────────────────────────────────────┴───────────────────────────────────┘
```

---

# 7. Sidebar

## 7.1 结构

```text
Logo / Workspace
──────────────────
Navigation
...
──────────────────
Collapse
Logout
```

Logo 区：

```text
64px 高
```

---

## 7.2 Menu Item

| Property | Value |
|---|---:|
| Height | 40px |
| Horizontal Padding | 12px |
| Icon | 18px |
| Gap | 10px |
| Radius | 6px |
| Item Gap | 4px |
| Sidebar Horizontal Margin | 8px |

---

## 7.3 状态

### Default

```text
icon #64748B
text #334155
background transparent
```

### Hover

```text
background #F1F5F9
text #0F172A
transition 120ms
```

### Active

```text
background #EFF6FF
icon #2563EB
text #1D4ED8
font-weight 500
```

### Pressed

```text
background #DBEAFE
```

不缩放、不弹跳。

---

## 7.4 Collapse

收起后：

```text
width 64px
```

规则：

- 只显示 Icon；
- Hover 显示 Tooltip；
- 当前页面仍显示 Active；
- Logo 只显示图形；
- Logout 只显示 Icon；
- 不改变菜单顺序。

---

## 7.5 Bottom Actions

固定：

```text
[ ← 收起菜单 ]
[ ↪ 退出登录 ]
```

Logout：

- 默认中性色；
- Hover 变 Danger；
- 无未保存内容时可直接退出；
- 有未保存内容时提示：

```text
当前页面存在未保存内容，退出后将丢失。
```

---

# 8. Icon

统一只使用一套 Icon Library：

> 推荐 **Lucide Icons**

如果工程已确定 Remix Icon，也可统一使用 Remix，但**不得混用**。

规格：

| Scene | Size |
|---|---:|
| Sidebar | 18px |
| Button | 16px |
| Inline Status | 14–16px |
| Empty State | 32px |
| Stroke | 1.75px |

禁止：

- 3D；
- 多色业务 Icon；
- 彩色 Halo；
- AI 绘制 Icon；
- 不同页面使用不同风格 Icon。

---

# 9. Top Header

高度：

```text
64px
```

---

## 9.1 结构

```text
Breadcrumb / Workspace
                 Global Search
                              Notification
                              Help
                              User Menu
```

---

## 9.2 左侧

平台管理页：

```text
公司管理 / 公司详情
```

日常一级业务页不强制 Breadcrumb。

Breadcrumb 最多 3 层。

---

## 9.3 Workspace

公司管理员 / 员工页面顶部持续显示：

```text
ABC贸易
```

如用户属于多个公司，可提供切换。

切换工作空间后必须：

```text
回到目标工作空间首页
```

不能保留旧公司 URL。

---

## 9.4 Global Search

Desktop：

```text
320–420px
```

<1200：

```text
260px
```

平台管理员：

```text
搜索公司、用户、模块或功能
```

公司管理员：

```text
搜索客户、跟单、员工或业务记录
```

员工：

```text
搜索我的客户或跟单
```

支持：

```text
⌘ K
Ctrl K
```

所有结果必须重新执行权限校验。

---

## 9.5 Notification

顺序：

```text
通知 → 帮助 → 用户
```

Badge：

```text
99+
```

通知只作为：

```text
待处理
系统
安全
```

入口，不做社交 Feed。

---

# 10. User Menu

## 10.1 Trigger

公司角色：

```text
[Avatar 32]  张三
             公司管理员 ▾
```

超级管理员：

```text
[Avatar 32] 平台超级管理员 ▾
```

Avatar：

优先：

1. 用户上传头像；
2. 姓名首字母；
3. 中性人物占位。

禁止 AI 卡通头像。

---

## 10.2 Dropdown

```text
张三
138****1234
公司管理员
────────────
个人资料
账号与安全
切换工作空间（多个工作空间时）
────────────
退出登录
```

平台超级管理员：

```text
姓名
平台超级管理员
────────────
个人资料
账号与安全
────────────
退出登录
```

---

# 11. Page Header

标准：

```text
页面标题                         [Secondary] [Primary]
一句话说明 / 数据更新时间
```

规则：

- 页面最多一个 Primary；
- Secondary 不抢主操作；
- Danger 不常驻 Header；
- Page Header 与 Toolbar 间距 20–24px；
- 页面标题必须是用户语言，不使用技术名词。

---

# 12. Navigation Naming

普通用户不出现：

```text
Object
Schema
JSONB
Metadata
Record Entity
```

使用：

```text
获客
跟单
客户
期刊
员工
统计
```

平台配置页可以使用：

```text
业务对象
字段
模板
```

但需要有业务示例。

同一动作必须统一动词：

```text
按钮：转为客户
Toast：已转为客户
日志：将跟单转为客户
```

---

# 13. Button

## 13.1 Primary

```text
height 36px
padding 0 14px
radius 6px
background #2563EB
```

Hover：

```text
#1D4ED8
```

Active：

```text
#1E40AF
```

---

## 13.2 Secondary

```text
white
border #CBD5E1
text #334155
```

---

## 13.3 Text Button

用于：

```text
查看
编辑
详情
更多
查看全部
```

---

## 13.4 Danger

只用于：

- 删除；
- 停用；
- 撤销；
- 不可恢复变更。

Danger Action 默认进入：

```text
More Menu
Detail
Confirmation Modal
```

而不是放大红色按钮。

---

## 13.5 Loading / Disabled

提交中：

```text
Loading Icon + 当前动作
```

例如：

```text
正在保存…
```

不允许用户重复提交。

Disabled 必须保持可读，不使用过低对比度。

---

# 14. Card / Surface

标准：

```css
background: #FFFFFF;
border: 1px solid #E2E8F0;
border-radius: 8px;
box-shadow: none;
```

Card 用于：

- KPI；
- Summary；
- Form Section；
- Dashboard Chart；
- Config Section。

普通 Table Page 不应拆成十几个 Card。

---

# 15. KPI

KPI 只应用于：

- Dashboard；
- 平台总览；
- 数据统计。

格式：

```text
本月成交
28
较上月 +4
```

第一屏：

```text
最多 4–6 个
```

Icon：

- 可选；
- 单色；
- 不使用彩色 Icon 圆底。

---

# 16. Filter Bar

标准：

```text
[搜索....................]
[状态 ▾]
[负责人 ▾]
[业务时间 ▾]
[更多筛选]
                         [重置]
```

---

## 16.1 搜索

- debounce：300ms；
- Enter：立即执行；
- Loading 不清空 Input；
- URL 保存 query。

---

## 16.2 Filter

高频：

```text
直接显示
```

低频：

```text
更多筛选
```

激活后显示可读条件：

```text
负责人：张三 ×
阶段：已报价 ×
下次跟进：今天 ×
清除全部
```

---

## 16.3 日期

禁止只写：

```text
日期
```

应写：

```text
创建时间
最近更新时间
下次跟进时间
成交日期
```

---

## 16.4 Empty 与 Filtered Empty

### Empty

```text
暂无客户
创建第一条客户记录后可开始管理

[+ 新增客户]
```

### Filtered Empty

```text
当前筛选条件没有找到客户

[清除筛选]
```

两种状态不得混用。

---

# 17. Table

CRM 最核心组件。

## 17.1 尺寸

| Property | Value |
|---|---:|
| Header | 40px |
| Row | 44px |
| Dense Row | 40px |
| Cell Horizontal Padding | 12px |
| Font | 14px |

---

## 17.2 基本规则

- 表头 Sticky；
- 主字段可冻结；
- 横向滚动保留操作列；
- 默认分页；
- 默认每页 50 条；
- 支持 20 / 50 / 100；
- 不用无限滚动替代业务分页；
- 金额右对齐；
- 数量右对齐；
- 日期统一格式；
- 长文本截断 + Tooltip。

---

## 17.3 Row State

Hover：

```text
#F8FAFC
```

Selected：

```text
#EFF6FF
```

Disabled：

```text
降低文本强度，但仍可阅读
```

---

## 17.4 Row Click

单击 Row：

```text
打开 Detail Drawer
```

以下元素阻止 Row Click：

- Checkbox；
- Link；
- Button；
- Select；
- Quick Edit Control；
- More Menu。

双击不绑定关键动作。

---

## 17.5 Selection / Batch

选择记录后显示：

```text
已选择 8 条
[批量分配]
[批量导出]
[更多]
```

需明确：

```text
当前页选择
全部筛选结果选择
```

避免用户误解。

---

## 17.6 Column

允许：

- 调整列宽；
- 隐藏列；
- 排序列；
- 保存个人视图。

但优先级：

```text
Permission > System Configuration > Personal Column Preference
```

例如：

```text
成本字段 = HIDDEN
```

用户个人列设置绝不能重新显示。

---

# 18. Inline Edit

MVP 默认：

> **不做任意 Excel 式单元格编辑。**

默认流程：

```text
Row
↓
Drawer
↓
Edit
```

允许 Quick Edit：

- 负责人；
- 简单状态；
- 单选；
- 明确授权字段。

Quick Edit 同样必须：

- 服务端校验；
- 权限校验；
- 乐观锁；
- 审计记录；
- 失败回滚。

---

# 19. Form

## 19.1 Layout

```text
Label
[ Input                          ]
Helper / Error
```

Label 永远在 Input 上方。

---

## 19.2 Column

≥1200：

```text
2 columns
```

以下情况使用 1 column：

- 长文本；
- 复杂说明；
- 地址；
- Rich Input；
- 权限配置。

---

## 19.3 Section

动态 Form 按业务分组：

```text
基本信息
客户需求
跟进安排
内部信息
```

每组建议：

```text
4–8 fields
```

---

## 19.4 Helper Text

字段帮助文案只解释：

- 输入格式；
- 业务约束；
- 示例；
- 权限原因。

不要机械重复字段 Label。

例如：

```text
联系电话
[________________]

用于客户回访，不会对外公开。
```

而不是：

```text
联系电话
请输入联系电话
联系电话字段
```

---

## 19.5 Required

使用：

```text
*
```

同时错误必须明确：

```text
请输入客户名称
```

而不是：

```text
必填
```

---

## 19.6 Validation

保存失败：

1. 保留用户输入；
2. 滚动至首个错误；
3. 聚焦错误 Input；
4. 显示具体原因；
5. 不清空整页。

---

## 19.7 READ_ONLY

不要展示 Disabled Select。

正确：

```text
最终评级
A
仅管理员可以修改
```

或：

```text
最终评级
A  🔒
```

Lock Icon 必须配文字，不单独表达权限。

---

## 19.8 HIDDEN

隐藏字段：

- 不占空间；
- 不进入 DOM 的业务可视区；
- 不进入提交载荷；
- 不出现在 Filter；
- 不出现在 Export；
- 不出现在打印；
- 不出现在列设置。

---

## 19.9 Dangerous Change

例如：

```text
停用字段
修改字段类型
批量替换
转为客户
```

必须显示影响范围。

示例：

```text
停用“预计金额”后：
• 现有 2,345 条数据仍保留
• 员工页面将不再显示
• Dashboard 指标“预计金额总计”将失效
```

---

# 20. Drawer

## 20.1 Width

```text
普通详情：560px
复杂详情：720px
<768：Full Screen
```

---

## 20.2 Structure

```text
Title + Status                     X
Secondary Information
────────────────────────────────────
Ledger Rail（适用时）
Tabs / Sections
Scrollable Content
────────────────────────────────────
Fixed Actions（必要时）
```

---

## 20.3 Header

Header 固定。

内容滚动。

主操作只出现一处：

- Header；
- 或 Fixed Footer。

不能重复两套主按钮。

---

## 20.4 Ledger Rail

适用于生命周期记录。

节点：

```text
来源
当前
下一步
```

可点击节点跳到活动历史。

动效：

```text
120–180ms
```

轻微顺序出现。

---

## 20.5 Activity vs Field

字段修改和活动新增必须是两个概念。

错误示例：

```text
每次跟进都覆盖备注字段
```

正确：

```text
Record Fields
+
Activities
```

---

## 20.6 Previous / Next

打开 Drawer 后可：

```text
上一条
下一条
```

切换记录时：

- 保留 Filter；
- 保留排序；
- 保留列表位置；
- 当前 Row 高亮变化。

---

# 21. Modal

只用于：

- 删除；
- 停用；
- 转换；
- 小型确认；
- 小型参数配置。

推荐：

```text
420
520
640px
```

不用于：

- 大表单；
- 权限矩阵；
- 表单 Builder；
- 长时间操作流程。

---

# 22. Tabs

使用：

```text
Underline Tabs
```

规则：

- Height 40px；
- Active `#2563EB`；
- 不使用大胶囊；
- 不用不同 Tab 色彩；
- Tab 数量 >7 时考虑二级导航或 Dropdown。

---

# 23. Status Tag

Radius：

```text
4px
```

典型：

```text
已启用
待审核
已停用
跟进中
已报价
已成交
已逾期
```

同一状态跨页面颜色必须一致。

禁止：

```text
同一个“已成交”
在页面 A 是绿
页面 B 是蓝
```

---

# 24. Feedback

## 24.1 Success Toast

显示：

```text
2–4 秒
```

必须说明对象和结果：

```text
跟进记录已保存
客户已转为正式客户
员工权限已更新
```

禁止：

```text
操作成功
Success
```

---

## 24.2 Error

错误必须回答：

```text
发生了什么？
哪一项有问题？
如何继续？
```

例如：

```text
无法保存：手机号格式不正确。
```

而不是：

```text
操作失败，请重试。
```

---

## 24.3 Inline Result

以下情况不能只 Toast：

- Import Result；
- Batch Result；
- Permission Changed；
- Integration Failure；
- Webhook Failure；
- Partial Success。

应显示：

```text
成功 86
失败 14

[下载失败记录]
```

---

## 24.4 Network Failure

必须：

- 保留 Form；
- 提供重新提交；
- 不静默丢数据；
- 不自动关闭 Drawer/Modal。

---

## 24.5 403 / 404

明确区分：

```text
403 = 有资源，但当前用户无权限
404 = 资源不存在
```

跨租户敏感资源可以统一返回：

```text
404
```

以避免枚举。

---

# 25. Loading / Empty / Error / No Permission

每个 P0 页面必须实现：

1. Default
2. Loading
3. Empty
4. Filtered Empty
5. Error
6. No Permission
7. Read Only
8. Disabled

---

## 25.1 Loading

优先 Skeleton：

- Table Header 可保留；
- Table Rows Skeleton；
- 不使用全屏 Spinner 阻断整个系统。

---

## 25.2 No Permission

```text
你没有访问该页面的权限
如需访问，请联系公司管理员。
```

平台级：

```text
请联系平台超级管理员。
```

---

# 26. 权限在 UI 中的表现

## 26.1 Module Permission

无模块权限：

```text
Sidebar 不出现
```

直接 URL：

```text
403 / 404
```

---

## 26.2 Action Permission

无权限：

```text
不渲染按钮
```

不是：

```text
灰掉一个用户永远不能点的按钮
```

---

## 26.3 READ_ONLY

显示：

```text
正常可读 Value
+
只读说明
```

---

## 26.4 HIDDEN

完全不存在于：

```text
Sidebar
Page
Table
Detail
Form
Filter
Column Settings
Export
Print
Search Result
```

---

## 26.5 OWN Scope

员工只允许自己的数据时：

页面名称优先：

```text
我的获客
我的跟单
我的客户
```

而不是：

```text
跟单管理
```

然后提供一个实际上不能使用的“全部”。

---

## 26.6 ALL Scope

公司管理员：

```text
全部获客
全部跟单
全部客户
```

可以按员工 Filter。

---

## 26.7 Managed / Impersonation Mode

平台超级管理员进入某公司代管时，顶部固定 Banner：

```text
你正在以平台管理员身份代管「ABC贸易」
所有操作将记录到平台审计日志。

[退出代管]
```

Banner 要醒目但不遮挡主操作。

代管必须写 Audit。

---

# 27. Dashboard

## 27.1 核心原则

Dashboard 不是装饰。

它必须回答：

```text
发生了什么？
是否异常？
下一步要做什么？
```

---

## 27.2 KPI

第一屏：

```text
最多 6 个
```

建议：

```text
4 个
```

---

## 27.3 Drill-down

每个 KPI 必须可以下钻。

例如：

```text
今日待跟进 8
```

点击：

```text
/my-followups?nextFollowup=today
```

Filter 必须一致。

---

## 27.4 Metric Definition

指标旁可提供：

```text
ⓘ
```

说明：

- 指标口径；
- 时间范围；
- 最近更新时间。

---

## 27.5 Funnel

必须同时显示：

```text
数量
转化率
```

例如：

```text
获客 1000
有效 420 42%
跟单 260 61.9%
成交 80 30.8%
```

---

## 27.6 Employee Performance

不能只给：

```text
转化率 80%
```

必须给分子 / 分母：

```text
8 / 10
80%
```

避免小样本误导。

---

## 27.7 Chart Color Consistency

图表颜色必须有稳定语义：

- 同一业务阶段跨 Dashboard、列表和详情保持一致；
- 不为了区分图表而随机换色；
- 状态颜色优先使用统一状态 Token；
- 非状态系列使用同一套克制的数据可视化色阶。

---

## 27.8 No Fake Chart

数据不足：

```text
当前周期只有 3 条数据，暂不生成趋势图。
```

不要画没有意义的漂亮空图。

---

# 28. Motion

统一：

| Motion | Duration |
|---|---:|
| Hover | 120ms |
| Dropdown | 140ms |
| Page Minor Transition | 120–160ms |
| Modal | 160ms |
| Drawer | 180ms |
| Ledger Rail Node | 120–180ms |

只允许：

```text
opacity
translate 2–4px
```

禁止：

- bounce；
- glow；
- rotate；
- large zoom；
- infinite animation。

支持：

```css
@media (prefers-reduced-motion: reduce)
```

关闭非必要动画。

---

# 29. Responsive

## 29.1 Breakpoints

### ≥1440

```text
Sidebar Expanded
完整 Table
Drawer
完整 Filters
```

### 1024–1439

```text
Sidebar 可默认收起
Page Padding 20
部分 Secondary Filter 可收进 More
```

### 768–1023

```text
Sidebar Collapsed
Secondary Filter → Filter Drawer
Drawer ≤70vw
```

### <768

员工业务页：

- Table 转重点字段 Card；
- Drawer → Full Screen；
- 保留搜索、筛选、新增、活动录入；
- Bottom Navigation 可考虑。

平台复杂配置：

```text
该功能建议在桌面端完成
```

以下功能 MVP 不承诺移动端完整编辑体验：

- 平台配置；
- 表单 Builder；
- 权限矩阵；
- Excel 大批量导入；
- 大规模批量操作；
- Dashboard Builder。

不强行把桌面复杂操作压缩成移动端页面。

---

# 30. Mobile Record Card

业务记录移动端：

```text
张先生
已报价 · 今天 16:00
负责人 张三
¥50,000                       >
```

只显示：

- 主字段；
- 状态；
- 下一步；
- 核心金额；
- 负责人。

---

# 31. Account & Authentication UX

> 该章节保留 V1 的账号 UX 规则，避免在 V3 中丢失。  
> 后续可拆为独立《账号与身份交互规范》，在拆分前本章节仍为有效规范。

---

## 31.1 登录方式

MVP：

```text
手机号 + 密码
```

不显示：

```text
邮箱登录
邮箱找回
```

除非产品需求明确增加。

---

## 31.2 注册

```text
手机号
验证码
姓名
密码
```

发送验证码和提交注册分别限流。

验证码：

- 显示剩余秒数；
- 倒计时期间仍允许用户修改手机号；
- 修改手机号后当前验证码立即失效；
- 修改后必须重新获取验证码；
- 不因为倒计时锁死手机号 Input。

---

## 31.3 Anti Enumeration

登录 / 注册 / 找回密码不直接暴露：

```text
手机号已注册
手机号未注册
```

使用中性响应。

---

## 31.4 returnTo

只允许：

```text
站内相对路径
```

登录成功后仍必须重新进行：

```text
Permission Check
```

不能因为 returnTo 直接进入无权限页面。

---

# 32. Invitation & Workspace

## 32.1 Waiting

`/waiting`：

只显示：

- 当前用户；
- 邀请；
- 账号入口。

不显示：

- 租户 Sidebar；
- CRM 数据；
- 业务搜索。

---

## 32.2 Invitation Card

必须显示：

```text
公司
拟授予角色
邀请人
到期时间
状态
```

接受前再次确认。

接受必须：

```text
幂等
Loading
```

---

## 32.3 Invitation States

独立结果状态：

- 待接受；
- 已接受；
- 已拒绝；
- 已过期；
- 已撤销；
- 手机号不匹配。

不要统一 Toast。

---

## 32.4 Workspace Routing

0 个活动工作空间：

```text
/waiting
```

1 个：

```text
/workspace/[tenantCode]
```

多个：

```text
/workspaces
```

---

## 32.5 Workspace Card

显示：

```text
公司名称
本人角色
最近访问时间
状态
```

停用 Workspace：

```text
可见
不可进入
显示原因
```

---

# 33. Import UX

保留 V1 中高价值导入规则。

流程：

```text
1 上传文件
2 选择表头
3 字段映射
4 校验预览
5 导入结果
```

Validation Preview 分：

```text
可导入
需修正
将跳过
```

执行前必须说明：

- 负责人默认值；
- 重复数据处理；
- 预计写入数量；
- 关联字段处理。

Result：

```text
成功 886
失败 14

[下载失败记录]
```

---

# 34. Accessibility

不得删除。

## 34.1 Keyboard

所有核心操作可键盘完成：

- 搜索；
- Filter；
- Table Navigation；
- Drawer；
- Form；
- Save；
- Close；
- Pagination。

---

## 34.2 Focus

Drawer / Modal 打开：

```text
Focus 进入浮层
```

关闭：

```text
Focus 返回 Trigger
```

Focus Ring 不得被主题移除。

---

## 34.3 ARIA

要求：

- Icon Button 有 `aria-label`；
- Error 与 Input 使用 `aria-describedby`；
- Table Sort 可读；
- Checkbox 可读；
- Pagination 可读；
- Tooltip 不作为唯一信息来源。

---

## 34.4 Contrast

满足：

```text
WCAG AA
```

尤其：

- Disabled Text；
- Secondary Text；
- Status Tag；
- Focus Ring。

---

## 34.5 Chart

图表必须提供：

- 文本摘要；
- 或可访问数据表。

不能只有 Canvas 图形。

---

# 35. Page Pattern Rules

## 35.1 Table Page

统一：

```text
Page Header
↓
Toolbar / Filter
↓
Optional View Summary
↓
Table
↓
Pagination
```

---

## 35.2 Config Page

统一：

```text
Page Header
↓
Object Tree / Tabs
↓
Editor
↓
Preview / Permission / Help
```

---

## 35.3 Detail Page

优先：

```text
List + Drawer
```

只有：

- 深度配置；
- 独立 URL；
- 大量子模块；

才使用 Full Page。

---

# 36. AI Coding / Frontend Implementation Rules

后续 AI 或前端开发禁止：

- 自行改变 Sidebar 宽度；
- 自行改变 Header 高度；
- 随意增加颜色；
- 创建新的 Button Variant；
- 每个页面独立设计 Table；
- 创建卡通 Avatar；
- 添加渐变；
- 加大圆角；
- 为了“高级感”增加 Shadow；
- 将 HIDDEN 字段只在前端 CSS 隐藏；
- 将权限逻辑只写前端；
- 用 Toast 替代所有错误处理；
- 让 Dashboard 只有漂亮图表没有下钻。

---

# 37. Canonical Values（最终定值）

| Item | Final |
|---|---|
| Sidebar Expanded | `240px` |
| Sidebar Collapsed | `64px` |
| Header | `64px` |
| Page Padding | `24px` |
| Medium Page Padding | `20px` |
| Sidebar Item | `40px` |
| Compact Control | `32px` |
| Default Control / Primary Button | `36px` |
| Primary Touch Target | `≥40px` |
| Table Header | `40px` |
| Table Row | `44px` |
| Dense Table Row | `40px` |
| Control Radius | `6px` |
| Container Radius | `8px` |
| Tag Radius | `4px` |
| Drawer | `560 / 720px` |
| Primary | `#2563EB` |
| Primary Soft | `#EFF6FF` |
| Page BG | `#F8FAFC` |
| Surface | `#FFFFFF` |
| Border | `#E2E8F0` |
| Text | `#0F172A` |
| Success | `#0F766E` |
| Warning | `#B45309` |
| Danger | `#B42318` |

若其他文档与本表冲突：

> **以本表为准。**

---

# 38. 开发验收 Checklist

## Layout

- [ ] Sidebar Expanded = 240px
- [ ] Sidebar Collapsed = 64px
- [ ] Header = 64px
- [ ] Page Padding 使用 Token
- [ ] Mobile / Tablet 行为符合规范

## Visual

- [ ] 无大面积渐变
- [ ] 无彩色装饰 Icon 背景
- [ ] 无 AI 卡通头像
- [ ] 无无意义 Shadow
- [ ] 无过大圆角
- [ ] Icon Library 唯一
- [ ] Status 色跨页面一致

## Page

- [ ] 页面最多一个 Primary Action
- [ ] Danger Action 不抢主视觉
- [ ] Loading 状态存在
- [ ] Empty 状态存在
- [ ] Filtered Empty 状态存在
- [ ] Error 状态存在
- [ ] No Permission 状态存在

## Table

- [ ] Sticky Header
- [ ] Row Hover
- [ ] Row Selected
- [ ] Pagination
- [ ] 搜索/筛选进入 URL
- [ ] 返回页面恢复上下文
- [ ] Checkbox/Button 不触发 Row Click
- [ ] Permission 高于 Column Preference

## Form

- [ ] Validation 保留输入
- [ ] 首个错误可聚焦
- [ ] READ_ONLY 不使用难读 Disabled
- [ ] HIDDEN 不进入 Payload
- [ ] Danger Change 有影响说明

## Drawer

- [ ] 普通 560px
- [ ] 复杂 720px
- [ ] Header 固定
- [ ] Content 可滚动
- [ ] 主操作不重复
- [ ] 保留 List Context
- [ ] 生命周期记录支持 Ledger Rail

## Permission

- [ ] 无模块权限 Sidebar 不出现
- [ ] 无动作权限 Button 不渲染
- [ ] READ_ONLY 有文字说明
- [ ] HIDDEN 在所有出口不存在
- [ ] OWN 页面不伪装“全部”
- [ ] 代管模式有明确 Banner

## Dashboard

- [ ] KPI ≤ 6
- [ ] KPI 可下钻
- [ ] 有指标口径
- [ ] 有更新时间
- [ ] Funnel 有数量 + 转化率
- [ ] Ranking 有分子/分母
- [ ] 无 Fake Chart

## Feedback

- [ ] Toast 描述具体对象
- [ ] Error 描述原因和下一步
- [ ] Network Error 保留输入
- [ ] Batch / Import 有结果面板
- [ ] 403 / 404 处理正确

## Accessibility

- [ ] Keyboard 可操作
- [ ] Focus 可见
- [ ] Drawer / Modal Focus 正确
- [ ] Icon Button 有 aria-label
- [ ] Error 使用 aria-describedby
- [ ] Contrast 符合 WCAG AA
- [ ] Chart 有文本摘要或数据表

---

# 39. V1 / V2 合并说明

本 V3 已完成以下冲突解决：

| Item | V1 | V2 | V3 |
|---|---|---|---|
| Sidebar | 224px | 240px | **240px** |
| Header | 56px | 64px | **64px** |
| Page BG | #F4F7F9 | #F8FAFC | **#F8FAFC** |
| 字体 | Noto + IBM Plex | Inter + Noto | **Inter + Noto** |
| Status 色 | Ledger 系列 | 标准绿色/橙/红 | **保留 V1 克制语义色** |
| Operational Ledger | 有 | 弱化 | **保留** |
| Ledger Rail | 有 | 无 | **保留** |
| Sidebar 工程参数 | 简略 | 详细 | **采用 V2** |
| Icon 规范 | 简略 | 详细 | **采用 V2** |
| Button/Card 规范 | 简略 | 详细 | **采用 V2** |
| Table UX | 完整 | 较完整 | **融合** |
| Inline Edit | 有 | 弱化 | **保留 V1** |
| Form UX | 完整 | 视觉化 | **融合** |
| Feedback/Error | 完整 | 缺失 | **保留 V1** |
| 权限 UI | 完整 | 有 | **融合** |
| OWN | 有 | 缺失 | **保留** |
| 代管模式 | 有 | 缺失 | **保留** |
| Dashboard UX | 完整 | 简化 | **保留 V1 + V2视觉** |
| Auth/Invitation | 有 | 无 | **保留章节** |
| Accessibility | 有 | 无 | **完整保留** |
| 去 AI 味规则 | 隐含 | 明确 | **完整保留 V2** |
| Acceptance | 有 | 工程化 | **采用 V2 并扩展** |

---

# 40. 版本原则

从 V3 开始：

```text
V3 = 唯一权威规范
```

以后若需要调整：

```text
V3.1
V3.2
V4
```

禁止继续同时维护：

```text
V1
V2
V3
```

开发目录建议：

```text
docs/
├── active/
│   └── 04-交互与样式约束.md   ← V3
│
└── archive/
    ├── 04-交互与样式约束-v1.md
    └── 04-交互与样式约束-v2.md
```

所有开发提示词应明确：

> UI/UX 实现以 `04-交互与样式约束.md` 为唯一规范；若其他文档存在视觉或交互冲突，以该文件为准。
