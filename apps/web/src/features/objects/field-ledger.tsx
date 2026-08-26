"use client";

import { Button, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";

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
  onMove: (fieldId: string, direction: -1 | 1) => void;
  reordering?: boolean;
}

/**
 * The single signature element of the designer: one continuous register where
 * each field occupies exactly one line, so display order, stable key, type,
 * requirement and employee access can be compared straight down the columns.
 *
 * Order changes through explicit move controls rather than drag alone, so the
 * ledger stays operable by keyboard.
 */
export function FieldLedger({
  fields,
  titleFieldKey,
  onSelect,
  onMove,
  reordering = false,
}: FieldLedgerProps) {
  const columns: ColumnsType<ConfigurableFieldView> = [
    {
      title: "",
      key: "order",
      width: 64,
      render: (_, fieldRow, index) => (
        <div className={styles.ledgerOrder}>
          <Tooltip title={`上移 ${fieldRow.label}`}>
            <Button
              size="small"
              type="text"
              aria-label={`上移 ${fieldRow.label}`}
              disabled={index === 0 || reordering}
              onClick={() => onMove(fieldRow.id, -1)}
            >
              ↑
            </Button>
          </Tooltip>
          <Tooltip title={`下移 ${fieldRow.label}`}>
            <Button
              size="small"
              type="text"
              aria-label={`下移 ${fieldRow.label}`}
              disabled={index === fields.length - 1 || reordering}
              onClick={() => onMove(fieldRow.id, 1)}
            >
              ↓
            </Button>
          </Tooltip>
        </div>
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
          <span className={access === "EDIT" ? undefined : styles.ledgerMuted}>
            {FIELD_ACCESS_LABELS[access]}
          </span>
        );
      },
    },
    {
      title: "状态",
      key: "status",
      width: 150,
      render: (_, fieldRow) => (
        <span className={styles.ledgerFlags}>
          {fieldRow.fieldKey === titleFieldKey ? <Tag>标题</Tag> : null}
          {fieldRow.status === "INACTIVE" ? <Tag>已停用</Tag> : null}
          {fieldRow.publishedType === null ? (
            <Tag color="gold">未发布</Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 72,
      align: "right",
      render: (_, fieldRow) => (
        <Button
          type="link"
          size="small"
          aria-label={`配置字段 ${fieldRow.label}`}
          onClick={() => onSelect(fieldRow)}
        >
          配置
        </Button>
      ),
    },
  ];

  return (
    <Table
      className={styles.ledger}
      rowKey="id"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={fields}
      rowClassName={(fieldRow) =>
        fieldRow.status === "INACTIVE" ? styles.ledgerRowInactive : ""
      }
      aria-label="字段账本"
    />
  );
}
