import styles from "./landing.module.css";

/* Fictional data for the hero picture. The names, schools and amounts are
   made up; the screen layout follows the real record list and drawer. */
const DEALS = [
  {
    title: "南湖实验学校 新校区教室家具",
    stage: "方案报价",
    amount: "186,000",
    owner: "周航",
    next: "今天 16:00 确认报价单",
    overdue: false,
    active: true,
  },
  {
    title: "城东社区医院 候诊区座椅",
    stage: "需求确认",
    amount: "42,500",
    owner: "唐悦",
    next: "已逾期 1 天 · 回电确认数量",
    overdue: true,
    active: false,
  },
  {
    title: "启明设计事务所 办公室翻新",
    stage: "商务谈判",
    amount: "97,800",
    owner: "林岚",
    next: "10月10日 上门复尺",
    overdue: false,
    active: false,
  },
  {
    title: "青禾幼儿园 午休床",
    stage: "初步接触",
    amount: "23,600",
    owner: "周航",
    next: "10月12日 寄送样品",
    overdue: false,
    active: false,
  },
] as const;

export function ProductWindow() {
  return (
    <figure className={styles.window} aria-labelledby="hero-window-caption">
      <div className={styles.windowBar} aria-hidden="true">
        <span />
        <span />
        <span />
        <em>禾木办公家具 · 商机</em>
      </div>
      <div className={styles.windowBody} aria-hidden="true">
        <aside className={styles.windowSide}>
          <b>禾木办公家具</b>
          <ul>
            <li>工作台</li>
            <li>客户</li>
            <li data-active>商机</li>
            <li>合同</li>
            <li>统计</li>
            <li>AI 助手</li>
          </ul>
        </aside>
        <div className={styles.windowMain}>
          <div className={styles.windowToolbar}>
            <strong>商机</strong>
            <span className={styles.chip}>负责人：全部</span>
            <span className={styles.chip}>阶段：进行中</span>
            <span className={styles.windowCount}>共 4 条</span>
          </div>
          <table className={styles.windowTable}>
            <thead>
              <tr>
                <th>商机名称</th>
                <th>阶段</th>
                <th className={styles.num}>金额（元）</th>
                <th>负责人</th>
                <th>下一步跟进</th>
              </tr>
            </thead>
            <tbody>
              {DEALS.map((deal) => (
                <tr key={deal.title} data-active={deal.active || undefined}>
                  <td>{deal.title}</td>
                  <td>
                    <span className={styles.stage}>{deal.stage}</span>
                  </td>
                  <td className={styles.num}>{deal.amount}</td>
                  <td>{deal.owner}</td>
                  <td data-overdue={deal.overdue || undefined}>{deal.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={styles.windowCards}>
            {DEALS.slice(0, 3).map((deal) => (
              <li key={deal.title} data-active={deal.active || undefined}>
                <b>{deal.title}</b>
                <span>
                  {deal.stage} · ¥{deal.amount} · {deal.owner}
                </span>
                <em data-overdue={deal.overdue || undefined}>{deal.next}</em>
              </li>
            ))}
          </ul>
        </div>
        <section className={styles.windowDrawer}>
          <small>商机详情</small>
          <h3>南湖实验学校 新校区教室家具</h3>
          <dl>
            <div>
              <dt>负责人</dt>
              <dd>周航</dd>
            </div>
            <div>
              <dt>金额</dt>
              <dd>¥186,000</dd>
            </div>
          </dl>
          <div className={styles.drawerNext}>
            <small>下一步跟进</small>
            <p>确认报价单</p>
            <span>今天 16:00</span>
          </div>
          <small>活动历史</small>
          <ol className={styles.drawerTimeline}>
            <li>
              <b>电话</b> 后勤处王老师要求 3 种桌椅样式，下周看样。
              <span>周航 · 昨天 14:20</span>
            </li>
            <li>
              <b>拜访</b> 现场量了 24 间教室，记录在附件里。
              <span>周航 · 10月3日</span>
            </li>
          </ol>
        </section>
      </div>
      <figcaption id="hero-window-caption" className={styles.caption}>
        演示画面，公司与数据均为虚构
      </figcaption>
    </figure>
  );
}
