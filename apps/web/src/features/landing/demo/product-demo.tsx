"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { LogoMark } from "../logo-mark";
import { AiScenario } from "./ai-scenario";
import { ADMIN, DEMO_COMPANY, STAFF, type Viewer } from "./demo-data";
import { FollowUpScenario } from "./follow-up-scenario";
import { ImportScenario } from "./import-scenario";
import { PoolScenario } from "./pool-scenario";
import { TeamScenario } from "./team-scenario";
import styles from "./demo.module.css";

export type ScenarioId = "import" | "pool" | "follow-up" | "team" | "ai";

interface Scenario {
  id: ScenarioId;
  label: string;
  summary: string;
  module: string;
  viewer: Viewer;
  nav: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "import",
    label: "导入与整理",
    summary: "把 Excel 名单导进客户表，先检查再写入。",
    module: "客户 · 导入",
    viewer: ADMIN,
    nav: "客户",
  },
  {
    id: "pool",
    label: "分配与领取",
    summary: "线索放进公海，领取后限时联系。",
    module: "客户 · 线索公海",
    viewer: STAFF,
    nav: "客户",
  },
  {
    id: "follow-up",
    label: "跟进与提醒",
    summary: "今天要做什么、什么到期，打开就知道。",
    module: "我的工作台",
    viewer: STAFF,
    nav: "我的工作台",
  },
  {
    id: "team",
    label: "团队进展",
    summary: "按系统记录看每个人的工作，直接安排任务。",
    module: "团队动态",
    viewer: ADMIN,
    nav: "团队动态",
  },
  {
    id: "ai",
    label: "AI 问答",
    summary: "用中文问业务数据，改动先由你确认。",
    module: "AI 助手",
    viewer: STAFF,
    nav: "AI 助手",
  },
];

const NAV = {
  admin: ["管理工作台", "跟进待办", "任务与日报", "团队动态", "AI 助手"],
  staff: ["我的工作台", "跟进待办", "任务与日报", "AI 助手"],
};
const TABLES = ["客户", "商机", "合同"];

const SIDE_LAYOUT = "(min-width: 1024px)";

function subscribeLayout(onChange: () => void) {
  const media = window.matchMedia(SIDE_LAYOUT);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function ProductDemo() {
  const [active, setActive] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [touched, setTouched] = useState(false);
  const [importedToPool, setImportedToPool] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const vertical = useSyncExternalStore(
    subscribeLayout,
    () => window.matchMedia(SIDE_LAYOUT).matches,
    () => true,
  );
  const scenario = SCENARIOS[active];

  // On narrow screens the scenarios scroll sideways; keep the selected one
  // in view without moving the page vertically.
  useEffect(() => {
    const tab = tabRefs.current[active];
    const list = tab?.parentElement;
    if (!tab || !list || list.scrollWidth <= list.clientWidth) return;
    const left = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    list.scrollTo({
      left: Math.max(0, left),
      behavior: reduce ? "auto" : "smooth",
    });
  }, [active]);
  const touch = useCallback(() => setTouched(true), []);

  const select = (index: number, focus = false) => {
    const next = (index + SCENARIOS.length) % SCENARIOS.length;
    setActive(next);
    if (focus) tabRefs.current[next]?.focus();
  };

  const goTo = (id: ScenarioId) =>
    select(SCENARIOS.findIndex((item) => item.id === id));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowDown: active + 1,
      ArrowLeft: active - 1,
      ArrowUp: active - 1,
      Home: 0,
      End: SCENARIOS.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(keys[event.key], true);
  };

  const reset = () => {
    setResetKey((key) => key + 1);
    setImportedToPool(false);
    setTouched(false);
  };

  const nav = NAV[scenario.viewer.role];

  return (
    <div className={styles.demo}>
      <div className={styles.picker}>
        <div
          role="tablist"
          aria-label="使用场景"
          aria-orientation={vertical ? "vertical" : "horizontal"}
          className={styles.tabs}
        >
          {SCENARIOS.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`scenario-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-controls={`scenario-panel-${item.id}`}
              tabIndex={index === active ? 0 : -1}
              className={styles.tab}
              onClick={() => select(index)}
              onKeyDown={onKeyDown}
            >
              <span className={styles.tabNo} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.tabText}>
                <span className={styles.tabLabel}>{item.label}</span>
                <span className={styles.tabSummary}>{item.summary}</span>
              </span>
            </button>
          ))}
        </div>
        <div className={styles.pickerFoot}>
          <p>
            示例数据为虚构的「{DEMO_COMPANY}」，只在你的浏览器里运行，不会保存。
          </p>
          <button
            type="button"
            className={styles.resetButton}
            onClick={reset}
            disabled={!touched}
          >
            重置演示
          </button>
        </div>
      </div>

      <div className={styles.window}>
        <div className={styles.windowBar}>
          <span className={styles.windowBrand}>
            <LogoMark className={styles.windowMark} />
            {DEMO_COMPANY}
          </span>
          <span className={styles.windowPath} aria-hidden="true">
            {scenario.module}
          </span>
          <span className={styles.windowUser}>
            <span className={styles.avatar} aria-hidden="true">
              {scenario.viewer.name.slice(0, 1)}
            </span>
            {scenario.viewer.name}
            <small>
              {scenario.viewer.role === "admin" ? "公司管理员" : "员工"}
            </small>
          </span>
        </div>
        <div className={styles.windowBody}>
          <nav className={styles.side} aria-label="演示工作区导航">
            {nav.map((item) => (
              <span
                key={item}
                data-current={item === scenario.nav || undefined}
              >
                {item}
              </span>
            ))}
            <span className={styles.sideGroup}>业务表</span>
            {TABLES.map((item) => (
              <span
                key={item}
                data-current={item === scenario.nav || undefined}
              >
                {item}
              </span>
            ))}
          </nav>
          {/* Every scenario stays mounted so what a visitor did in one is
              still there when they come back. Reset remounts them all. */}
          <div className={styles.stage} key={resetKey}>
            {SCENARIOS.map((item, index) => (
              <section
                key={item.id}
                id={`scenario-panel-${item.id}`}
                role="tabpanel"
                aria-labelledby={`scenario-tab-${item.id}`}
                hidden={index !== active}
                className={styles.panel}
              >
                {item.id === "import" ? (
                  <ImportScenario
                    onTouch={touch}
                    onImported={setImportedToPool}
                    onOpenPool={() => goTo("pool")}
                  />
                ) : item.id === "pool" ? (
                  <PoolScenario
                    onTouch={touch}
                    importedToPool={importedToPool}
                  />
                ) : item.id === "follow-up" ? (
                  <FollowUpScenario onTouch={touch} />
                ) : item.id === "team" ? (
                  <TeamScenario onTouch={touch} />
                ) : (
                  <AiScenario onTouch={touch} />
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
