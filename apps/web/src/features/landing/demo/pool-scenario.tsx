"use client";

import { useEffect, useState } from "react";

import { IMPORTED_LEADS, POOL_LEADS, type Lead } from "./demo-data";
import styles from "./demo.module.css";

/* The staged pool as the product runs it: claiming starts a 24-hour contact
   window; only a contact that got through (a connected call, a new WeChat
   contact) moves the lead on to 跟进中. */

type Stage = "pool" | "pending" | "following";

const TABS: { stage: Stage; label: string }[] = [
  { stage: "pool", label: "线索池" },
  { stage: "pending", label: "待联系" },
  { stage: "following", label: "跟进中" },
];

const OUTCOMES = [
  { key: "call-ok", label: "电话 · 已接通", success: true },
  { key: "wechat", label: "微信 · 新加上微信", success: true },
  { key: "call-miss", label: "电话 · 未接通", success: false },
] as const;

const DAY = 24 * 60 * 60 * 1000;

/* Read only from the claim handler and the countdown effect, never during
   render. */
const clock = () => performance.now();

function remaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Entry {
  stage: Stage;
  claimedAt?: number;
  misses: number;
}

export function PoolScenario({
  onTouch,
  importedToPool,
}: {
  onTouch: () => void;
  importedToPool: boolean;
}) {
  const leads: (Lead & { fresh?: boolean })[] = [
    ...POOL_LEADS,
    ...(importedToPool
      ? IMPORTED_LEADS.map((lead) => ({ ...lead, fresh: true }))
      : []),
  ];
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [tab, setTab] = useState<Stage>("pool");
  const [menu, setMenu] = useState<string>();
  const [status, setStatus] = useState("");
  const [now, setNow] = useState(0);
  const entry = (name: string): Entry =>
    entries[name] ?? { stage: "pool", misses: 0 };
  const inStage = (stage: Stage) =>
    leads.filter((lead) => entry(lead.name).stage === stage);
  const hasPending = inStage("pending").length > 0;

  useEffect(() => {
    if (!hasPending) return;
    const tick = () => setNow(clock());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [hasPending]);

  const update = (name: string, next: Partial<Entry>) =>
    setEntries((current) => ({
      ...current,
      [name]: { ...entry(name), ...next },
    }));

  function claim(lead: Lead) {
    update(lead.name, { stage: "pending", claimedAt: clock() });
    setStatus(
      `已领取${lead.name}，进入待联系。24 小时内没有确认联系，会自动回到线索池。`,
    );
    onTouch();
  }

  function record(lead: Lead, outcome: (typeof OUTCOMES)[number]) {
    setMenu(undefined);
    if (outcome.success) {
      update(lead.name, { stage: "following" });
      setStatus(
        `${outcome.label}：${lead.name}进入跟进中，跟进期限 30 天，每次登记沟通都会顺延。`,
      );
    } else {
      update(lead.name, { misses: entry(lead.name).misses + 1 });
      setStatus(
        `${outcome.label}：不算联系成功，${lead.name}仍在待联系，期限照常计时。`,
      );
    }
    onTouch();
  }

  const rows = inStage(tab);

  return (
    <div className={styles.scenario}>
      <header className={styles.head}>
        <div>
          <h3>客户 · 线索公海</h3>
          <p className={styles.meta}>
            你是销售周航，按权限可以领取线索池里的客户。
          </p>
        </div>
      </header>

      <div className={styles.segmented} role="group" aria-label="阶段">
        {TABS.map((item) => (
          <button
            key={item.stage}
            type="button"
            aria-pressed={tab === item.stage}
            onClick={() => {
              setTab(item.stage);
              setMenu(undefined);
            }}
          >
            {item.label}
            <b key={inStage(item.stage).length}>{inStage(item.stage).length}</b>
          </button>
        ))}
      </div>

      <ul className={styles.list}>
        {rows.length === 0 ? (
          <li className={styles.emptyRow}>
            {tab === "pool"
              ? "线索池已经领空了。"
              : tab === "pending"
                ? "还没有待联系的客户，先去线索池领取一条。"
                : "还没有跟进中的客户：在待联系里登记一次成功的联系。"}
          </li>
        ) : null}
        {rows.map((lead) => {
          const current = entry(lead.name);
          return (
            <li key={lead.name} className={styles.row}>
              <span className={styles.rowMain}>
                <b>{lead.name}</b>
                <small>
                  {lead.contact} · {lead.source}
                  {lead.fresh && tab === "pool" ? (
                    <span className={styles.tag}>新导入</span>
                  ) : null}
                  {current.misses ? (
                    <span className={styles.tag} data-tone="warn">
                      未接通 {current.misses} 次
                    </span>
                  ) : null}
                </small>
              </span>
              {tab === "pool" ? (
                <button
                  type="button"
                  className={styles.small}
                  aria-label={`领取 ${lead.name}`}
                  onClick={() => claim(lead)}
                >
                  领取
                </button>
              ) : tab === "pending" ? (
                <span className={styles.rowActions}>
                  <span className={styles.deadline}>
                    剩{" "}
                    {remaining(
                      current.claimedAt === undefined
                        ? DAY
                        : Math.min(DAY, current.claimedAt + DAY - now),
                    )}
                  </span>
                  <span
                    className={styles.menuWrap}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setMenu(undefined);
                    }}
                  >
                    <button
                      type="button"
                      className={styles.small}
                      aria-expanded={menu === lead.name}
                      aria-label={`登记联系：${lead.name}`}
                      onClick={() =>
                        setMenu(menu === lead.name ? undefined : lead.name)
                      }
                    >
                      登记联系
                    </button>
                    <span
                      className={styles.menu}
                      data-open={menu === lead.name || undefined}
                      inert={menu !== lead.name}
                      role="group"
                      aria-label={`联系结果：${lead.name}`}
                    >
                      {OUTCOMES.map((outcome) => (
                        <button
                          key={outcome.key}
                          type="button"
                          onClick={() => record(lead, outcome)}
                        >
                          {outcome.label}
                        </button>
                      ))}
                    </span>
                  </span>
                </span>
              ) : (
                <span className={styles.chip} data-tone="ok">
                  跟进期限 30 天
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className={styles.status} role="status" aria-live="polite">
        {status || "管理员也可以勾选多条，一次分配给某位同事。"}
      </p>
    </div>
  );
}
