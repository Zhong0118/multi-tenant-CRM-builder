import Link from "next/link";
import { LandingNav } from "./landing-nav";
import { LogoMark } from "./logo-mark";
import { Phrases } from "./phrases";
import { ProductDemo } from "./product-demo";
import { ProductWindow } from "./product-window";
import styles from "./landing.module.css";

/* The twelve field types an administrator can choose, in the order the
   field editor lists them (FIELD_TYPE_LABELS in features/objects). */
const FIELD_TYPES = [
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

const DESIGNER_FIELDS = [
  { label: "商机名称", type: "文本", note: "必填" },
  { label: "联系电话", type: "电话", note: "" },
  {
    label: "阶段",
    type: "单选",
    note: "初步接触 / 需求确认 / 方案报价 / 商务谈判",
  },
  { label: "金额", type: "金额", note: "元" },
  { label: "预计签约", type: "日期", note: "" },
  { label: "预计毛利", type: "金额", note: "员工：隐藏" },
];

const LIST_TOOLS = [
  {
    term: "筛选与排序",
    detail: "按负责人和字段筛选，常用条件存成“我的筛选”，保存在当前浏览器。",
  },
  {
    term: "列设置",
    detail: "每个人调整自己看到的列和顺序，同样保存在当前浏览器。",
  },
  {
    term: "导入与导出",
    detail:
      "CSV 一次最多导入 500 行；导出当前筛选结果，最多 5000 行，Excel 可直接打开。",
  },
  {
    term: "批量修改",
    detail: "一次勾选最多 50 条记录，统一修改字段或负责人。",
  },
  {
    term: "流程与关联",
    detail:
      "为业务表配置流程状态和可执行的动作；记录之间可以互相关联，也能上传附件。",
  },
  {
    term: "手机浏览器",
    detail: "屏幕变窄时，列表换成卡片，在外面也能查记录、记跟进。",
  },
];

const ADMIN_POINTS = [
  "用手机号邀请同事，也可以上传一份名单，每批最多 100 人。",
  "按业务表决定员工看全部记录还是只看自己负责的；每个字段可设为可编辑、只读或隐藏，隐藏的字段不会出现在列表、详情和表单里。",
  "有人离职时，把他名下的记录和待办一次交接给另一位在职的公司管理员，再停用账号。",
  "记录的新建、修改和导出，以及成员、邀请和权限的变更，都留有审计记录。",
];

const STAFF_POINTS = [
  "打开工作台，就是自己今天到期、已逾期和未来 7 天的跟进。",
  "只看到被授权的业务表和字段，不用在一张大表里找自己的那几行。",
  "跟进可以完成、改期，或转给能查看这条记录的同事。",
  "活动只能追加，每一次沟通都算数，不会被别人的编辑覆盖。",
];

const TEAM_ROWS = [
  { title: "南湖实验学校 新校区教室家具", owner: "周航", margin: "41,000" },
  { title: "城东社区医院 候诊区座椅", owner: "唐悦", margin: "8,900" },
  { title: "启明设计事务所 办公室翻新", owner: "林岚", margin: "22,300" },
  { title: "青禾幼儿园 午休床", owner: "周航", margin: "5,200" },
];

const AI_FLOW = [
  {
    title: "你用中文提问",
    detail: "例如“最近有哪些需要跟进？”“按阶段统计当前商机”。",
  },
  {
    title: "只读取你有权限的数据",
    detail:
      "范围和你在工作区里能看到的一致：没有权限的业务表、记录和隐藏字段都不会读取。",
  },
  {
    title: "回答附带来源",
    detail: "回答下面列出引用的记录，点开就能核对原始数据。",
  },
  {
    title: "要改数据时，先给建议",
    detail: "可以建议更新记录、创建跟进或添加备注，建议显示为“待确认”。",
  },
  {
    title: "你确认后才执行",
    detail:
      "执行前重新检查你的权限和记录版本；记录在此期间被别人改过，就标为冲突，不会覆盖。拒绝或过期的建议不写入任何数据。",
  },
];

const FAQ = [
  {
    q: "现在可以直接注册吗？",
    a: "不可以。百杰 CRM 目前只接受邀请：公司管理员用你的手机号发出邀请后，你再用这个手机号创建账号。没有邀请的手机号无法注册。",
  },
  {
    q: "怎样为我的公司开通？",
    a: "工作区由百杰平台为公司创建，并邀请第一位公司管理员；之后由管理员邀请同事、搭建业务表。目前不提供自助开通。",
  },
  {
    q: "Excel 表格能直接导入吗？",
    a: "先在 Excel 里另存为 CSV 再导入，一次最多 500 行。导入只会新建记录，不会更新已有记录；成员字段不能导入，负责人可以导入后批量指派。",
  },
  {
    q: "员工能看到所有数据吗？",
    a: "由公司管理员决定。每张业务表可以设为全部记录、仅本人负责或无权访问，每个字段可设为可编辑、只读或隐藏，这些限制由服务端执行。",
  },
  {
    q: "AI 会自己改数据吗？",
    a: "不会。AI 助手只能提出修改建议，由你确认后才执行；确认时还会重新检查权限和记录版本。AI 助手需要平台开通后才能使用。",
  },
  {
    q: "会提醒我跟进吗？",
    a: "到期和逾期的跟进会出现在你的工作台上。目前不会主动发送短信、邮件或其他消息提醒。",
  },
  {
    q: "手机上能用吗？",
    a: "可以在手机浏览器里使用，窄屏下列表会换成卡片。目前没有单独的 App。",
  },
];

export function LandingPage() {
  return (
    <div className={styles.page} id="top">
      <a href="#main" className={styles.skip}>
        跳到正文
      </a>
      <LandingNav />

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.container}>
            <div className={styles.heroText}>
              <h1 id="hero-title">
                把分散的表格，
                <br />
                变成团队共同推进的业务
              </h1>
              <div className={styles.heroAside}>
                <p className={styles.lead}>
                  百杰 CRM
                  把客户、商机和跟进放进同一个工作区。每条记录有明确的负责人，每次沟通都留在记录上，让团队知道下一步该做什么。
                </p>
                <div className={styles.heroActions}>
                  <a href="#demo" className={styles.buttonPrimary}>
                    查看产品演示
                  </a>
                  <Link href="/login" className={styles.buttonSecondary}>
                    登录工作区
                  </Link>
                </div>
                <p className={styles.invite}>
                  已收到公司邀请？
                  <Link href="/register">用受邀手机号创建账号</Link>
                </p>
              </div>
            </div>
          </div>
          <div className={styles.heroStage}>
            <div className={styles.container}>
              <ProductWindow />
            </div>
          </div>
        </section>

        <section
          id="demo"
          className={styles.section}
          aria-labelledby="demo-title"
        >
          <div className={styles.container}>
            <header className={styles.sectionHead}>
              <h2 id="demo-title">
                <Phrases text="跟着一笔生意，看表格之外多了什么" />
              </h2>
              <p>
                禾木办公家具是一家虚构的经销商，销售主管林岚手上有一张几个人一起维护的商机表。下面用其中一笔生意，走一遍从导入到问
                AI 的过程。
              </p>
              <p className={styles.demoNote}>
                演示数据均为虚构，所有操作只在本页面生效，不会保存或发送。
              </p>
            </header>
            <ProductDemo />
          </div>
        </section>

        <section
          id="fields"
          className={`${styles.section} ${styles.sectionPaper}`}
          aria-labelledby="fields-title"
        >
          <div className={`${styles.container} ${styles.split}`}>
            <div className={styles.splitText}>
              <h2 id="fields-title">
                <Phrases text="你的业务长什么样，表就怎么建" />
              </h2>
              <p>
                客户、商机、合同、售后工单都是公司管理员自己定义的业务表。字段从
                12
                种类型里选，先在草稿里改好，发布后同事才会用到。已发布字段的类型不能再改，所以可以先在草稿里试。
              </p>
              <ul className={styles.typeList} aria-label="可选字段类型">
                {FIELD_TYPES.map((type) => (
                  <li key={type}>{type}</li>
                ))}
              </ul>
            </div>

            <figure
              className={styles.designer}
              aria-labelledby="designer-caption"
            >
              <div className={styles.designerHead}>
                <strong>商机</strong>
                <span className={styles.draftTag}>草稿 · 未发布</span>
              </div>
              <table className={styles.designerTable}>
                <thead>
                  <tr>
                    <th scope="col">字段</th>
                    <th scope="col">类型</th>
                    <th scope="col">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {DESIGNER_FIELDS.map((field) => (
                    <tr key={field.label}>
                      <td>{field.label}</td>
                      <td>
                        <span className={styles.typeTag}>{field.type}</span>
                      </td>
                      <td>{field.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.designerFoot}>
                <span>6 个字段</span>
                <span className={styles.fakeButton} aria-hidden="true">
                  发布
                </span>
              </div>
              <figcaption id="designer-caption" className={styles.caption}>
                业务表设计示意，字段为虚构示例
              </figcaption>
            </figure>
          </div>

          <div className={styles.container}>
            <dl className={styles.toolGrid}>
              {LIST_TOOLS.map((tool) => (
                <div key={tool.term}>
                  <dt>{tool.term}</dt>
                  <dd>{tool.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          id="team"
          className={styles.section}
          aria-labelledby="team-title"
        >
          <div className={styles.container}>
            <header className={styles.sectionHead}>
              <h2 id="team-title">
                <Phrases text="谁负责、谁能看，事先说清楚" />
              </h2>
              <p>
                同一张商机表，管理员和员工看到的不一样。下面是林岚和周航打开它时各自看到的内容。
              </p>
            </header>

            <div className={styles.lens}>
              <figure className={styles.lensPane} aria-labelledby="lens-admin">
                <figcaption id="lens-admin">
                  <b>林岚</b>
                  <span>公司管理员 · 全部记录</span>
                </figcaption>
                <table className={styles.lensTable}>
                  <thead>
                    <tr>
                      <th scope="col">商机</th>
                      <th scope="col">负责人</th>
                      <th scope="col" className={styles.num}>
                        预计毛利
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {TEAM_ROWS.map((row) => (
                      <tr key={row.title}>
                        <td>{row.title}</td>
                        <td>{row.owner}</td>
                        <td className={styles.num}>{row.margin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </figure>
              <figure className={styles.lensPane} aria-labelledby="lens-staff">
                <figcaption id="lens-staff">
                  <b>周航</b>
                  <span>员工 · 仅本人负责，「预计毛利」隐藏</span>
                </figcaption>
                <table className={styles.lensTable}>
                  <thead>
                    <tr>
                      <th scope="col">商机</th>
                      <th scope="col">负责人</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TEAM_ROWS.filter((row) => row.owner === "周航").map(
                      (row) => (
                        <tr key={row.title}>
                          <td>{row.title}</td>
                          <td>{row.owner}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </figure>
            </div>

            <div className={styles.roles}>
              <section aria-labelledby="role-admin">
                <h3 id="role-admin">管理员得到的</h3>
                <p className={styles.roleLead}>
                  一个地方看清团队手上的生意，而且不必把所有数据都摊给所有人。
                </p>
                <ul>
                  {ADMIN_POINTS.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </section>
              <section aria-labelledby="role-staff">
                <h3 id="role-staff">员工得到的</h3>
                <p className={styles.roleLead}>
                  只面对自己负责的那部分，每天打开就知道先做什么。
                </p>
                <ul>
                  {STAFF_POINTS.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </section>

        <section
          id="ai"
          className={`${styles.section} ${styles.sectionInk}`}
          aria-labelledby="ai-title"
        >
          <div className={`${styles.container} ${styles.aiLayout}`}>
            <header className={styles.aiHead}>
              <h2 id="ai-title">
                <Phrases text="AI 助手读的是你的业务数据，改动由你确认" />
              </h2>
              <p>
                AI
                助手是工作区里的一个页面。它能查询记录、汇总统计、整理跟进，并在需要时提出修改建议。它的权限不会比你大。
              </p>
            </header>
            <ol className={styles.aiFlow}>
              {AI_FLOW.map((step) => (
                <li key={step.title}>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="faq"
          className={styles.section}
          aria-labelledby="faq-title"
        >
          <div className={`${styles.container} ${styles.faqLayout}`}>
            <h2 id="faq-title">常见问题</h2>
            <div className={styles.faq}>
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <div className={`${styles.container} ${styles.closingInner}`}>
            <div className={styles.closingCopy}>
              <h2 id="closing-title">
                <Phrases text="让下一步，真正推进下去" />
              </h2>
              <p>回到团队的工作区，把今天的沟通接成明天的进展。</p>
            </div>
            <div className={styles.closingActions}>
              <Link href="/login" className={styles.buttonPrimary}>
                登录工作区
              </Link>
              <Link href="/register" className={styles.buttonSecondary}>
                受邀加入团队
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <div className={styles.footerIntro}>
            <a
              href="#top"
              className={styles.footerBrand}
              aria-label="百杰 CRM，回到顶部"
            >
              <LogoMark className={styles.brandMark} />
              <span>百杰 CRM</span>
            </a>
            <p>业务信息有归处，团队协作有下一步。</p>
            <span className={styles.footerSignature}>百杰出品</span>
          </div>
          <nav className={styles.footerNav} aria-label="页脚产品导航">
            <h3>了解产品</h3>
            <a href="#demo">业务过程</a>
            <a href="#fields">灵活字段</a>
            <a href="#team">团队协作</a>
            <a href="#ai">AI 助手</a>
          </nav>
          <nav className={styles.footerNav} aria-label="页脚工作区入口">
            <h3>开始协作</h3>
            <Link href="/login">登录工作区</Link>
            <Link href="/register">受邀加入团队</Link>
            <a href="#faq">常见问题</a>
          </nav>
        </div>
        <div className={`${styles.container} ${styles.footerBottom}`}>
          <small>© {new Date().getFullYear()} 山东百杰网络科技有限公司</small>
          <a href="#top" className={styles.backToTop}>
            回到顶部
            <svg
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M10 16V4m-5 5 5-5 5 5" />
            </svg>
          </a>
        </div>
      </footer>
    </div>
  );
}
