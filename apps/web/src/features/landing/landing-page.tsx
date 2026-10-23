import Link from "next/link";

import { AiDemo } from "./ai-demo";
import {
  ACCESS_POINTS,
  COMPANY,
  DAILY_POINTS,
  DATA_POINTS,
  FAQ,
  FIELD_TYPES,
  FLOW_POINTS,
  ICP_RECORD,
  ROADMAP,
  TABLE_POINTS,
} from "./content";
import { HeroWorkspace } from "./hero-workspace";
import { LandingNav } from "./landing-nav";
import { LogoMark } from "./logo-mark";
import { Phrases } from "./phrases";
import { PoolJourney } from "./pool-journey";
import { RevealObserver } from "./reveal";
import { TableDesigner } from "./table-designer";
import styles from "./landing.module.css";

const ROOT_ID = "top";

const ACCESS_ROWS = [
  { name: "南湖实验学校 新校区教室家具", owner: "周航", margin: "41,000" },
  { name: "城东社区医院 候诊区座椅", owner: "唐悦", margin: "8,900" },
  { name: "启明设计事务所 办公室翻新", owner: "林岚", margin: "22,300" },
  { name: "青禾幼儿园 午休床", owner: "周航", margin: "5,200" },
];

const WORKBENCH = [
  {
    title: "今天",
    items: [
      { time: "16:00", text: "南湖实验学校 · 确认报价单" },
      { time: "17:30", text: "城东社区医院 · 回访样品意见" },
    ],
  },
  {
    title: "已逾期",
    tone: "amber",
    items: [{ time: "2 天", text: "滨江职业学校 · 补发合同盖章页" }],
  },
  {
    title: "未来 7 天",
    items: [
      { time: "周五", text: "启明设计事务所 · 上门量尺" },
      { time: "下周一", text: "青禾幼儿园 · 送样" },
    ],
  },
];

const NOTICES = [
  "联系期限还剩 2 小时：北岸物业服务中心",
  "跟进到期：南湖实验学校 新校区教室家具",
  "超过 24 小时未联系，已收回线索池：青禾幼儿园",
  "成交保护待复核：启明设计事务所",
];

const FLOW = ["需求确认", "方案报价", "商务谈判", "赢单"];

