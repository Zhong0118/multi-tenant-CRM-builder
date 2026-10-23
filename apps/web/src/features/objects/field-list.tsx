"use client";

import {
  AlignLeftOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  DownCircleOutlined,
  FontSizeOutlined,
  HolderOutlined,
  MailOutlined,
  NumberOutlined,
  PhoneOutlined,
  UnorderedListOutlined,
  UserOutlined,
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
import { Tooltip } from "antd";
import {
  useEffect,
  useRef,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import {
  FIELD_ACCESS_LABELS,
  fieldTypeLabel,
  type PublishedFieldAccess,
  type PublishedFieldType,
} from "./object-types";
import type { ConfigurableFieldView } from "./configuration-view";

import styles from "./objects.module.css";

const TYPE_ICONS: Record<PublishedFieldType, ComponentType<{ "aria-hidden"?: boolean }>> = {
  TEXT: FontSizeOutlined,
  TEXTAREA: AlignLeftOutlined,
  NUMBER: NumberOutlined,
  MONEY: DollarOutlined,
  DATE: CalendarOutlined,
  DATETIME: ClockCircleOutlined,
  BOOLEAN: CheckSquareOutlined,
  SINGLE_SELECT: DownCircleOutlined,
  MULTI_SELECT: UnorderedListOutlined,
  PHONE: PhoneOutlined,
  EMAIL: MailOutlined,
  MEMBER: UserOutlined,
};

/** A field type's glyph, drawn the same in the list and above the editor. */
export function FieldTypeBadge({ type }: { type: PublishedFieldType }) {
  const Icon = TYPE_ICONS[type] ?? FontSizeOutlined;
  return (
    <span className={styles.fieldTypeBadge}>
      <Icon aria-hidden />
    </span>
  );
}

export interface FieldListProps {
  fields: ConfigurableFieldView[];
  titleFieldKey: string;
  selectedId: string | null;
  onSelect: (field: ConfigurableFieldView) => void;
  onReorder: (fieldIds: string[]) => void;
  reordering?: boolean;
}

/**
 * The fields of one business table as a list the member can scan and reorder.
 * Row order is part of the schema, so each row has a drag handle that also
 * answers the arrow keys. The row itself selects the field for editing.
 */
export function FieldList({
  fields,
  titleFieldKey,
  selectedId,
  onSelect,
  onReorder,
  reordering = false,
}: FieldListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const fieldIds = fields.map((field) => field.id);
  const list = useRef<HTMLUListElement>(null);
  const refocus = useRef<string | null>(null);

  function reorder(next: string[], movedId: string) {
    refocus.current = movedId;
    onReorder(next);
  }

  function moveFromKeyboard(from: number, direction: -1 | 1) {
    const to = from + direction;
    if (reordering || to < 0 || to >= fields.length) return;
    reorder(arrayMove(fieldIds, from, to), fieldIds[from]);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (reordering || !over || active.id === over.id) return;
    const from = fieldIds.indexOf(String(active.id));
    const to = fieldIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    reorder(arrayMove(fieldIds, from, to), String(active.id));
  }

  // Moving a row re-inserts it in the document, which drops keyboard focus.
  // Put it back on the handle that was used so the next arrow press continues.
  const order = fieldIds.join(",");
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    list.current
      ?.querySelector<HTMLElement>(`[data-handle-for="${escapeAttribute(id)}"]`)
      ?.focus();
  }, [order]);

  if (fields.length === 0) {
    return <p className={styles.fieldListEmpty}>还没有字段。点击「新增字段」添加第一个。</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
        <ul className={styles.fieldList} aria-label="字段清单" ref={list}>
          {fields.map((field, index) => (
            <FieldListItem
              key={field.id}
              field={field}
              index={index}
              titleFieldKey={titleFieldKey}
              selected={field.id === selectedId}
              reordering={reordering}
              onSelect={onSelect}
              onKeyboardMove={moveFromKeyboard}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function FieldListItem({
  field,
  index,
  titleFieldKey,
  selected,
  reordering,
  onSelect,
  onKeyboardMove,
}: {
  field: ConfigurableFieldView;
  index: number;
  titleFieldKey: string;
  selected: boolean;
  reordering: boolean;
  onSelect: (field: ConfigurableFieldView) => void;
  onKeyboardMove: (from: number, direction: -1 | 1) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };
  const access = field.employeeAccess as PublishedFieldAccess;
  const inactive = field.status === "INACTIVE";

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onKeyboardMove(index, event.key === "ArrowUp" ? -1 : 1);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        styles.fieldListItem,
        selected ? styles.fieldListItemSelected : "",
        inactive ? styles.fieldListItemInactive : "",
        isDragging ? styles.fieldListItemDragging : "",
      ].join(" ")}
    >
      <Tooltip title="拖动调整顺序；键盘可使用上下方向键">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={styles.dragHandle}
          aria-label={`拖动调整 ${field.label}`}
          data-handle-for={field.id}
          disabled={reordering}
          onKeyDown={handleKeyDown}
          {...attributes}
          {...listeners}
        >
          <HolderOutlined aria-hidden />
        </button>
      </Tooltip>
      <button
        type="button"
        className={styles.fieldListSelect}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(field)}
      >
        <FieldTypeBadge type={field.type} />
        <span className={styles.fieldListText}>
          <span className={styles.fieldListHead}>
            <span className={styles.fieldListName}>{field.label}</span>
            <span className={styles.fieldListFlags}>
              {field.fieldKey === titleFieldKey ? (
                <span className={styles.fieldFlag}>记录名称</span>
              ) : null}
              {field.required ? (
                <span className={`${styles.fieldFlag} ${styles.fieldFlagRequired}`}>
                  必填
                </span>
              ) : null}
              {field.publishedType === null ? (
                <span className={`${styles.fieldFlag} ${styles.fieldFlagDraft}`}>
                  未发布
                </span>
              ) : null}
              {inactive ? <span className={styles.fieldFlag}>已停用</span> : null}
            </span>
          </span>
          <span className={styles.fieldListMeta}>
            <span className={styles.stableKey}>{field.fieldKey}</span>
            <span>{fieldTypeLabel(field.type)}</span>
            <span>员工{FIELD_ACCESS_LABELS[access]}</span>
          </span>
        </span>
      </button>
    </li>
  );
}
