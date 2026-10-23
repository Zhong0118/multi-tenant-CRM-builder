"use client";

import { useState } from "react";

import styles from "./demo.module.css";

/* 林岚's 团队动态: counts come from what members logged in the system (calls,
   messages, visits, claims, completed follow-ups, daily reports), so nobody
   fills in a separate progress sheet. She can assign a task from here. */

type Period = "today" | "week" | "month";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
];

const METRICS = ["电话", "消息", "拜访", "领取", "完成待办"];

const DATA: Record<Period, Record<string, number[]>> = {
  today: { 周航: [4, 2, 0, 1, 3], 唐悦: [2, 3, 1, 0, 2] },
  week: { 周航: [18, 9, 3, 4, 11], 唐悦: [12, 14, 4, 2, 9] },
  month: { 周航: [61, 37, 11, 13, 42], 唐悦: [48, 52, 15, 7, 35] },
};

const REPORTS: Record<Period, Record<string, string>> = {
  today: { 周航: "已写", 唐悦: "未写" },
  week: { 周航: "5 天", 唐悦: "4 天" },
  month: { 周航: "18 天", 唐悦: "16 天" },
};

const REPORT_TEXT = {
  done: "确认了南湖实验学校的报价单；回访城东社区医院，对样品座椅满意。",
  plan: "周五去启明设计事务所量尺。",
  issue: "滨江职业学校的合同盖章页还在等对方寄回。",
};

const MEMBERS = ["周航", "唐悦"] as const;

interface WorkTask {
  id: number;
  title: string;
  member: string;
}

export function TeamScenario({ onTouch }: { onTouch: () => void }) {
  const [period, setPeriod] = useState<Period>("today");
  const [report, setReport] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [member, setMember] = useState<string>("唐悦");
  const [title, setTitle] = useState("给城东社区医院发正式报价");
  const [tasks, setTasks] = useState<WorkTask[]>([
    { id: 1, title: "整理本周报价汇总", member: "周航" },
  ]);
  const [status, setStatus] = useState("");

  function assign() {
    const text = title.trim();
    if (!text) return;
    setTasks((current) => [
      ...current,
      { id: current.length + 1, title: text, member },
    ]);
    setAssigning(false);
    setStatus(`已安排给${member}：${text}。完成时${member}会写下结果。`);
    onTouch();
  }

  return (
    <div className={styles.scenario}>
      <header className={styles.head}>
        <div>
          <h3>团队动态</h3>
          <p className={styles.meta}>
            按系统里登记的沟通、领取、待办和日报统计
          </p>
        </div>
        <div className={styles.segmented} role="group" aria-label="统计周期">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={period === item.key}
              onClick={() => {
                setPeriod(item.key);
                onTouch();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">成员</th>
              {METRICS.map((metric) => (
                <th key={metric} scope="col" className={styles.num}>
                  {metric}
                </th>
              ))}
              <th scope="col">日报</th>
            </tr>
          </thead>
          <tbody key={period} className={styles.fadeIn}>
            {MEMBERS.map((name) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                {DATA[period][name].map((value, index) => (
                  <td key={METRICS[index]} className={styles.num}>
                    {value}
                  </td>
                ))}
                <td>
                  {period === "today" && name === "周航" ? (
                    <button
                      type="button"
                      className={styles.textButton}
                      aria-expanded={report}
                      aria-controls="demo-report"
                      onClick={() => {
                        setReport((value) => !value);
                        onTouch();
                      }}
                    >
                      {report ? "收起日报" : "查看日报"}
                    </button>
                  ) : (
                    <span
                      className={
                        REPORTS[period][name] === "未写"
                          ? styles.muted
                          : undefined
                      }
                    >
                      {REPORTS[period][name]}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        id="demo-report"
        className={styles.collapse}
        data-open={(report && period === "today") || undefined}
        inert={!(report && period === "today")}
      >
        <div>
          <dl className={styles.report}>
            <div>
              <dt>今日完成</dt>
              <dd>{REPORT_TEXT.done}</dd>
            </div>
            <div>
              <dt>明日安排</dt>
              <dd>{REPORT_TEXT.plan}</dd>
            </div>
            <div>
              <dt>遇到的问题</dt>
              <dd>{REPORT_TEXT.issue}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className={styles.taskBlock}>
        <div className={styles.taskHead}>
          <h4>
            团队任务 <b>{tasks.length}</b>
          </h4>
          <button
            type="button"
            className={styles.secondary}
            aria-expanded={assigning}
            aria-controls="demo-assign"
            onClick={() => setAssigning((value) => !value)}
          >
            {assigning ? "取消" : "安排任务"}
          </button>
        </div>
        <div
          id="demo-assign"
          className={styles.collapse}
          data-open={assigning || undefined}
          inert={!assigning}
        >
          <div>
            <form
              className={styles.assignForm}
              onSubmit={(event) => {
                event.preventDefault();
                assign();
              }}
            >
              <label>
                <span>要做什么</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <fieldset>
                <legend>交给</legend>
                {MEMBERS.map((name) => (
                  <label key={name} className={styles.radio}>
                    <input
                      type="radio"
                      name="demo-task-member"
                      checked={member === name}
                      onChange={() => setMember(name)}
                    />
                    {name}
                  </label>
                ))}
              </fieldset>
              <button
                type="submit"
                className={styles.primary}
                disabled={!title.trim()}
              >
                安排
              </button>
            </form>
          </div>
        </div>
        <ul className={styles.taskList}>
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{task.title}</span>
              <small>{task.member} · 进行中</small>
            </li>
          ))}
        </ul>
      </div>

      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
