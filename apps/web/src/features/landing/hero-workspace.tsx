"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./landing.module.css";

/* A working 客户 table with the staged pool, on fictional data. Claiming a
   lead does what the product does: the lead leaves 线索池, joins 待联系 and
   its 24-hour contact deadline starts. Nothing leaves the browser. */

interface Lead {
  name: string;
  source: string;
  intent: "高" | "中" | "低";
  pooledAt: string;
  note: string;
}

const LEADS: Lead[] = [
  {
    name: "南湖实验学校",
    source: "官网表单",
    intent: "高",
    pooledAt: "今天 09:12",
    note: "新校区开学前要补 40 套课桌椅，希望先看样品和报价。",
  },
  {
    name: "城东社区医院",
    source: "转介绍",
    intent: "中",
    pooledAt: "昨天 16:40",
    note: "候诊区要换 60 个排椅，院办王主任推荐过来的。",
  },
  {
    name: "启明设计事务所",
    source: "展会",
    intent: "中",
    pooledAt: "昨天 11:05",
    note: "办公室翻新，展会上留了名片，想要升降桌方案。",
  },
  {
    name: "青禾幼儿园",
    source: "电话咨询",
    intent: "低",
    pooledAt: "10月20日",
    note: "打电话问午休床的材质和交货周期。",
  },
  {
    name: "北岸物业服务中心",
    source: "官网表单",
    intent: "中",
    pooledAt: "10月19日",
    note: "物业中心搬迁，前台和会议室家具都要配。",
  },
];

const CONTACT_WINDOW_SECONDS = 24 * 60 * 60;

function remaining(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function HeroWorkspace() {
  const [pool, setPool] = useState(LEADS);
  const [claimed, setClaimed] = useState<Lead[]>([]);
  const [leaving, setLeaving] = useState<string>();
  const [selected, setSelected] = useState<Lead>(LEADS[0]);
  const [left, setLeft] = useState(CONTACT_WINDOW_SECONDS);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const isClaimed = claimed.some((lead) => lead.name === selected.name);

  useEffect(() => {
    if (!claimed.length) return;
    timer.current = window.setInterval(
      () => setLeft((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer.current);
  }, [claimed.length]);

  function claim(lead: Lead) {
    if (leaving) return;
    setLeaving(lead.name);
    setSelected(lead);
    const settle = () => {
      setPool((rows) => rows.filter((row) => row.name !== lead.name));
      setClaimed((rows) => [lead, ...rows]);
      setLeft(CONTACT_WINDOW_SECONDS);
      setLeaving(undefined);
      setAnnouncement(`已领取${lead.name}，进入待联系，联系期限 24 小时。`);
    };
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) settle();
    else window.setTimeout(settle, 380);
  }

  function reset() {
    setPool(LEADS);
    setClaimed([]);
    setSelected(LEADS[0]);
    setLeft(CONTACT_WINDOW_SECONDS);
    setAnnouncement("演示已恢复到初始状态。");
  }

  return (
    <div className={styles.workspace}>
      <aside className={styles.wsSide} aria-label="工作区导航">
        <p className={styles.wsCompany}>禾木办公家具</p>
        <p className={styles.wsItem}>工作台</p>
        <p className={styles.wsItem}>跟进待办</p>
        <p className={styles.wsGroup}>业务数据</p>
        <p className={styles.wsItem} data-current>
          客户
        </p>
        <p className={styles.wsItem}>商机</p>
        <p className={styles.wsItem}>合同</p>
        <p className={styles.wsItem}>回款</p>
      </aside>

      <section className={styles.wsMain} aria-label="客户 · 线索池">
        <div className={styles.wsHead}>
          <h3>客户</h3>
          <span className={styles.wsCount}>{128}</span>
        </div>
        <div className={styles.wsTabs} aria-hidden="true">
          <span data-current>
            线索池 <b>{pool.length + 13}</b>
          </span>
          <span data-bump={claimed.length || undefined} key={claimed.length}>
            待联系 <b>{claimed.length + 6}</b>
          </span>
          <span>
            跟进中 <b>41</b>
          </span>
          <span>
            成交保护 <b>9</b>
          </span>
        </div>
        <table className={styles.wsTable}>
          <thead>
            <tr>
              <th scope="col">客户名称</th>
              <th scope="col">来源</th>
              <th scope="col">意向</th>
              <th scope="col">进池时间</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pool.map((lead) => (
              <tr
                key={lead.name}
                data-selected={lead.name === selected.name || undefined}
                data-leaving={lead.name === leaving || undefined}
                onClick={() => setSelected(lead)}
              >
                <td>{lead.name}</td>
                <td>{lead.source}</td>
                <td>
                  <span className={styles.intent} data-level={lead.intent}>
                    {lead.intent}
                  </span>
                </td>
                <td className={styles.num}>{lead.pooledAt}</td>
                <td>
                  <button
                    type="button"
                    className={styles.claim}
                    onClick={(event) => {
                      event.stopPropagation();
                      claim(lead);
                    }}
                    aria-label={`领取 ${lead.name}`}
                  >
                    领取
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pool.length === 0 ? (
          <p className={styles.wsEmpty}>线索池里的 5 条都领完了。</p>
        ) : null}
        {claimed.length ? (
          <button type="button" className={styles.wsReset} onClick={reset}>
            重新演示
          </button>
        ) : null}
      </section>

      <aside className={styles.wsPanel} aria-label={`记录：${selected.name}`}>
        <h3>{selected.name}</h3>
        <p className={styles.wsMeta}>
          {isClaimed ? "你刚刚领取 · 待联系" : `线索池 · ${selected.source}`}
        </p>
        {isClaimed ? (
          <p className={styles.deadline}>
            <span>联系期限</span>
            <time className={styles.num}>剩 {remaining(left)}</time>
          </p>
        ) : (
          <p className={styles.deadlineIdle}>领取后开始 24 小时联系期限</p>
        )}
        <ol className={styles.wsActivity}>
          <li>
            <b>
              {selected.source} · {selected.pooledAt}
            </b>
            <p>{selected.note}</p>
          </li>
          {isClaimed ? (
            <li data-new>
              <b>下一步 · 今天之内</b>
              <p>打电话确认需求，确认联系后进入跟进。</p>
            </li>
          ) : null}
        </ol>
      </aside>
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
