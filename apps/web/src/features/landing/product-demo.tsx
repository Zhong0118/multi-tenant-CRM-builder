"use client";

import {
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  AiStep,
  AssignStep,
  FollowUpStep,
  ImportStep,
  ProgressStep,
} from "./demo-steps";
import styles from "./landing.module.css";
import { Phrases } from "./phrases";

interface Step {
  id: string;
  label: string;
  title: string;
  sheet: string;
  here: string;
  panel: ReactNode;
}

const STEPS: Step[] = [
  {
    id: "import",
    label: "整理数据",
    title: "把现有表格导进来",
    sheet:
      "每人一份副本，金额有人写数字有人写“约 9.8 万”，合并时才发现重复和错位。",
    here: "每一列映射到一个字段。格式不对的行单独列出原因，改好后只重试这几行。",
    panel: <ImportStep />,
  },
  {
    id: "assign",
    label: "指派负责人",
    title: "每条记录都有负责人",
    sheet: "“谁在跟”靠单元格颜色或备注里的一个名字，人一多就说不清。",
    here: "勾选记录，一次交给一位同事。负责人决定了员工能看到、能处理哪些记录。",
    panel: <AssignStep />,
  },
  {
    id: "follow-up",
    label: "记录跟进",
    title: "沟通留在记录上，下一步有时间",
    sheet:
      "跟进内容写在备注格里，后写的盖掉先写的；下次联系时间记在各自手机里。",
    here: "电话、消息、拜访按时间追加到这条商机上。下一步跟进有事项和时间，到期没做会标为逾期。",
    panel: <FollowUpStep />,
  },
  {
    id: "progress",
    label: "查看进展",
    title: "管理员看团队，员工看自己的今天",
    sheet: "开周会前挨个问进度，再手工汇总到另一张表。",
    here: "看板按查看人的权限统计。员工的工作台列出今天到期、已逾期和未来 7 天的跟进。",
    panel: <ProgressStep />,
  },
  {
    id: "ai",
    label: "问 AI",
    title: "在业务数据里提问",
    sheet: "想知道“今天该跟进谁”，只能自己筛选、排序、翻备注。",
    here: "AI 只读取你有权限的数据，回答附带来源记录。要改数据时先给出建议，你确认后才执行。",
    panel: <AiStep />,
  },
];

const VERTICAL_LAYOUT = "(min-width: 1100px)";

function subscribeLayout(onChange: () => void) {
  const media = window.matchMedia(VERTICAL_LAYOUT);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function isVerticalLayout() {
  return window.matchMedia(VERTICAL_LAYOUT).matches;
}

export function ProductDemo() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const vertical = useSyncExternalStore(
    subscribeLayout,
    isVerticalLayout,
    () => false,
  );

  const select = (index: number) => {
    const next = (index + STEPS.length) % STEPS.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowDown: active + 1,
      ArrowLeft: active - 1,
      ArrowUp: active - 1,
      Home: 0,
      End: STEPS.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(keys[event.key]);
  };

  return (
    <div className={styles.demo}>
      <div
        role="tablist"
        aria-label="演示步骤"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        className={styles.tabs}
      >
        {STEPS.map((step, index) => (
          <button
            key={step.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`demo-tab-${step.id}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls={`demo-panel-${step.id}`}
            tabIndex={index === active ? 0 : -1}
            className={styles.tab}
            onClick={() => setActive(index)}
            onKeyDown={onKeyDown}
          >
            <span className={styles.tabNo} aria-hidden="true">
              {index + 1}
            </span>
            <span className={styles.tabLabel}>{step.label}</span>
            <span className={styles.tabTitle}>
              <Phrases text={step.title} />
            </span>
          </button>
        ))}
      </div>

      {/* Inactive panels stay mounted so what a visitor typed or clicked in
          one step is still there when they come back to it. */}
      {STEPS.map((step, index) => (
        <div
          key={step.id}
          id={`demo-panel-${step.id}`}
          role="tabpanel"
          aria-labelledby={`demo-tab-${step.id}`}
          hidden={index !== active}
          className={styles.panel}
        >
          <h3 className={styles.panelTitle}>
            <Phrases text={step.title} />
          </h3>
          {step.panel}
          <dl className={styles.compare}>
            <div>
              <dt>在表格里</dt>
              <dd>{step.sheet}</dd>
            </div>
            <div>
              <dt>在百杰 CRM 里</dt>
              <dd>{step.here}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
