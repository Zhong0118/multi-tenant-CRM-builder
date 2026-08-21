"use client";

import { Button, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
  FIELD_ACCESS_LABELS,
  fieldTypeLabel,
  type ObjectDraftField,
  type PublishedFieldAccess,
} from "./object-types";

import styles from "./objects.module.css";

export interface FieldLedgerProps {
  fields: ObjectDraftField[];
  titleFieldKey: string;
  onSelect: (field: ObjectDraftField) => void;
  onMove: (fieldId: string, direction: -1 | 1) => void;
  reordering?: boolean;
}

/**
 * The single signature element of the designer. One structural rule, one row
 * per field, merging display order, stable key, type, requirement and employee
 * access so a tenant administrator can scan the whole configuration at once.
 *
 * Order is changed with explicit move controls rather than drag only, so the
 * ledger stays operable by keyboard.
 */
export function FieldLedger({
  fields,
  titleFieldKey,
  onSelect,
  onMove,
  reordering = false,
}: FieldLedgerProps) {
  const columns: ColumnsType<ObjectDraftField> = [
    {
      title: "顺序",
      key: "order",
      width: 84,
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
      key: "field",
      render: (_, fieldRow) => (
        <div className={styles.ledgerLabel}>
          <strong>{fieldRow.label}</strong>
          <span className={styles.stableKey}>{fieldRow.fieldKey}</span>
        </div>
      ),
    },
    {
      title: "类型",
      key: "type",
      width: 110,
      render: (_, fieldRow) => fieldTypeLabel(fieldRow.type),
    },
    {
      title: "必填",
      key: "required",
      width: 84,
      render: (_, fieldRow) => (fieldRow.required ? "必填" : "可选"),
    },
    {
      title: "员工访问",
      key: "access",
      width: 110,
      render: (_, fieldRow) =>
        FIELD_ACCESS_LABELS[fieldRow.employeeAccess as PublishedFieldAccess],
    },
    {
      title: "状态",
      key: "status",
      width: 132,
      render: (_, fieldRow) => (
        <>
          {fieldRow.fieldKey === titleFieldKey ? <Tag>标题字段</Tag> : null}
          {fieldRow.status === "INACTIVE" ? <Tag>已停用</Tag> : null}
          {fieldRow.publishedType === null ? (
            <Tag color="gold">未发布</Tag>
          ) : null}
        </>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 96,
      render: (_, fieldRow) => (
        <Button
          type="link"
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
      size="middle"
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
