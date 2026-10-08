"use client";

import { useRef, useState } from "react";
import styles from "./landing.module.css";

function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

/* Every name, school, amount and time below is fictional. Nothing in this
   file talks to the API: each button only changes local React state. */

const PEOPLE = ["周航", "唐悦", "林岚"] as const;
type Person = (typeof PEOPLE)[number];

const SHEET = [
  [
    "南湖实验学校 新校区教室家具",
    "方案报价",
    "186000",
    "王老师",
    "报价发了吗？？",
  ],
  ["城东社区医院 候诊区座椅", "需求确认", "42500", "刘主任", "问一下唐悦"],
  [
    "启明设计事务所 办公室翻新",
    "商务谈判",
    "约9.8万",
    "陈总",
    "（和第 9 行重复）",
  ],
  ["青禾幼儿园 午休床", "初步接触", "23600", "孙园长", ""],
] as const;

const SHEET_HEADERS = ["商机名称", "阶段", "预计金额", "联系人", "备注"];
const MAPPING = ["商机名称", "阶段", "金额", "联系人", "跳过此列"];

export function ImportStep() {
  const [phase, setPhase] = useState<"sheet" | "imported" | "retried">("sheet");
  const rows = SHEET.map((row, index) =>
    index === 2 && phase === "retried"
      ? [row[0], row[1], "97800", row[3], row[4]]
      : row,
  );

  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <strong>导入 CSV</strong>
        <span>商机表-最新-最终版(2).csv</span>
      </div>
      <div className={styles.scrollX}>
        <table className={styles.sheet}>
          <thead>
            <tr>
              <th scope="col" className={styles.rowNo}>
                <span className={styles.srOnly}>行号</span>
              </th>
              {SHEET_HEADERS.map((header, index) => (
                <th key={header} scope="col">
                  {header}
                  <small data-skip={MAPPING[index] === "跳过此列" || undefined}>
                    {MAPPING[index] === "跳过此列"
                      ? "跳过此列"
                      : `映射到「${MAPPING[index]}」`}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row[0]}>
                <td className={styles.rowNo}>{rowIndex + 2}</td>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    data-bad={
                      (rowIndex === 2 &&
                        cellIndex === 2 &&
                        phase !== "retried") ||
                      undefined
                    }
                    data-fixed={
                      (rowIndex === 2 &&
                        cellIndex === 2 &&
                        phase === "retried") ||
                      undefined
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.screenFoot} aria-live="polite">
        {phase === "sheet" ? (
          <>
            <p>4 行 · 5 列。成员字段不能导入，负责人导入后再指派。</p>
            <button
              type="button"
              className={styles.demoButton}
              onClick={() => setPhase("imported")}
            >
              导入映射后的行
            </button>
          </>
        ) : phase === "imported" ? (
          <>
            <p data-tone="warning">
              成功 3 行，失败 1 行。第 4 行：金额：请填写数字。失败行不会写入。
            </p>
            <button
              type="button"
              className={styles.demoButton}
              onClick={() => setPhase("retried")}
            >
              把「约9.8万」改成 97800，重试失败行
            </button>
          </>
        ) : (
          <>
            <p data-tone="success">4 行都已导入，负责人显示为「未指定」。</p>
            <button
              type="button"
              className={styles.demoGhost}
              onClick={() => setPhase("sheet")}
            >
              重新演示
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const ASSIGN_ROWS = SHEET.map((row) => ({ title: row[0], stage: row[1] }));

export function AssignStep() {
  const [owners, setOwners] = useState<(Person | null)[]>(
    ASSIGN_ROWS.map(() => null),
  );
  const [checked, setChecked] = useState<boolean[]>([true, false, false, true]);
  const [person, setPerson] = useState<Person>("周航");
  const count = checked.filter(Boolean).length;

  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <strong>商机</strong>
        <span>已选 {count} 条</span>
      </div>
      <ul className={styles.assignList}>
        {ASSIGN_ROWS.map((row, index) => (
          <li key={row.title}>
            <label>
              <input
                type="checkbox"
                checked={checked[index]}
                onChange={(event) =>
                  setChecked((current) =>
                    current.map((value, itemIndex) =>
                      itemIndex === index ? event.target.checked : value,
                    ),
                  )
                }
              />
              <span className={styles.assignTitle}>{row.title}</span>
            </label>
            <span className={styles.stage}>{row.stage}</span>
            <span
              className={styles.owner}
              data-empty={owners[index] === null || undefined}
            >
              {owners[index] ?? "未指定"}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.screenFoot}>
        <fieldset className={styles.segmented}>
          <legend>同时修改负责人</legend>
          {PEOPLE.map((name) => (
            <label key={name}>
              <input
                type="radio"
                name="demo-owner"
                value={name}
                checked={person === name}
                onChange={() => setPerson(name)}
              />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className={styles.demoButton}
          disabled={count === 0}
          onClick={() => {
            setOwners((current) =>
              current.map((owner, index) => (checked[index] ? person : owner)),
            );
            setChecked(ASSIGN_ROWS.map(() => false));
          }}
        >
          {count === 0 ? "先勾选记录" : `把已选 ${count} 条交给${person}`}
        </button>
      </div>
    </div>
  );
}

const ACTIVITY_TYPES = ["电话", "消息", "拜访", "备注"] as const;
type ActivityType = (typeof ACTIVITY_TYPES)[number];

interface Activity {
  id: number;
  type: ActivityType;
  text: string;
  meta: string;
}

const DUE_OPTIONS = ["明天 10:00", "10月12日 14:00", "下周一 09:30"];

export function FollowUpStep() {
  const nextCardRef = useRef<HTMLDivElement>(null);
  const [activities, setActivities] = useState<Activity[]>([
    {
      id: 2,
      type: "电话",
      text: "后勤处王老师要求 3 种桌椅样式，下周看样。",
      meta: "周航 · 昨天 14:20",
    },
    {
      id: 1,
      type: "拜访",
      text: "现场量了 24 间教室，尺寸表放在附件里。",
      meta: "周航 · 10月3日",
    },
  ]);
  const [type, setType] = useState<ActivityType>("电话");
  const [text, setText] = useState(
    "王老师确认选 B 款课桌，960 套，周五前要正式报价。",
  );
  const [next, setNext] = useState<{
    title: string;
    due: string;
    done: boolean;
  }>({ title: "确认报价单", due: "今天 16:00", done: false });
  const [draftTitle, setDraftTitle] = useState("寄送正式报价单");
  const [draftDue, setDraftDue] = useState(DUE_OPTIONS[0]);

  return (
    <div className={`${styles.screen} ${styles.recordScreen}`}>
      <div className={styles.screenHead}>
        <strong>南湖实验学校 新校区教室家具</strong>
        <span>负责人 周航</span>
      </div>
      <div className={styles.recordBody}>
        <section aria-label="下一步跟进" className={styles.nextPanel}>
          <h4>下一步跟进</h4>
          <div
            ref={nextCardRef}
            tabIndex={-1}
            className={styles.nextCard}
            data-done={next.done || undefined}
          >
            <p>{next.title}</p>
            <span>{next.done ? "已完成" : next.due}</span>
          </div>
          {next.done ? (
            <form
              className={styles.nextForm}
              onSubmit={(event) => {
                event.preventDefault();
                if (!draftTitle.trim()) return;
                setNext({
                  title: draftTitle.trim(),
                  due: draftDue,
                  done: false,
                });
                nextCardRef.current?.focus();
              }}
            >
              <label>
                <span>事项</span>
                <input
                  ref={focusOnMount}
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  maxLength={40}
                />
              </label>
              <label>
                <span>时间</span>
                <select
                  value={draftDue}
                  onChange={(event) => setDraftDue(event.target.value)}
                >
                  {DUE_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className={styles.demoButton}
                disabled={!draftTitle.trim()}
              >
                安排跟进
              </button>
            </form>
          ) : (
            <button
              type="button"
              className={styles.demoGhost}
              onClick={() => setNext((current) => ({ ...current, done: true }))}
            >
              标记完成，安排下一步
            </button>
          )}
          <p className={styles.fine}>过了时间还没完成的跟进会标为已逾期。</p>
        </section>

        <section aria-label="活动历史" className={styles.activityPanel}>
          <form
            className={styles.activityForm}
            onSubmit={(event) => {
              event.preventDefault();
              const value = text.trim();
              if (!value) return;
              setActivities((current) => [
                {
                  id: current.length + 1,
                  type,
                  text: value,
                  meta: "周航 · 刚刚",
                },
                ...current,
              ]);
              setText("");
            }}
          >
            <fieldset className={styles.segmented}>
              <legend>活动类型</legend>
              {ACTIVITY_TYPES.map((item) => (
                <label key={item}>
                  <input
                    type="radio"
                    name="demo-activity"
                    value={item}
                    checked={type === item}
                    onChange={() => setType(item)}
                  />
                  <span>{item}</span>
                </label>
              ))}
            </fieldset>
            <label className={styles.srOnly} htmlFor="demo-activity-text">
              活动内容
            </label>
            <textarea
              id="demo-activity-text"
              rows={2}
              value={text}
              maxLength={120}
              placeholder="写下这次沟通的内容"
              onChange={(event) => setText(event.target.value)}
            />
            <button
              type="submit"
              className={styles.demoButton}
              disabled={!text.trim()}
            >
              添加活动
            </button>
          </form>
          <h4>活动历史</h4>
          <ol className={styles.timeline} aria-live="polite">
            {activities.map((activity) => (
              <li key={activity.id}>
                <b>{activity.type}</b>
                <p>{activity.text}</p>
                <span>{activity.meta}</span>
              </li>
            ))}
          </ol>
          <p className={styles.fine}>
            活动按时间追加，不能修改或覆盖已有记录。
          </p>
        </section>
      </div>
    </div>
  );
}

const STAGES = [
  { label: "初步接触", count: 8 },
  { label: "需求确认", count: 6 },
  { label: "方案报价", count: 5 },
  { label: "商务谈判", count: 4 },
];

const RANKING = [
  { name: "周航", amount: "512,400", share: 100 },
  { name: "林岚", amount: "438,000", share: 85 },
  { name: "唐悦", amount: "333,600", share: 65 },
];

const MY_FOLLOW_UPS = [
  {
    bucket: "今日",
    items: [
      {
        title: "确认报价单",
        record: "南湖实验学校 新校区教室家具",
        due: "16:00",
      },
    ],
  },
  {
    bucket: "已逾期",
    items: [
      {
        title: "补发合同盖章页",
        record: "滨江职业学校 宿舍床",
        due: "逾期 2 天",
      },
    ],
  },
  {
    bucket: "近期",
    items: [
      { title: "寄送样品", record: "青禾幼儿园 午休床", due: "10月12日" },
      {
        title: "上门复尺",
        record: "启明设计事务所 办公室翻新",
        due: "10月10日",
      },
    ],
  },
];

export function ProgressStep() {
  const [view, setView] = useState<"admin" | "staff">("admin");

  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <fieldset className={styles.segmented}>
          <legend>以谁的身份查看</legend>
          <label>
            <input
              type="radio"
              name="demo-view"
              checked={view === "admin"}
              onChange={() => setView("admin")}
            />
            <span>林岚 · 公司管理员</span>
          </label>
          <label>
            <input
              type="radio"
              name="demo-view"
              checked={view === "staff"}
              onChange={() => setView("staff")}
            />
            <span>周航 · 员工</span>
          </label>
        </fieldset>
      </div>

      {view === "admin" ? (
        <div className={styles.board}>
          <dl className={styles.kpis}>
            <div>
              <dt>进行中商机</dt>
              <dd data-numeric>23</dd>
            </div>
            <div>
              <dt>金额合计（元）</dt>
              <dd data-numeric>1,284,000</dd>
            </div>
            <div data-tone="warning">
              <dt>已逾期跟进</dt>
              <dd data-numeric>3</dd>
            </div>
          </dl>
          <div className={styles.boardRow}>
            <section aria-label="阶段分布" className={styles.widget}>
              <h4>阶段分布</h4>
              <ul className={styles.bars}>
                {STAGES.map((stage) => (
                  <li key={stage.label}>
                    <span>{stage.label}</span>
                    <i style={{ width: `${(stage.count / 8) * 100}%` }} />
                    <b data-numeric>{stage.count}</b>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label="负责人排行" className={styles.widget}>
              <h4>负责人排行 · 金额</h4>
              <ol className={styles.ranking}>
                {RANKING.map((row) => (
                  <li key={row.name}>
                    <span>{row.name}</span>
                    <i style={{ width: `${row.share}%` }} />
                    <b data-numeric>{row.amount}</b>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      ) : (
        <div className={styles.workbench}>
          <h4>我的跟进</h4>
          {MY_FOLLOW_UPS.map((group) => (
            <section key={group.bucket} aria-label={group.bucket}>
              <h5 data-tone={group.bucket === "已逾期" ? "warning" : undefined}>
                {group.bucket} <span data-numeric>{group.items.length}</span>
              </h5>
              <ul>
                {group.items.map((item) => (
                  <li key={item.title}>
                    <p>{item.title}</p>
                    <span>{item.record}</span>
                    <em
                      data-tone={
                        group.bucket === "已逾期" ? "warning" : undefined
                      }
                    >
                      {item.due}
                    </em>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className={styles.fine}>
            本例中员工的商机范围设为「仅本人负责」，所以周航只看到自己的记录。
          </p>
        </div>
      )}
    </div>
  );
}

type AiState = "idle" | "today" | "proposal";
type ProposalState = "pending" | "confirmed" | "rejected";

export function AiStep() {
  const [asked, setAsked] = useState<AiState>("idle");
  const [proposal, setProposal] = useState<ProposalState>("pending");

  return (
    <div className={`${styles.screen} ${styles.aiScreen}`}>
      <div className={styles.screenHead}>
        <strong>AI 助手</strong>
        <span className={styles.badge}>需确认后执行</span>
      </div>
      <div className={styles.aiBody} aria-live="polite">
        {asked === "idle" ? (
          <p className={styles.aiHint}>
            我只会读取你当前有权限访问的 CRM 数据。
          </p>
        ) : null}

        {asked === "today" ? (
          <>
            <p className={styles.bubbleUser}>我今天要跟进什么？</p>
            <div className={styles.bubbleAi}>
              <p>
                你今天有 1 条跟进到期：16:00 前和南湖实验学校确认报价单。另有 1
                条已逾期 2 天：给滨江职业学校补发合同盖章页，建议今天一起处理。
              </p>
              <div className={styles.sources}>
                <small>数据来源</small>
                <span>商机 · 南湖实验学校 新校区教室家具</span>
                <span>商机 · 滨江职业学校 宿舍床</span>
              </div>
            </div>
          </>
        ) : null}

        {asked === "proposal" ? (
          <>
            <p className={styles.bubbleUser}>
              南湖实验学校报价确认后，帮我约下周一上门送样。
            </p>
            <div className={styles.bubbleAi}>
              <p>我可以在这条商机上创建一条跟进。确认后才会写入：</p>
              <div className={styles.proposal} data-state={proposal}>
                <div className={styles.proposalHead}>
                  <b>创建跟进</b>
                  <span>
                    {proposal === "pending"
                      ? "待确认"
                      : proposal === "confirmed"
                        ? "已执行（演示）"
                        : "已拒绝"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>记录</dt>
                    <dd>南湖实验学校 新校区教室家具</dd>
                  </div>
                  <div>
                    <dt>事项</dt>
                    <dd>上门送样</dd>
                  </div>
                  <div>
                    <dt>时间</dt>
                    <dd>下周一 10:00</dd>
                  </div>
                </dl>
                {proposal === "pending" ? (
                  <div className={styles.proposalActions}>
                    <button
                      type="button"
                      className={styles.demoButton}
                      onClick={() => setProposal("confirmed")}
                    >
                      确认执行
                    </button>
                    <button
                      type="button"
                      className={styles.demoGhost}
                      onClick={() => setProposal("rejected")}
                    >
                      拒绝
                    </button>
                  </div>
                ) : (
                  <p
                    className={styles.fine}
                    role="status"
                    tabIndex={-1}
                    ref={focusOnMount}
                  >
                    {proposal === "confirmed"
                      ? "在真实工作区里，这一步会写入跟进并记录审计。演示中没有写入任何数据。"
                      : "已拒绝，未写入数据。"}
                  </p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
      <div className={styles.prompts}>
        <span id="demo-ai-prompts">试着问：</span>
        <div role="group" aria-labelledby="demo-ai-prompts">
          <button
            type="button"
            aria-pressed={asked === "today"}
            onClick={() => setAsked("today")}
          >
            我今天要跟进什么？
          </button>
          <button
            type="button"
            aria-pressed={asked === "proposal"}
            onClick={() => {
              setAsked("proposal");
              setProposal("pending");
            }}
          >
            报价确认后，帮我约下周一上门送样
          </button>
        </div>
      </div>
    </div>
  );
}
