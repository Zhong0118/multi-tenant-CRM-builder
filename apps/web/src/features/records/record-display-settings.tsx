"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  HolderOutlined,
} from "@ant-design/icons";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Checkbox, Segmented, Select } from "antd";
import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { PublishedFieldView } from "@/features/objects/object-types";

import {
  fieldKeysOf,
  isSystemColumnId,
  SYSTEM_COLUMN_LABELS,
  systemColumnId,
  systemColumnKey,
} from "./record-column-order";
import {
  HEADER_TONES,
  READING_DENSITIES,
  type HeaderTone,
  type ReadingDensity,
  type RecordDisplayPrefs,
} from "./record-display-prefs";
import styles from "./record-list.module.css";

const DENSITY_TEXT_TYPES = new Set([
  "TEXT",
  "TEXTAREA",
  "EMAIL",
  "MULTI_SELECT",
]);

const OWNER_ID = systemColumnId("systemOwner");

/**
 * One place for how a member reads the table: reading density, header
 * colour, which columns and in what order (business fields and the table's
 * own columns alike), and per-column density where a column needs more or
 * less room. All of it is a personal preference in this browser: nothing is
 * published and the table, the company default and permissions stay as they
 * are.
 */
export function RecordDisplaySettings({
  fields,
  order,
  prefs,
  ownerChoice,
  onChange,
  onReset,
}: {
  /** Fields this member may see, in schema order. */
  fields: PublishedFieldView[];
  /** The shown columns in display order: field keys and `system:` ids. */
  order: string[];
  prefs: RecordDisplayPrefs;
  /** Whether the system owner column can be shown at all. */
  ownerChoice: boolean;
  onChange: (change: Partial<RecordDisplayPrefs>) => void;
  onReset: () => void;
}) {
  const shownFields = fieldKeysOf(order);
  const hidden = fields.filter(
    (field) => !shownFields.includes(field.fieldKey),
  );
  const ownerHidden = ownerChoice && !order.includes(OWNER_ID);
  const field = (key: string) => fields.find((item) => item.fieldKey === key);
  const label = (id: string) => {
    const system = systemColumnKey(id);
    return system ? SYSTEM_COLUMN_LABELS[system] : (field(id)?.label ?? id);
  };
  const reorder = (next: string[]) =>
    onChange({ order: next, columns: fieldKeysOf(next) });
  const hide = (id: string) => {
    const next = order.filter((item) => item !== id);
    if (id === OWNER_ID) onChange({ ownerVisible: false, order: next });
    else reorder(next);
  };
  const showField = (key: string) => {
    // A field shown again goes after the last shown field, as before system
    // columns could move.
    const lastField = order.reduce(
      (last, id, index) => (isSystemColumnId(id) ? last : index),
      -1,
    );
    const next = [...order];
    next.splice(lastField + 1, 0, key);
    reorder(next);
  };

  return (
    <div className={styles.displayPanel} role="group" aria-label="显示设置">
      <section className={styles.displaySection}>
        <h3 className={styles.displayHeading} id="display-density">
          阅读密度
        </h3>
        <Segmented
          block
          aria-labelledby="display-density"
          value={prefs.density}
          onChange={(density) =>
            onChange({ density: density as ReadingDensity })
          }
          options={READING_DENSITIES.map((option) => ({
            value: option.value,
            label: option.label,
            title: option.hint,
          }))}
        />
        <p className={styles.displayHint}>
          {
            READING_DENSITIES.find((option) => option.value === prefs.density)
              ?.hint
          }
          。列宽可在表头拖动调整，双击恢复。
        </p>
      </section>

      <section className={styles.displaySection}>
        <h3 className={styles.displayHeading} id="display-header-tone">
          表头配色
        </h3>
        <Segmented
          block
          aria-labelledby="display-header-tone"
          value={prefs.headerTone}
          onChange={(headerTone) =>
            onChange({ headerTone: headerTone as HeaderTone })
          }
          options={HEADER_TONES.map((tone) => ({
            value: tone.value,
            label: (
              <span className={styles.toneOption}>
                <span
                  aria-hidden
                  className={styles.toneSwatch}
                  data-header-tone={tone.value}
                />
                {tone.label}
              </span>
            ),
          }))}
        />
        <p className={styles.displayHint}>只改变这张表的表头颜色。</p>
      </section>

      <section className={styles.displaySection}>
        <h3 className={styles.displayHeading} id="display-columns">
          显示的列与顺序
        </h3>
        <p className={styles.displayHint}>
          拖动把手或用上下箭头调整顺序。表格最左的选择框和最右的操作按钮位置固定。
        </p>
        <SortableColumns
          order={order}
          label={label}
          onReorder={reorder}
          renderTools={(id) => {
            const type = field(id)?.type;
            return DENSITY_TEXT_TYPES.has(type ?? "") ? (
              <Select
                size="small"
                variant="borderless"
                aria-label={`${label(id)} 的阅读密度`}
                popupMatchSelectWidth={false}
                value={prefs.columnDensity[id] ?? "inherit"}
                onChange={(value: string) => {
                  const next = { ...prefs.columnDensity };
                  if (value === "inherit") delete next[id];
                  else next[id] = value as ReadingDensity;
                  onChange({ columnDensity: next });
                }}
                options={[
                  { value: "inherit", label: "跟随" },
                  ...READING_DENSITIES.map((option) => ({
                    value: option.value,
                    label: option.label,
                  })),
                ]}
              />
            ) : null;
          }}
          renderToggle={(id) => {
            if (id === OWNER_ID)
              return (
                <Checkbox
                  checked
                  aria-label="显示系统负责人"
                  onChange={() => hide(id)}
                >
                  {label(id)}
                </Checkbox>
              );
            if (isSystemColumnId(id))
              return (
                <span
                  className={styles.displayFixedName}
                  title="系统列，始终显示"
                >
                  {label(id)}
                </span>
              );
            return (
              <Checkbox
                checked
                disabled={shownFields.length === 1}
                aria-label={`显示列 ${label(id)}`}
                onChange={() => hide(id)}
              >
                {label(id)}
              </Checkbox>
            );
          }}
        />
        {hidden.length || ownerHidden ? (
          <>
            <h3 className={styles.displayHeading}>未显示</h3>
            <ul className={styles.displayColumns} aria-label="未显示的列">
              {hidden.map((item) => (
                <li key={item.fieldKey}>
                  <Checkbox
                    checked={false}
                    aria-label={`显示列 ${item.label}`}
                    onChange={() => showField(item.fieldKey)}
                  >
                    {item.label}
                  </Checkbox>
                </li>
              ))}
              {ownerHidden ? (
                <li>
                  <Checkbox
                    checked={false}
                    aria-label="显示系统负责人"
                    onChange={() => onChange({ ownerVisible: true })}
                  >
                    {label(OWNER_ID)}
                  </Checkbox>
                  <span className={styles.displaySystemTag}>系统</span>
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </section>

      <footer className={styles.displayFooter}>
        <span>
          以上都是你的个人显示偏好，只保存在这个浏览器、只对这张表生效；无需发布，不改变公司默认视图、业务表设置和权限。
        </span>
        <Button type="link" size="small" onClick={onReset}>
          恢复默认
        </Button>
      </footer>
    </div>
  );
}

/**
 * The shown columns as one list a member can drag, or move with the arrow
 * keys on a handle or the up and down buttons. The selection checkbox and
 * the row menu are not in it: they stay at the table's two ends.
 */
function SortableColumns({
  order,
  label,
  onReorder,
  renderToggle,
  renderTools,
}: {
  order: string[];
  label: (id: string) => string;
  onReorder: (next: string[]) => void;
  renderToggle: (id: string) => ReactNode;
  renderTools: (id: string) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const list = useRef<HTMLOListElement>(null);
  const refocus = useRef<{ id: string; control: string } | null>(null);

  function move(from: number, to: number, control: string) {
    if (to < 0 || to >= order.length || from === to) return;
    refocus.current = { id: order[from], control };
    onReorder(arrayMove(order, from, to));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    move(from, to, "handle");
  }

  // Moving a row re-inserts it, which drops focus: put it back on the control
  // that was used, or its neighbour once that control turns disabled at an end.
  const key = order.join(",");
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const row = list.current?.querySelector<HTMLElement>(
      `[data-column-id="${target.id.replace(/["\\]/g, "\\$&")}"]`,
    );
    const control = row?.querySelector<HTMLButtonElement>(
      `[data-move="${target.control}"]`,
    );
    if (control && !control.disabled) control.focus();
    else
      row
        ?.querySelector<HTMLButtonElement>("[data-move]:not(:disabled)")
        ?.focus();
  }, [key]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol
          className={styles.displayColumns}
          aria-labelledby="display-columns"
          ref={list}
        >
          {order.map((id, index) => (
            <SortableColumn
              key={id}
              id={id}
              label={label(id)}
              system={isSystemColumnId(id)}
              first={index === 0}
              last={index === order.length - 1}
              toggle={renderToggle(id)}
              tools={renderTools(id)}
              onMove={(delta, control) => move(index, index + delta, control)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableColumn({
  id,
  label,
  system,
  first,
  last,
  toggle,
  tools,
  onMove,
}: {
  id: string;
  label: string;
  system: boolean;
  first: boolean;
  last: boolean;
  toggle: ReactNode;
  tools: ReactNode;
  onMove: (delta: -1 | 1, control: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // The handle answers the arrow keys, as in the field designer.
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onMove(event.key === "ArrowUp" ? -1 : 1, "handle");
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-column-id={id}
      data-dragging={isDragging ? "true" : undefined}
      className={styles.displayColumn}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.displayHandle}
        aria-label={`拖动调整 ${label} 的位置`}
        title="拖动调整顺序；也可用上下方向键"
        data-move="handle"
        onKeyDown={handleKeyDown}
        {...attributes}
        {...listeners}
      >
        <HolderOutlined aria-hidden />
      </button>
      <span className={styles.displayColumnName}>
        {toggle}
        {system ? (
          <span className={styles.displaySystemTag}>
            {id === OWNER_ID ? "系统" : "系统 · 始终显示"}
          </span>
        ) : null}
      </span>
      <span className={styles.displayColumnTools}>
        {tools}
        <Button
          type="text"
          size="small"
          aria-label={`上移 ${label}`}
          data-move="up"
          icon={<ArrowUpOutlined aria-hidden />}
          disabled={first}
          onClick={() => onMove(-1, "up")}
        />
        <Button
          type="text"
          size="small"
          aria-label={`下移 ${label}`}
          data-move="down"
          icon={<ArrowDownOutlined aria-hidden />}
          disabled={last}
          onClick={() => onMove(1, "down")}
        />
      </span>
    </li>
  );
}
