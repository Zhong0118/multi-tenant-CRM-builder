"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./demo.module.css";

/* 周航's workbench: follow-ups due today, overdue and in the next 7 days, and
   the in-app messages the product sends. Completing a follow-up offers to
   schedule the next one, as the real workbench does. */

type Bucket = "today" | "overdue" | "week";

interface Task {
  id: number;
  what: string;
  record: string;
  when: string;
  bucket: Bucket;
  done?: boolean;
}

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "overdue", label: "已逾期" },
  { key: "today", label: "今天" },
  { key: "week", label: "未来 7 天" },
];

const INITIAL: Task[] = [
  {
    id: 1,
    what: "补发合同盖章页",
    record: "滨江职业学校",
    when: "逾期 2 天",
    bucket: "overdue",
  },
  {
    id: 2,
    what: "确认报价单",
    record: "南湖实验学校",
    when: "16:00",
    bucket: "today",
  },
  {
    id: 3,
    what: "回访样品意见",
    record: "城东社区医院",
    when: "17:30",
    bucket: "today",
  },
  {
    id: 4,
    what: "上门量尺",
    record: "启明设计事务所",
    when: "周五 10:00",
    bucket: "week",
  },
];

const NEXT = [
  { label: "明天", when: "明天 10:00", bucket: "week" as Bucket },
  { label: "下周一", when: "下周一 09:30", bucket: "week" as Bucket },
];

const NOTICES = [
  { id: 1, kind: "联系提醒", text: "北岸物业服务中心的联系期限还剩 2 小时" },
  {
    id: 2,
    kind: "跟进提醒",
    text: "南湖实验学校：确认报价单，今天 16:00 到期",
  },
  { id: 3, kind: "待办提醒", text: "滨江职业学校：补发合同盖章页已逾期" },
  {
    id: 4,
    kind: "公海回收",
    text: "青禾幼儿园超过 24 小时未联系，已回到线索池",
  },
];

function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

export function FollowUpScenario({ onTouch }: { onTouch: () => void }) {
  const [tasks, setTasks] = useState(INITIAL);
  const [asking, setAsking] = useState<number>();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<number[]>([]);
  const [status, setStatus] = useState("");
  const bellRef = useRef<HTMLButtonElement>(null);
  const unread = NOTICES.length - read.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      bellRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function complete(task: Task) {
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id ? { ...item, done: true } : item,
      ),
    );
    setAsking(task.id);
    setStatus(`已完成：${task.record} · ${task.what}。要安排下一次跟进吗？`);
    onTouch();
  }

  function schedule(task: Task, next?: (typeof NEXT)[number]) {
    setAsking(undefined);
    if (next) {
      setTasks((current) => [
        ...current,
        {
          id: Date.now(),
          what: "再次跟进",
          record: task.record,
          when: next.when,
          bucket: next.bucket,
        },
      ]);
      setStatus(`已安排：${task.record}，${next.when}。`);
    } else {
      setStatus(`${task.record}没有安排下一次跟进。`);
    }
    onTouch();
  }

  return (
    <div className={styles.scenario}>
      <header className={styles.head}>
        <div>
          <h3>我的工作台</h3>
          <p className={styles.meta}>周航 · 今天要处理的跟进</p>
        </div>
        <div className={styles.bellWrap}>
          <button
            ref={bellRef}
            type="button"
            className={styles.bell}
            aria-expanded={open}
            aria-controls="demo-notices"
            onClick={() => {
              setOpen((value) => !value);
              onTouch();
            }}
          >
            消息
            {unread > 0 ? (
              <b aria-label={`${unread} 条未读`}>{unread}</b>
            ) : null}
          </button>
          <div
            id="demo-notices"
            className={styles.popover}
            data-open={open || undefined}
            inert={!open}
          >
            <div className={styles.popoverHead}>
              <b>消息</b>
              <button
                type="button"
                className={styles.textButton}
                disabled={unread === 0}
                onClick={() => setRead(NOTICES.map((notice) => notice.id))}
              >
                全部已读
              </button>
            </div>
            <ul>
              {NOTICES.map((notice) => (
                <li key={notice.id}>
                  <button
                    type="button"
                    data-read={read.includes(notice.id) || undefined}
                    onClick={() =>
                      setRead((current) =>
                        current.includes(notice.id)
                          ? current
                          : [...current, notice.id],
                      )
                    }
                  >
                    <small>{notice.kind}</small>
                    {notice.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </header>

      <div className={styles.buckets}>
        {BUCKETS.map((bucket) => {
          const items = tasks.filter((task) => task.bucket === bucket.key);
          const left = items.filter((task) => !task.done).length;
          return (
            <section
              key={bucket.key}
              data-tone={bucket.key === "overdue" ? "warn" : undefined}
            >
              <h4>
                {bucket.label} <b>{left}</b>
              </h4>
              <ul>
                {items.map((task) => (
                  <li key={task.id} data-done={task.done || undefined}>
                    <span className={styles.taskText}>
                      <b>{task.what}</b>
                      <small>
                        {task.record} · {task.when}
                      </small>
                    </span>
                    {task.done ? (
                      <span className={styles.doneMark}>已完成</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.small}
                        onClick={() => complete(task)}
                        aria-label={`完成：${task.record} ${task.what}`}
                      >
                        完成
                      </button>
                    )}
                  </li>
                ))}
                {items.length === 0 ? (
                  <li className={styles.emptyRow}>没有</li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>

      {asking !== undefined ? (
        <div
          className={styles.nextAsk}
          role="group"
          aria-label="安排下一次跟进"
        >
          <span>
            下一次跟进{tasks.find((task) => task.id === asking)?.record}：
          </span>
          {NEXT.map((next, index) => (
            <button
              key={next.label}
              type="button"
              ref={index === 0 ? focusOnMount : undefined}
              onClick={() =>
                schedule(
                  tasks.find((task) => task.id === asking)!,
                  next,
                )
              }
            >
              {next.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => schedule(tasks.find((task) => task.id === asking)!)}
          >
            不安排
          </button>
        </div>
      ) : null}

      <p className={styles.status} role="status" aria-live="polite">
        {status || "到期、逾期、联系期限和线索回收，都会出现在右上角的消息里。"}
      </p>
    </div>
  );
}
