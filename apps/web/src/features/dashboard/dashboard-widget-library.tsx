import type { DashboardWidgetType } from "./dashboard-types";
import styles from "./dashboard-configuration.module.css";

const ITEMS: Array<{ type: DashboardWidgetType; label: string; action: string; hint: string }> = [
  { type: "METRIC", label: "指标卡", action: "添加指标卡", hint: "计数、求和或平均值" },
  { type: "STATUS_DISTRIBUTION", label: "状态分布", action: "添加状态分布", hint: "单选字段的分布或漏斗" },
  { type: "TREND", label: "趋势图", action: "添加趋势图", hint: "按日期字段观察变化" },
  { type: "LEADERBOARD", label: "员工业绩排行", action: "添加员工业绩排行", hint: "负责人或成员字段排行" },
  { type: "RECORD_LIST", label: "记录列表", action: "添加记录列表", hint: "链接到真实业务记录" },
];

export function DashboardWidgetLibrary({ onAdd, widgets }: { onAdd: (type: DashboardWidgetType) => void; widgets: Array<{ id: string; title: string }> }) {
  return <aside className={styles.library} aria-label="组件库"><div className={styles.railHeading}><span>组件库</span><small>五种可发布组件</small></div><div className={styles.libraryItems}>{ITEMS.map((item) => <button key={item.type} type="button" className={styles.libraryItem} onClick={() => onAdd(item.type)} aria-label={item.action}><strong>{item.label}</strong><span>{item.hint}</span><b>＋</b></button>)}</div><div className={styles.outline}><span>当前顺序</span>{widgets.length ? <ol>{widgets.map((widget) => <li key={widget.id}>{widget.title}</li>)}</ol> : <p>从上方添加组件。</p>}</div></aside>;
}
