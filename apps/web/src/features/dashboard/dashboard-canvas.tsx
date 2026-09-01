"use client";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  DashboardConfigurationIssue,
  DashboardWidgetDraft,
} from "./dashboard-types";
import styles from "./dashboard-configuration.module.css";

export function DashboardCanvas({
  widgets,
  selectedId,
  issues,
  onSelect,
  onIssue,
  onCopy,
  onDelete,
  onWidth,
  onMove,
}: {
  widgets: DashboardWidgetDraft[];
  selectedId?: string;
  issues: DashboardConfigurationIssue[];
  onSelect: (id: string) => void;
  onIssue: (id: string, path: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onWidth: (id: string, width: DashboardWidgetDraft["width"]) => void;
  onMove: (from: number, to: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = widgets.map((widget) => widget.id);
  function dragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  }
  return (
    <main className={styles.canvas} aria-label="工作台画布">
      <div className={styles.canvasHeading}>
        <span>草稿画布</span>
        <small>拖拽调整顺序</small>
      </div>
      {widgets.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={dragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {widgets.map((widget, index) => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                index={index}
                total={widgets.length}
                selected={selectedId === widget.id}
                issues={issues.filter((issue) =>
                  issue.path.startsWith(`widgets[${index}]`),
                )}
                onSelect={onSelect}
                onIssue={onIssue}
                onCopy={onCopy}
                onDelete={onDelete}
                onWidth={onWidth}
                onMove={onMove}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        <div className={styles.emptyCanvas}>选择左侧组件，开始编排工作台。</div>
      )}
    </main>
  );
}
function WidgetCard({
  widget,
  index,
  total,
  selected,
  issues,
  onSelect,
  onIssue,
  onCopy,
  onDelete,
  onWidth,
  onMove,
}: {
  widget: DashboardWidgetDraft;
  index: number;
  total: number;
  selected: boolean;
  issues: DashboardConfigurationIssue[];
  onSelect: (id: string) => void;
  onIssue: (id: string, path: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onWidth: (id: string, width: DashboardWidgetDraft["width"]) => void;
  onMove: (from: number, to: number) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition } =
    useSortable({ id: widget.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`${styles.widgetCard} ${selected ? styles.widgetSelected : ""}`}
      aria-label={`${widget.title} 组件`}
      onClick={() => onSelect(widget.id)}
    >
      <div className={styles.widgetToolbar}>
        <button
          type="button"
          className={styles.dragHandle}
          aria-label={`拖动组件 ${widget.title}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div>
          <button
            type="button"
            aria-label={`上移组件 ${widget.title}`}
            disabled={index === 0}
            onClick={(event) => {
              event.stopPropagation();
              onMove(index, index - 1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`下移组件 ${widget.title}`}
            disabled={index === total - 1}
            onClick={(event) => {
              event.stopPropagation();
              onMove(index, index + 1);
            }}
          >
            ↓
          </button>
          <select
            aria-label={`组件宽度 ${widget.title}`}
            value={widget.width}
            onChange={(event) =>
              onWidth(
                widget.id,
                event.target.value as DashboardWidgetDraft["width"],
              )
            }
          >
            <option value="QUARTER">1/4</option>
            <option value="HALF">1/2</option>
            <option value="FULL">整行</option>
          </select>
          <button
            type="button"
            aria-label={`复制组件 ${widget.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onCopy(widget.id);
            }}
          >
            复制
          </button>
          <button
            type="button"
            aria-label={`删除组件 ${widget.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(widget.id);
            }}
          >
            删除
          </button>
        </div>
      </div>
      <h2>{widget.title}</h2>
      <p>
        {label(widget.type)} · {widget.objectCode || "尚未绑定业务表"}
      </p>
      {issues.map((issue) => (
        <button
          key={`${issue.path}:${issue.message}`}
          type="button"
          className={styles.inlineIssue}
          aria-label={`查看问题 ${issue.message}`}
          onClick={(event) => {
            event.stopPropagation();
            onIssue(widget.id, issue.path);
          }}
        >
          上次校验：{issue.message}
        </button>
      ))}
    </article>
  );
}
function label(type: DashboardWidgetDraft["type"]) {
  return {
    METRIC: "指标卡",
    STATUS_DISTRIBUTION: "状态分布",
    TREND: "趋势图",
    LEADERBOARD: "员工业绩排行",
    RECORD_LIST: "记录列表",
  }[type];
}
