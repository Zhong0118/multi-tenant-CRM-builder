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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CopyOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
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
        <small>
          与发布后的布局一致：宽屏四列，较窄时两列，手机一列 · 拖动或用 ↑↓
          调整顺序
        </small>
      </div>
      {widgets.length ? (
        <DndContext
          // dnd-kit falls back to a module-level counter for its generated ids
          // when DndContext has no id, so the server and the client number the
          // drag handles differently and React reports a hydration mismatch on
          // every designer load. An explicit id makes the ids deterministic.
          id="dashboard-canvas"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={dragEnd}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <div className={styles.canvasGrid}>
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
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className={styles.emptyCanvas}>
          打开「添加组件」，开始编排工作台。
        </div>
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
      data-width={widget.width}
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
            title="编辑属性"
            aria-label={`编辑组件 ${widget.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(widget.id);
            }}
          >
            <EditOutlined aria-hidden />
          </button>
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
            <option value="QUARTER">1/4 宽</option>
            <option value="HALF">1/2 宽</option>
            <option value="FULL">整行</option>
          </select>
          <button
            type="button"
            title="复制"
            aria-label={`复制组件 ${widget.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onCopy(widget.id);
            }}
          >
            <CopyOutlined aria-hidden />
          </button>
          <button
            type="button"
            title="删除"
            data-danger
            aria-label={`删除组件 ${widget.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(widget.id);
            }}
          >
            <DeleteOutlined aria-hidden />
          </button>
        </div>
      </div>
      <h2>{widget.title}</h2>
      <p>
        {label(widget.type)} · {widget.objectCode || "尚未绑定业务表"}
      </p>
      <WidgetSketch type={widget.type} />
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
/** A quiet sketch of what the component draws, so the canvas reads as a layout. */
function WidgetSketch({ type }: { type: DashboardWidgetDraft["type"] }) {
  return (
    <div className={styles.sketch} data-type={type} aria-hidden>
      {type === "METRIC" ? <span className={styles.sketchNumber} /> : null}
      {type === "STATUS_DISTRIBUTION" || type === "LEADERBOARD"
        ? [80, 56, 38, 22].map((width) => (
            <span
              key={width}
              className={styles.sketchBar}
              style={{ width: `${width}%` }}
            />
          ))
        : null}
      {type === "TREND" ? (
        <svg
          viewBox="0 0 100 32"
          preserveAspectRatio="none"
          className={styles.sketchLine}
        >
          <polyline points="0,26 18,20 34,22 52,12 70,15 86,6 100,9" />
        </svg>
      ) : null}
      {type === "RECORD_LIST"
        ? [0, 1, 2].map((row) => (
            <span key={row} className={styles.sketchRow} />
          ))
        : null}
    </div>
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
