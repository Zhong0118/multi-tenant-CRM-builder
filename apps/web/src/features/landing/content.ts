/* Copy and facts for the public page. Every claim describes the deployed
   release and was checked against the code on main; when behaviour changes,
   change the claim in the same commit. The demo's fictional company and its
   records live in demo/demo-data.ts. */

export const PUBLIC_ORIGIN = "https://crm.baijiehub.com";

export const ICP_RECORD = {
  number: "鲁ICP备2026063095号-1",
  lookup: "https://beian.miit.gov.cn/",
} as const;

export const COMPANY = "山东百杰网络科技有限公司";

export const NAV_LINKS = [
  { href: "#product", label: "产品" },
  { href: "#scenarios", label: "使用场景" },
  { href: "#faq", label: "常见问题" },
] as const;

/* Steps from a new account to working inside a company workspace. */
export const START_STEPS = [
  {
    title: "用手机号创建账号",
    detail: "接收短信验证码，设置登录密码。",
  },
  {
    title: "接受公司管理员的邀请",
    detail:
      "公司工作区由百杰平台开通。管理员邀请你后，你才能看到公司的数据；注册本身不带任何公司权限。",
  },
  {
    title: "进入工作区开始工作",
    detail: "按管理员给你的权限，查看和处理自己负责的客户与待办。",
  },
];

export const FAQ = [
  {
    q: "注册之后怎样加入公司？",
    a: "注册只创建个人账号。公司管理员用你的手机号发出邀请，你登录后接受邀请，就能进入公司的工作区；一个账号可以加入多家公司。",
  },
  {
    q: "怎样为我的公司开通？",
    a: "公司工作区由百杰平台创建，可以从业务模板或空白开始，并邀请第一位公司管理员。之后由管理员邀请同事、调整业务表。目前不提供自助开通。",
  },
  {
    q: "现有的 Excel 能导入吗？",
    a: "可以。支持 .xlsx、.xls 和 CSV，一个工作表最多 10,000 行、40 列，文件 10 MB 以内。导入前逐行检查并标出问题；导入只新增记录，不覆盖已有数据。",
  },
  {
    q: "员工能看到哪些数据？",
    a: "由公司管理员决定：每张业务表可设为全部记录、仅本人负责或无权访问，每个字段可设为可编辑、只读或隐藏，也能为个别成员单独设置。限制在服务端执行，AI 助手同样遵守。",
  },
  {
    q: "不同公司的数据会混在一起吗？",
    a: "不会。每家公司是独立的工作区，数据在数据库层面按公司隔离；平台管理员也不能借平台身份查看公司的业务数据。",
  },
  {
    q: "为什么 AI 改数据要我确认？",
    a: "AI 的理解可能有偏差，所以它只提出修改建议。你确认后，系统会重新检查你的权限和记录是否被别人改过，再写入并留下审计记录；拒绝则什么都不写。AI 助手由平台开通后使用。",
  },
  {
    q: "会通过短信或邮件提醒吗？",
    a: "提醒在工作区的消息里：联系期限、跟进到期、待办逾期、线索被收回和成交保护复核。目前不发短信或邮件。",
  },
  {
    q: "手机上能用吗？",
    a: "可以在手机浏览器里使用，窄屏下列表换成卡片。目前没有单独的 App。",
  },
];
