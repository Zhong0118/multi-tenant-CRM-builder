import Link from "next/link";

import { COMPANY, FAQ, ICP_RECORD, NAV_LINKS, START_STEPS } from "./content";
import { ProductDemo } from "./demo/product-demo";
import { LandingNav } from "./landing-nav";
import { LogoMark } from "./logo-mark";
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
    <div className={styles.page} id="top">
      <a href="#main" className={styles.skip}>
        跳到正文
      </a>
      <LandingNav />

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`${styles.container} ${styles.heroBand}`}>
            <h1 id="hero-title">
              <Phrases text="按你的业务搭建 CRM，" />
              <Phrases text="让每位客户都有人跟进" />
            </h1>
            <div className={styles.heroAside}>
              <p className={styles.lead}>
                业务表、字段和权限由管理员自己配置；线索在公海里领取、限时联系，跟进和任务按时提醒，团队进展直接看系统记录。
              </p>
              <div className={styles.heroActions}>
                <Link href="/register" className={styles.buttonPrimary}>
                  创建账号
                </Link>
                <Link href="/login" className={styles.buttonSecondary}>
                  登录工作区
                </Link>
              </div>
            </div>
          </div>

          <div
            id="scenarios"
            className={`${styles.container} ${styles.demoWrap}`}
            aria-label="产品演示"
            role="region"
          >
            <ProductDemo />
          </div>
        </section>

        <section
          id="product"
          className={styles.section}
          aria-labelledby="product-title"
        >
          <div className={styles.container}>
            <header className={styles.sectionHead}>
              <h2 id="product-title">
                <Phrases text="一套 CRM，按你的业务来配" />
              </h2>
              <p>
                不用把业务硬塞进一张固定的客户表。表怎么建、谁能看什么、线索怎么流转，都由你们决定。
              </p>
            </header>

            <div className={styles.features}>
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
          id="start"
          className={`${styles.section} ${styles.sectionBand}`}
          aria-labelledby="start-title"
        >
          <div className={`${styles.container} ${styles.start}`}>
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
      </main>

      <footer className={styles.footer}>
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
  );
}
