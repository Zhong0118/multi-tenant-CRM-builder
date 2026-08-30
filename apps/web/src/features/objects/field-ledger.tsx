"use client";

import { HolderOutlined } from "@ant-design/icons";
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
import { Button, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  createContext,
  useContext,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";

import {
  FIELD_ACCESS_LABELS,
  fieldTypeLabel,
  type PublishedFieldAccess,
} from "./object-types";
import type { ConfigurableFieldView } from "./configuration-view";

import styles from "./objects.module.css";

export interface FieldLedgerProps {
  fields: ConfigurableFieldView[];
  titleFieldKey: string;
  onSelect: (field: ConfigurableFieldView) => void;
  onReorder: (fieldIds: string[]) => void;
  onToggleStatus?: (field: ConfigurableFieldView) => void;
  reordering?: boolean;
}

interface SortableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  "data-row-key": string;
}

interface SortableRowContextValue {
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
}

const SortableRowContext = createContext<SortableRowContextValue | null>(null);

function SortableRow(props: SortableRowProps) {
  const id = props["data-row-key"];
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
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <SortableRowContext.Provider
      value={{ attributes, listeners, setActivatorNodeRef }}
    >
      <tr
        {...props}
        ref={setNodeRef}
        style={style}
        className={`${props.className ?? ""} ${isDragging ? styles.ledgerRowDragging : ""}`}
      />
    </SortableRowContext.Provider>
  );
}

interface DragHandleProps {
  label: string;
  disabled: boolean;
  index: number;
  onKeyboardMove: (from: number, direction: -1 | 1) => void;
}

function DragHandle({
  label,
  disabled,
  index,
  onKeyboardMove,
}: DragHandleProps) {
  const sortable = useContext(SortableRowContext);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onKeyboardMove(index, event.key === "ArrowUp" ? -1 : 1);
  }

  return (
    <Tooltip title="拖动调整顺序；键盘可使用上下方向键">
      <button
        ref={sortable?.setActivatorNodeRef}
        type="button"
        className={styles.dragHandle}
        aria-label={`拖动调整 ${label}`}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        {...sortable?.attributes}
        {...sortable?.listeners}
      >
        <HolderOutlined aria-hidden />
      </button>
    </Tooltip>
  );
}

const ACCESS_COLORS: Record<PublishedFieldAccess, string> = {
  EDIT: "green",
  READ_ONLY: "blue",
  HIDDEN: "red",
};

/** A compact configuration table whose row order is itself part of the schema. */
export function FieldLedger({
  fields,
  titleFieldKey,
  onSelect,
  onReorder,
  onToggleStatus,
  reordering = false,
}: FieldLedgerProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const fieldIds = fields.map((field) => field.id);

  function moveFromKeyboard(from: number, direction: -1 | 1) {
    const to = from + direction;
    if (reordering || to < 0 || to >= fields.length) return;
    onReorder(arrayMove(fieldIds, from, to));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (reordering || !over || active.id === over.id) return;
    const from = fieldIds.indexOf(String(active.id));
    const to = fieldIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(fieldIds, from, to));
  }

  const columns: ColumnsType<ConfigurableFieldView> = [
    {
      title: "顺序",
      key: "order",
      width: 60,
      align: "center",
      render: (_, fieldRow, index) => (
        <DragHandle
          label={fieldRow.label}
          disabled={reordering}
          index={index}
          onKeyboardMove={moveFromKeyboard}
        />
      ),
    },
    {
      title: "字段",
      key: "label",
      render: (_, fieldRow) => (
        <span className={styles.ledgerName}>{fieldRow.label}</span>
      ),
    },
    {
      title: "字段键",
      key: "fieldKey",
      width: 180,
      render: (_, fieldRow) => (
        <span className={styles.stableKey}>{fieldRow.fieldKey}</span>
      ),
    },
    {
      title: "类型",
      key: "type",
      width: 96,
      render: (_, fieldRow) => fieldTypeLabel(fieldRow.type),
    },
    {
      title: "必填",
      key: "required",
      width: 72,
      render: (_, fieldRow) =>
        fieldRow.required ? (
          <span className={styles.ledgerRequired}>必填</span>
        ) : (
          <span className={styles.ledgerMuted}>可选</span>
        ),
    },
    {
      title: "员工访问",
      key: "access",
      width: 96,
      render: (_, fieldRow) => {
        const access = fieldRow.employeeAccess as PublishedFieldAccess;
        return (
          <Tag color={ACCESS_COLORS[access]}>{FIELD_ACCESS_LABELS[access]}</Tag>
        );
      },
    },
    {
      title: "状态",
      key: "status",
      width: 180,
      render: (_, fieldRow) => (
        <span className={styles.ledgerFlags}>
          {fieldRow.fieldKey === titleFieldKey ? (
            <Tag color="blue">记录名称</Tag>
          ) : null}
          {fieldRow.status === "INACTIVE" ? (
            <Tag color="red">已停用</Tag>
          ) : null}
          {fieldRow.publishedType === null ? (
            <Tag color="gold">未发布</Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: onToggleStatus ? 132 : 72,
      align: "right",
      render: (_, fieldRow) => (
        <Space size={2}>
          {onToggleStatus ? (
            <Button
              type="link"
              size="small"
              aria-label={`${fieldRow.status === "ACTIVE" ? "停用" : "恢复"}字段 ${fieldRow.label}`}
              onClick={() => onToggleStatus(fieldRow)}
            >
              {fieldRow.status === "ACTIVE" ? "停用" : "恢复"}
            </Button>
          ) : null}
          <Button
            type="link"
            size="small"
            aria-label={`配置字段 ${fieldRow.label}`}
            onClick={() => onSelect(fieldRow)}
          >
            配置
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
        <Table
          className={styles.ledger}
          rowKey="id"
          size="small"
          pagination={false}
          columns={columns}
          dataSource={fields}
          components={{ body: { row: SortableRow } }}
          rowClassName={(fieldRow) =>
            fieldRow.status === "INACTIVE" ? styles.ledgerRowInactive : ""
          }
          aria-label="字段账本"
        />
      </SortableContext>
    </DndContext>
  );
}