export function LandingPage() {
  return (
    <div className={styles.page} id={ROOT_ID}>
      <a href="#main" className={styles.skip}>
        跳到正文
      </a>
      <LandingNav />
      <RevealObserver rootId={ROOT_ID} />

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`${styles.container} ${styles.heroBand}`}>
            <h1 id="hero-title">
              <Phrases text="线索有人领，跟进有期限，" />
              <br />
              <Phrases text="表格按你的业务来搭" />
            </h1>
            <div className={styles.heroAside}>
              <p className={styles.lead}>
                百杰 CRM
                是给中小团队用的客户管理工作区。管理员自己搭业务表和权限；线索放进公海，同事领取、联系、跟进，到期没推进的自动收回。
              </p>
              <div className={styles.heroActions}>
                <Link href="/login" className={styles.buttonPrimary}>
                  登录工作区
                </Link>
                <Link href="/register" className={styles.buttonSecondary}>
                  用手机号创建账号
                </Link>
              </div>
            </div>
          </div>
          <div className={`${styles.container} ${styles.heroStage}`}>
            <p className={styles.heroHint}>
              <span aria-hidden="true">↓</span> 在这张表里点“领取”
            </p>
            <HeroWorkspace />
          </div>
        </section>

        <section
          id="tables"
          className={styles.section}
          aria-labelledby="tables-title"
        >
          <div className={styles.container}>
            <header className={styles.sectionHead} data-reveal>
              <p className={styles.kicker}>搭表</p>
              <h2 id="tables-title">
                <Phrases text="表怎么建，由你的业务决定" />
              </h2>
              <p>
                客户、商机、合同、回款，每家公司的表都不一样。管理员在草稿里加字段、调列表、设权限，确认无误再发布给同事。
              </p>
            </header>
            <div data-reveal>
              <TableDesigner />
            </div>
            <div className={styles.splitPoints} data-reveal>
              <dl className={styles.points}>
                {TABLE_POINTS.map((point) => (
                  <div key={point.term}>
                    <dt>{point.term}</dt>
                    <dd>{point.detail}</dd>
                  </div>
                ))}
              </dl>
              <div className={styles.fieldTypes}>
                <p>{FIELD_TYPES.length} 种字段</p>
                <ul>
                  {FIELD_TYPES.map((type) => (
                    <li key={type}>{type}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section
          id="pool"
          className={`${styles.section} ${styles.sectionPaper}`}
          aria-labelledby="pool-title"
        >
          <div className={styles.container}>
            <header className={styles.sectionHead} data-reveal>
              <p className={styles.kicker}>线索公海</p>
              <h2 id="pool-title">
                <Phrases text="每条线索，都知道谁在跟、还剩多久" />
              </h2>
              <p>
                公海里的线索分四个阶段，每个阶段都有负责人和期限。期限内没有推进，就回到线索池，换别人接着跟。期限按业务表设置，下面是默认值。
              </p>
            </header>
            <PoolJourney />
          </div>
        </section>

        <section
          id="data"
          className={styles.section}
          aria-labelledby="data-title"
        >
          <div className={styles.container}>
            <header className={styles.sectionHead} data-reveal>
              <p className={styles.kicker}>数据与流程</p>
              <h2 id="data-title">
                <Phrases text="旧表格搬得进来，流程走得下去" />
              </h2>
            </header>
            <div className={styles.twoCol}>
              <div data-reveal>
                <h3 className={styles.colTitle}>数据进出</h3>
                <dl className={styles.points}>
                  {DATA_POINTS.map((point) => (
                    <div key={point.term}>
                      <dt>{point.term}</dt>
                      <dd>{point.detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div data-reveal>
                <h3 className={styles.colTitle}>流程</h3>
                <figure className={styles.flow}>
                  <figcaption>商机 · 阶段</figcaption>
                  <ol>
                    {FLOW.map((step, index) => (
                      <li
                        key={step}
                        data-current={index === FLOW.length - 1 || undefined}
                      >
                        {step}
                      </li>
                    ))}
                  </ol>
                  <p className={styles.flowEffect}>
                    <span aria-hidden="true">↳</span>
                    这家公司配置了：推进到“赢单”时，在合同表新建一条记录并与商机关联，再创建一条“准备合同”的跟进。
                  </p>
                </figure>
                <ul className={styles.plainList}>
                  {FLOW_POINTS.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section
          id="access"
          className={`${styles.section} ${styles.sectionPaper}`}
          aria-labelledby="access-title"
        >
          <div className={styles.container}>
            <header className={styles.sectionHead} data-reveal>
              <p className={styles.kicker}>权限</p>
              <h2 id="access-title">
                <Phrases text="同一张表，每个人看到该看的" />
              </h2>
              <p>
                商机表设为“仅本人负责”，预计毛利对员工隐藏。同一时刻，公司管理员和销售周航看到的是这样：
              </p>
            </header>
            <div className={styles.accessViews} data-reveal>
              <figure>
                <figcaption>公司管理员 · 全部记录</figcaption>
                <table className={styles.miniTable}>
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
                    {ACCESS_ROWS.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{row.owner}</td>
                        <td className={styles.num}>{row.margin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </figure>
              <figure>
                <figcaption>销售 周航 · 仅本人负责</figcaption>
                <table className={styles.miniTable}>
                  <thead>
                    <tr>
                      <th scope="col">商机</th>
                      <th scope="col">负责人</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ACCESS_ROWS.filter((row) => row.owner === "周航").map(
                      (row) => (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{row.owner}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
                <p className={styles.previewFoot}>
                  另外 2 条不在列表里，预计毛利这一列不出现，AI 助手也读不到。
                </p>
              </figure>
            </div>
            <ul className={`${styles.plainList} ${styles.columns}`} data-reveal>
              {ACCESS_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="daily"
          className={styles.section}
          aria-labelledby="daily-title"
        >
          <div className={styles.container}>
            <header className={styles.sectionHead} data-reveal>
              <p className={styles.kicker}>每天</p>
              <h2 id="daily-title">
                <Phrases text="每天打开，先看到今天要做的事" />
              </h2>
            </header>
            <div className={styles.daily} data-reveal>
              <div className={styles.workbench}>
                {WORKBENCH.map((group) => (
                  <div key={group.title} data-tone={group.tone}>
                    <h3>
                      {group.title} <b>{group.items.length}</b>
                    </h3>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.text}>
                          <span className={styles.when}>{item.time}</span>
                          <span>{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className={styles.notices}>
                <h3>消息</h3>
                <ul>
                  {NOTICES.map((notice) => (
                    <li key={notice}>{notice}</li>
                  ))}
                </ul>
              </div>
            </div>
            <dl className={`${styles.points} ${styles.pointsRow}`} data-reveal>
              {DAILY_POINTS.map((point) => (
                <div key={point.term}>
                  <dt>{point.term}</dt>
                  <dd>{point.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          id="ai"
          className={`${styles.section} ${styles.sectionDark}`}
          aria-labelledby="ai-title"
        >
          <div className={`${styles.container} ${styles.aiLayout}`}>
            <header className={styles.sectionHead} data-reveal>
              <p className={styles.kicker}>AI 助手</p>
              <h2 id="ai-title">
                <Phrases text="会回答，要改数据时先问你" />
              </h2>
              <ul className={styles.plainList}>
                <li>
                  用中文提问。范围和你在工作区里能看到的一致，没有权限的表、记录和隐藏字段都不会读取。
                </li>
                <li>回答下面列出引用的记录，点开就能核对。</li>
                <li>
                  需要新建或修改时，只给出待确认的建议。你确认后，系统重新检查权限和记录版本再执行；记录在此期间被别人改过，就不会覆盖。
                </li>
                <li>AI 助手由平台开通后才能使用。</li>
              </ul>
            </header>
            <div data-reveal>
              <AiDemo />
            </div>
          </div>
        </section>

        <section
          id="roadmap"
          className={styles.section}
          aria-labelledby="roadmap-title"
        >
          <div className={`${styles.container} ${styles.roadmap}`}>
            <header className={styles.sectionHead} data-reveal>
              <p className={styles.kicker}>正在路上</p>
              <h2 id="roadmap-title">尚未上线的功能</h2>
              <p>下面这些正在开发和测试，上线前不会出现在你的工作区里。</p>
            </header>
            <ul data-reveal>
              {ROADMAP.map((item) => (
                <li key={item.name}>
                  <span className={styles.tag} data-tone="muted">
                    尚未上线
                  </span>
                  <h3>{item.name}</h3>
                  <p>{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="faq"
          className={`${styles.section} ${styles.sectionPaper}`}
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
            <div>
              <h2 id="closing-title">
                <Phrases text="已经收到邀请？登录就能开始" />
              </h2>
              <p>
                还没有账号，先用手机号创建；公司管理员邀请你之后，就能进入公司的工作区。
              </p>
            </div>
            <div className={styles.closingActions}>
              <Link href="/login" className={styles.buttonPrimary}>
                登录工作区
              </Link>
              <Link href="/register" className={styles.buttonOnDark}>
                创建账号
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
            <p>业务表自己搭，线索有人领，跟进有期限。</p>
          </div>
          <nav className={styles.footerNav} aria-label="页脚产品导航">
            <h3>了解产品</h3>
            <a href="#tables">搭表</a>
            <a href="#pool">线索公海</a>
            <a href="#data">数据与流程</a>
            <a href="#access">权限</a>
            <a href="#ai">AI 助手</a>
          </nav>
          <nav className={styles.footerNav} aria-label="页脚工作区入口">
            <h3>开始使用</h3>
            <Link href="/login">登录工作区</Link>
            <Link href="/register">创建账号</Link>
            <a href="#faq">常见问题</a>
          </nav>
        </div>
        <div className={`${styles.container} ${styles.footerBottom}`}>
          <small>
            © {new Date().getFullYear()} {COMPANY}
          </small>
          <a
            href={ICP_RECORD.lookup}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.icp}
          >
            {ICP_RECORD.number}
          </a>
        </div>
      </footer>
    </div>
  );
}
