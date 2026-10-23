/* Every claim on the landing page lives here and describes the deployed
   release (main). Each one was checked against the code before it was
   written; when behaviour changes, change the claim in the same commit.
   Work that exists only in unmerged branches goes in ROADMAP, labelled as
   not yet available. The demos use one fictional company, 禾木办公家具. */

export const PUBLIC_ORIGIN = "https://crm.baijiehub.com";

export const ICP_RECORD = {
  number: "鲁ICP备2026063095号-1",
  lookup: "https://beian.miit.gov.cn/",
} as const;

export const COMPANY = "山东百杰网络科技有限公司";

/* FIELD_TYPE_LABELS in features/objects, in the order the editor lists them. */
export const FIELD_TYPES = [
  "文本",
  "长文本",
  "电话",
  "邮箱",
  "数字",
  "金额",
  "日期",
  "日期时间",
  "单选",
  "多选",
  "成员",
  "是否",
];

export const TABLE_POINTS = [
  {
    term: "先改草稿，再发布",
    detail:
      "字段、列表和权限都在草稿里改。发布前列出新增、修改和停用的字段，发布后同事才用到；已发布字段的类型不能再改。",
  },
  {
    term: "停用，不删除",
    detail:
      "不再使用的字段、选项和整张业务表都可以停用。记录、配置和审计记录都保留，恢复后照常使用。",
  },
  {
    term: "从模板开始",
    detail:
      "新开通的公司可以由平台套用业务模板，复制成自己的草稿，再由公司管理员调整、发布。",
  },
];

/* Stages and defaults of the staged pool (record-ownership, pool config). */
export const POOL_STAGES = [
  {
    key: "lead",
    name: "线索池",
    detail:
      "导入时可选择直接进入线索池，管理员也可以把记录释放进来。员工按权限领取，管理员也可以直接分配给某位同事。",
  },
  {
    key: "pending",
    name: "待联系",
    detail:
      "领取或分配后开始计时，默认 24 小时内要确认已联系；超时没有确认，记录自动回到线索池。",
  },
  {
    key: "following",
    name: "跟进中",
    detail:
      "每登记一次电话、消息、拜访或备注，跟进期限就顺延，默认 30 天。不想继续跟进时，写明原因释放回公海。",
  },
  {
    key: "protected",
    name: "成交保护",
    detail:
      "关联的合同或订单走到你们设定的成交状态时，客户进入成交保护，不再被自动回收。",
  },
] as const;

export const DATA_POINTS = [
  {
    term: "导入 Excel 和 CSV",
    detail:
      "支持 .xlsx、.xls 和 CSV，一个工作表最多 10,000 行、40 列，文件 10 MB 以内，系统自动分批。导入前先检查，逐行标出问题；导入只新增，不覆盖已有记录。",
  },
  {
    term: "筛选、搜索和列",
    detail:
      "按负责人和字段筛选，常用条件存成“我的筛选”；每个人调整自己看到的列和顺序，这两项保存在当前浏览器。",
  },
  {
    term: "批量处理",
    detail:
      "勾选多条记录，一次统一修改字段（每次最多 100 条），或分配给同一位负责人（每次最多 1,000 条），逐条显示结果。",
  },
  {
    term: "导出",
    detail: "导出当前筛选结果，最多 5,000 行，Excel 可以直接打开。",
  },
];

export const FLOW_POINTS = [
  "为业务表定义状态和流转，可以要求填好某些字段、限定哪些角色能操作。",
  "推进到某一步时，按配置自动分配负责人、创建跟进待办，或在另一张表新建一条记录并与当前记录关联。",
  "记录之间可以互相关联，附件随记录保存，单个最大 5 MB；每次流转都留有历史。",
];

export const ACCESS_POINTS = [
  "每张业务表按角色设为全部记录、仅本人负责或无权访问。",
  "每个字段可设为可编辑、只读或隐藏，也可以为个别成员单独设置。限制在服务端执行，AI 助手同样遵守。",
  "同事离职时，把他名下的记录和待办一次交接给在职同事，再停用账号。",
  "记录的新建、修改和导出，成员、邀请和权限的变更，都留有审计记录。",
];

export const DAILY_POINTS = [
  {
    term: "工作台",
    detail: "打开就是自己今天到期、已逾期和未来 7 天的跟进。",
  },
  {
    term: "站内消息",
    detail:
      "联系期限快到、跟进到期、线索被自动回收、成交保护需要复核，都会在右上角的消息里提醒。",
  },
  {
    term: "跟进待办",
    detail: "可以完成、改期，或转给能查看这条记录的同事。",
  },
  {
    term: "首页仪表盘",
    detail:
      "管理员为管理员和员工分别配置首页：指标、状态分布、趋势、排行和记录列表。",
  },
];

/* Only in unmerged pull requests at the time of writing. */
export const ROADMAP = [
  {
    name: "跨表自动化规则",
    detail:
      "在一条记录上手动执行预设规则，先预览，再在另一张表新建或更新记录。",
  },
  {
    name: "登记联系结果",
    detail: "电话接通、新加上微信这类结果直接推进线索阶段，未接通不算联系。",
  },
  {
    name: "工作任务与日报",
    detail: "不挂在客户上的日常任务，以及每人每天一份的工作日报。",
  },
  {
    name: "团队动态",
    detail: "按公司日历统计每位成员登记的电话、拜访、领取和待办完成情况。",
  },
];

export const FAQ = [
  {
    q: "现在可以直接注册吗？",
    a: "可以。用手机号接收验证码并设置密码，就能创建个人账号。加入公司工作区需要接受公司管理员的邀请，注册不会自动获得公司权限。",
  },
  {
    q: "怎样为我的公司开通？",
    a: "工作区由百杰平台为公司创建，并邀请第一位公司管理员；之后由管理员邀请同事、搭建业务表。目前不提供自助开通。",
  },
  {
    q: "Excel 表格能直接导入吗？",
    a: "可以。支持 .xlsx、.xls 和 CSV，一个工作表最多 10,000 行、40 列，文件 10 MB 以内。导入前会先检查并列出每一行的问题；导入只新增记录，不会覆盖已有记录。",
  },
  {
    q: "员工能看到所有数据吗？",
    a: "由公司管理员决定。每张业务表可以设为全部记录、仅本人负责或无权访问，每个字段可设为可编辑、只读或隐藏，还可以为个别成员单独设置。这些限制由服务端执行。",
  },
  {
    q: "不同公司的数据会混在一起吗？",
    a: "不会。每家公司是独立的工作区，数据在数据库里按公司隔离；平台管理员也不能借平台身份进入公司的业务数据。",
  },
  {
    q: "停用一张业务表，数据会丢吗？",
    a: "不会。停用后员工暂时无法访问这张表，记录、配置和审计记录都保留，公司管理员恢复后照常使用。",
  },
  {
    q: "AI 会自己改数据吗？",
    a: "不会。AI 助手只能提出修改建议，由你确认后才执行；确认时还会重新检查你的权限和记录版本。AI 助手由平台开通后才能使用。",
  },
  {
    q: "会提醒我跟进吗？",
    a: "会在工作区里提醒：联系期限、跟进到期、线索被回收和成交保护复核都会出现在消息里。目前不发送短信或邮件提醒。",
  },
  {
    q: "手机上能用吗？",
    a: "可以在手机浏览器里使用，窄屏下列表会换成卡片。目前没有单独的 App。",
  },
];
