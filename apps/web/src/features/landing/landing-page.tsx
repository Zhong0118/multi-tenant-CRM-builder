import Link from "next/link";

import { COMPANY, FAQ, ICP_RECORD, NAV_LINKS, START_STEPS } from "./content";
import { ProductDemo } from "./demo/product-demo";
import { LandingNav } from "./landing-nav";
import { LogoMark } from "./logo-mark";
import { LandingMotion } from "./landing-motion";
import { RecordJourney } from "./record-journey";
import {
  ArrowRightOutlined,
  CheckOutlined,
  LockOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "./landing-icons";
import { Phrases } from "./phrases";
import styles from "./landing.module.css";

const EXTRAS = [
  "首页仪表盘",
  "导入与导出",
  "附件",
  "任务与日报",
  "离职交接",
  "审计记录",
];

export function LandingPage() {
  return (
    <LandingMotion>
      <div className={styles.page} id="top">
        <a href="#main" className={styles.skip}>
          跳到正文
        </a>
        <LandingNav />

        <main id="main">
          <section className={styles.hero} aria-labelledby="hero-title">
            <div className={`${styles.container} ${styles.heroBand}`}>
              <div className={styles.heroEyebrow} data-hero-enter>
                <span /> 为团队搭建的业务协作 CRM
              </div>
              <h1 id="hero-title" data-hero-enter>
                把分散的表格
                <br />
                <span className={styles.heroAccent}>连成团队的生意</span>
              </h1>
              <p className={styles.lead} data-hero-enter>
                从一份客户名单，到一次成交
                <br className={styles.mobileBreak} />
                让数据、跟进与协作，在同一个工作区里发生
              </p>
              <div className={styles.heroActions} data-hero-enter>
                <Link href="/register" className={styles.buttonPrimary}>
                  创建账号 <ArrowRightOutlined />
                </Link>
                <a href="#scenarios" className={styles.buttonSecondary}>
                  体验产品 <ArrowRightOutlined />
                </a>
              </div>
              <div className={styles.heroProof} data-hero-enter>
                <span>
                  <CheckOutlined /> 业务表自由配置
                </span>
                <span>
                  <CheckOutlined /> 公海与跟进闭环
                </span>
                <span>
                  <CheckOutlined /> 权限细到每一列
                </span>
              </div>
              <div
                className={styles.flowRibbon}
                aria-hidden="true"
                data-hero-enter
              >
                <span>客户名单.xlsx</span>
                <i />
                <span>客户档案</span>
                <i />
                <span>跟进与询单</span>
                <i />
                <span>合同与回款</span>
              </div>
            </div>

            <div
              id="scenarios"
              className={`${styles.container} ${styles.demoWrap}`}
              aria-label="产品演示"
              role="region"
            >
              <div className={styles.demoHeading}>
                <span>你的业务，打开就能看懂</span>
                <small>选择一个场景，试着操作</small>
              </div>
              <ProductDemo />
            </div>
          </section>

          <RecordJourney />

          <section
            id="product"
            className={styles.section}
            aria-labelledby="product-title"
          >
            <div className={styles.container}>
              <header className={styles.sectionHead} data-reveal>
                <h2 id="product-title">
                  <Phrases text="一套 CRM，按你的业务来配" />
                </h2>
                <p>
                  不用把业务硬塞进一张固定的客户表。表怎么建、谁能看什么、线索怎么流转，都由你们决定。
                </p>
              </header>

              <div className={styles.features} data-reveal>
                <article className={`${styles.feature} ${styles.featureWide}`}>
                  <div className={styles.featureText}>
                    <h3>业务表按需搭建</h3>
                    <p>
                      客户、商机、合同、回款……字段、选项、列表和流程状态都由管理员在草稿里调整，发布后同事才用到。可以从业务模板开始；不再用的字段和表停用即可，数据保留。
                    </p>
                  </div>
                  <figure className={styles.visual} aria-hidden="true">
                    <div className={styles.visualHead}>
                      <b>商机</b>
                      <span className={styles.pill} data-tone="warn">
                        草稿 · 1 处待发布
                      </span>
                    </div>
                    <ul className={styles.fields}>
                      <li>
                        商机名称<span>文本</span>
                      </li>
                      <li>
                        阶段<span>单选</span>
                      </li>
                      <li>
                        金额<span>金额</span>
                      </li>
                      <li data-new>
                        预计签约<span>日期</span>
                      </li>
                    </ul>
                    <p className={styles.visualFoot}>
                      12 种字段：文本、电话、金额、日期、单选、多选、成员……
                    </p>
                  </figure>
                </article>

                <article className={styles.feature}>
                  <div className={styles.featureText}>
                    <h3>权限到表、记录和字段</h3>
                    <p>
                      每张表可设为全部记录、仅本人负责或无权访问；每个字段可编辑、只读或隐藏。限制在服务端执行，AI
                      助手同样遵守。
                    </p>
                  </div>
                  <figure className={styles.visual} aria-hidden="true">
                    <table className={styles.permTable}>
                      <thead>
                        <tr>
                          <th />
                          <th>管理员</th>
                          <th>销售</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th>商机记录</th>
                          <td>全部</td>
                          <td>仅本人负责</td>
                        </tr>
                        <tr>
                          <th>金额</th>
                          <td>可编辑</td>
                          <td>只读</td>
                        </tr>
                        <tr>
                          <th>预计毛利</th>
                          <td>可编辑</td>
                          <td data-off>隐藏</td>
                        </tr>
                      </tbody>
                    </table>
                  </figure>
                </article>

                <article className={styles.feature}>
                  <div className={styles.featureText}>
                    <h3>公海与负责人</h3>
                    <p>
                      每条线索都有负责人和期限。领取后限时联系，接通或加上微信才算联系成功；到期没推进，自动回到线索池。
                    </p>
                  </div>
                  <figure className={styles.visual} aria-hidden="true">
                    <ol className={styles.stages}>
                      <li>
                        线索池<span>领取或分配</span>
                      </li>
                      <li>
                        待联系<span>默认 24 小时</span>
                      </li>
                      <li>
                        跟进中<span>默认 30 天，沟通后顺延</span>
                      </li>
                      <li data-tone="ok">
                        成交保护<span>不再自动回收</span>
                      </li>
                    </ol>
                  </figure>
                </article>

                <article className={`${styles.feature} ${styles.featureWide}`}>
                  <div className={styles.featureText}>
                    <h3>跨表关联与自动化</h3>
                    <p>
                      记录之间互相关联。商机的阶段变为“赢单”时，可以自动在合同表新建一条记录并关联；也可以做成按钮，先预览、补填，再由有权限的人确认执行。
                    </p>
                  </div>
                  <figure className={styles.visual} aria-hidden="true">
                    <div className={styles.flow}>
                      <div className={styles.flowNode}>
                        <small>商机</small>
                        <b>南湖实验学校</b>
                        <span className={styles.pill} data-tone="ok">
                          阶段 → 赢单
                        </span>
                      </div>
                      <span className={styles.flowArrow}>新建并关联</span>
                      <div className={styles.flowNode}>
                        <small>合同</small>
                        <b>南湖实验学校</b>
                        <span className={styles.pill}>负责人：周航</span>
                      </div>
                    </div>
                  </figure>
                </article>
              </div>

              <p className={styles.extras}>
                <span>还包括</span>
                {EXTRAS.map((item) => (
                  <span key={item} className={styles.extra}>
                    {item}
                  </span>
                ))}
              </p>
            </div>
          </section>

          <section
            className={`${styles.section} ${styles.teamSection}`}
            aria-labelledby="team-title"
          >
            <div className={`${styles.container} ${styles.teamLayout}`}>
              <div data-reveal>
                <span className={styles.eyebrow}>
                  <TeamOutlined /> 让团队各有重点，也彼此看见
                </span>
                <h2 id="team-title">
                  员工知道下一步
                  <br />
                  管理员看清全局
                </h2>
                <p>
                  客户归谁、今天做什么、进展到哪里，都落在具体记录上。减少反复问询，把时间留给真正需要推进的事。
                </p>
                <ul className={styles.checkList}>
                  <li>
                    <CheckOutlined /> 员工查看自己的客户、跟进与任务
                  </li>
                  <li>
                    <CheckOutlined /> 管理员分配任务，查看实际工作记录
                  </li>
                  <li>
                    <CheckOutlined /> 到期、逾期和回收，在站内消息中提醒
                  </li>
                </ul>
              </div>
              <div className={styles.teamVisual} data-reveal>
                <div className={styles.teamVisualHead}>
                  <span>周航的工作台</span>
                  <span className={styles.personAvatar}>周</span>
                </div>
                <h3>把今天，安排得明明白白</h3>
                <div className={styles.taskRow}>
                  <span className={styles.taskCheck}>
                    <CheckOutlined />
                  </span>
                  <div>
                    <b>确认南湖实验学校采购数量</b>
                    <span>已完成 · 电话已接通</span>
                  </div>
                  <span>09:30</span>
                </div>
                <div className={styles.taskRow}>
                  <span className={styles.taskDot} />
                  <div>
                    <b>给城东社区医院发正式报价</b>
                    <span>待跟进 · 关联客户档案</span>
                  </div>
                  <span>14:00</span>
                </div>
                <div className={styles.taskRow}>
                  <span className={styles.taskDot} />
                  <div>
                    <b>整理本周跟进与工作结果</b>
                    <span>工作日报 · 记录今日进展</span>
                  </div>
                  <span>17:30</span>
                </div>
                <div className={styles.teamNote}>
                  <span className={styles.personAvatar}>林</span>
                  <span>
                    林岚分配了新的任务
                    <br />
                    <small>报价确认后，安排下周上门送样</small>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section
            className={`${styles.section} ${styles.aiSection}`}
            aria-labelledby="ai-title"
          >
            <div className={`${styles.container} ${styles.aiLayout}`}>
              <div className={styles.aiVisual} data-reveal>
                <div className={styles.aiVisualLabel}>
                  <ThunderboltOutlined /> AI 助手
                </div>
                <div className={styles.aiQuestion}>
                  南湖实验学校跟进到哪一步了？
                </div>
                <div className={styles.aiAnswer}>
                  <span className={styles.aiMark}>
                    <ThunderboltOutlined />
                  </span>
                  <div>
                    <p>
                      已成功联系，正在确认采购报价。负责人是周航，业务进度为
                      <strong>询单中</strong>。
                    </p>
                    <div className={styles.aiSource}>
                      <span>客户 · 南湖实验学校</span>
                      <span>
                        已读取 <CheckOutlined />
                      </span>
                    </div>
                    <p>可以接着安排下一步跟进，或查看这条客户的完整记录。</p>
                  </div>
                </div>
                <div className={styles.aiInput}>
                  继续问业务问题
                  <span>
                    <ArrowRightOutlined />
                  </span>
                </div>
              </div>
              <div data-reveal>
                <span className={styles.eyebrow}>
                  <ThunderboltOutlined /> 让系统里的记录，回答你的问题
                </span>
                <h2 id="ai-title">
                  用一句话
                  <br />
                  找到业务的下一步
                </h2>
                <p>
                  查客户、看跟进、汇总业务数据。AI
                  根据你有权访问的记录回答，并保留来源入口；涉及改动时，先预览，再由你确认。
                </p>
                <div className={styles.aiPermission}>
                  <LockOutlined />
                  <div>
                    <b>和你拥有同样的数据权限</b>
                    <span>看不到的记录和字段，AI 也不能越权读取</span>
                  </div>
                </div>
                <a href="#scenarios" className={styles.textLink}>
                  试试上方的 AI 问答场景 <ArrowRightOutlined />
                </a>
              </div>
            </div>
          </section>

          <section
            id="start"
            className={`${styles.section} ${styles.sectionBand}`}
            aria-labelledby="start-title"
          >
            <div className={`${styles.container} ${styles.start}`} data-reveal>
              <header>
                <h2 id="start-title">从注册到开始工作</h2>
                <div className={styles.startActions}>
                  <Link href="/register" className={styles.buttonPrimary}>
                    创建账号
                  </Link>
                  <Link href="/login" className={styles.buttonSecondary}>
                    登录工作区
                  </Link>
                </div>
              </header>
              <ol className={styles.steps}>
                {START_STEPS.map((step, index) => (
                  <li key={step.title}>
                    <span className={styles.stepNo} aria-hidden="true">
                      {index + 1}
                    </span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.detail}</p>
                    </div>
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
            <div
              className={`${styles.container} ${styles.faqLayout}`}
              data-reveal
            >
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
        </main>

        <footer className={styles.footer}>
          <div
            className={`${styles.container} ${styles.footerCta}`}
            data-reveal
          >
            <div>
              <span>从下一条客户记录开始</span>
              <h2>
                让每一次跟进
                <br />
                都有下文
              </h2>
            </div>
            <div>
              <Link href="/register" className={styles.buttonPrimary}>
                创建账号 <ArrowRightOutlined />
              </Link>
              <Link href="/login" className={styles.footerLogin}>
                已有账号？登录工作区 <ArrowRightOutlined />
              </Link>
            </div>
          </div>
          <div className={`${styles.container} ${styles.footerTop}`}>
            <a
              href="#top"
              className={styles.footerBrand}
              aria-label="百杰 CRM，回到顶部"
            >
              <LogoMark className={styles.brandMark} />
              <span>百杰 CRM</span>
            </a>
            <nav className={styles.footerNav} aria-label="页脚导航">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
              <Link href="/login">登录</Link>
              <Link href="/register">创建账号</Link>
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
    </LandingMotion>
  );
}
