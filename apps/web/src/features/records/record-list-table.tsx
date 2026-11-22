"use client";

import { Button, Table, type TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { HTMLAttributes, ReactNode } from "react";

import {
  SORTABLE_FIELD_TYPES,
  type PublishedFieldView,
  type RecordSummary,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import type { DynamicFieldMember } from "./dynamic-field";
import { recordFields } from "./record-access";
import { RecordCellValue } from "./record-cell";
import { RecordColumnHeader } from "./record-column-header";
import {
  clampToBounds,
  fieldColumnBounds,
  SYSTEM_COLUMN_BOUNDS,
  type ColumnBounds,
} from "./record-column-layout";
import {
  systemColumnKey,
  SYSTEM_COLUMN_LABELS,
  type SystemColumnKey,
} from "./record-column-order";
import { RecordCommunicationPreview } from "./record-communication-drawer";
import { formatDateTime, RecordOwner } from "./record-display-value";
import { RecordPoolStatus } from "./record-pool";
import type { RecordPoolConfig } from "./record-pool-types";
import type { RecordQuery } from "./record-query-state";
import { ResizableHeaderCell } from "./resizable-columns";
import type { useRecordListLayout } from "./use-record-list-layout";
import rl from "./record-list.module.css";
import styles from "./records.module.css";

type RecordColumn = ColumnsType<RecordSummary>[number];
interface RecordListTableProps {
  schema: RuntimeObjectSchema;
  layout: ReturnType<typeof useRecordListLayout>["table"];
  rows: RecordSummary[];
  loading: boolean;
  members: DynamicFieldMember[];
  currentMemberId?: string;
  poolConfig?: RecordPoolConfig;
  query: RecordQuery;
  queryableFields: PublishedFieldView[];
  apply: (query: RecordQuery) => void;
  rowSelection: TableProps<RecordSummary>["rowSelection"];
  emptyState: ReactNode;
  recordPath: (recordId: string) => string;
  go: (path: string) => void;
  canCommunicate: (row: RecordSummary) => boolean;
  onCommunicate: (row: RecordSummary) => void;
  onActivity: (row: RecordSummary) => void;
  rowMenu: (row: RecordSummary) => ReactNode;
  nextContact: (value?: string | null) => ReactNode;
}

export function RecordListTable({
  schema,
  layout,
  rows,
  loading,
  members,
  currentMemberId,
  poolConfig,
  query,
  queryableFields,
  apply,
  rowSelection,
  emptyState,
  recordPath,
  go,
  canCommunicate,
  onCommunicate,
  onActivity,
  rowMenu,
  nextContact,
}: RecordListTableProps) {
  const {
    prefs,
    visibleColumns,
    titleField,
    tableOrder,
    setColumnWidth,
    hasView,
  } = layout;
  const sortableFields = new Set(
    visibleColumns
      .filter(
        (field) =>
          queryableFields.some(
            (candidate) => candidate.fieldKey === field.fieldKey,
          ) && (SORTABLE_FIELD_TYPES as readonly string[]).includes(field.type),
      )
      .map((field) => field.fieldKey),
  );
  function sortOrder(key: string) {
    if (query.sort !== key) return null;
    return query.direction === "asc" ? "ascend" : "descend";
  }
  const columnBounds: Record<string, ColumnBounds> = {
    ...SYSTEM_COLUMN_BOUNDS,
  };
  for (const field of visibleColumns) {
    columnBounds[field.fieldKey] = fieldColumnBounds(
      field.type,
      field.fieldKey === schema.object.titleFieldKey,
    );
  }
  const columnWidth = (key: string) => {
    const bounds = columnBounds[key];
    return clampToBounds(prefs.widths[key] ?? bounds.width, bounds);
  };
  const columnDensity = (key: string) =>
    prefs.columnDensity[key] ?? prefs.density;

  function communicationButton(row: RecordSummary) {
    return canCommunicate(row) ? (
      <Button
        size="small"
        type="link"
        className={rl.directAction}
        onClick={() => onCommunicate(row)}
      >
        整理沟通
      </Button>
    ) : null;
  }

  const fieldColumn = (field: PublishedFieldView): RecordColumn => {
    const sortable = sortableFields.has(field.fieldKey);
    const width = columnWidth(field.fieldKey);
    const density = columnDensity(field.fieldKey);
    return {
      title: <RecordColumnHeader label={field.label} type={field.type} />,
      key: field.fieldKey,
      fixed: field === titleField ? "start" : undefined,
      width,
      align:
        field.type === "MONEY" || field.type === "NUMBER" ? "right" : "left",
      sorter: sortable || undefined,
      sortOrder: sortable ? sortOrder(field.fieldKey) : null,
      sortDirections: sortable ? ["ascend", "descend"] : undefined,
      render: (_: unknown, row: RecordSummary) =>
        !recordFields(schema, row).some(
          (candidate) => candidate.fieldKey === field.fieldKey,
        ) ? null : field === titleField ? (
          <div className={rl.titleCell}>
            <a
              className={`${styles.recordTitle} ${rl.titleLink}`}
              title={row.title}
              href={recordPath(row.id)}
              onClick={(event) => {
                event.preventDefault();
                go(recordPath(row.id));
              }}
            >
              {row.title}
            </a>
            {communicationButton(row)}
          </div>
        ) : (
          <div className={rl.boundedCell}>
            <RecordCellValue
              field={field}
              value={row.values[field.fieldKey]}
              members={members}
              density={density}
              tablePreview
              width={width}
              recordTitle={row.title}
              currentMemberId={currentMemberId}
            />
          </div>
        ),
    };
  };
  // The record's own columns. Which of them show keeps its conditions (owner
  // when the member can see others' records and chose to, pool status when
  // the pool is on); the member's order only arranges them among the fields.
  const systemColumns: Record<SystemColumnKey, RecordColumn> = {
    recordNo: {
      title: "业务编号",
      key: "recordNo",
      dataIndex: "recordNo",
      width: columnWidth("recordNo"),
      sorter: true,
      sortOrder: sortOrder("recordNo"),
      sortDirections: ["ascend", "descend"],
      render: (recordNo: string) => (
        <span className={styles.recordNo}>{recordNo}</span>
      ),
    },
    systemOwner: {
      title: "负责人",
      key: "systemOwner",
      width: columnWidth("systemOwner"),
      render: (_: unknown, row: RecordSummary) => (
        <RecordOwner
          ownerMemberId={row.ownerMemberId}
          members={members}
          currentMemberId={currentMemberId}
        />
      ),
    },
    poolStatus: {
      title: "归属状态",
      key: "poolStatus",
      width: columnWidth("poolStatus"),
      render: (_: unknown, row: RecordSummary) =>
        poolConfig ? (
          <div className={rl.boundedCell}>
            <RecordPoolStatus record={row} config={poolConfig} compact />
          </div>
        ) : null,
    },
    nextFollowUpAt: {
      key: "nextFollowUpAt",
      title: "下次跟进",
      width: columnWidth("nextFollowUpAt"),
      sorter: true,
      sortOrder: sortOrder("nextFollowUpAt"),
      render: (_, row) => nextContact(row.nextFollowUpAt),
    },
    latestActivity: {
      title: "最近沟通",
      key: "latestActivity",
      width: columnWidth("latestActivity"),
      render: (_: unknown, row: RecordSummary) => (
        <RecordCommunicationPreview
          record={row}
          onOpen={() => onActivity(row)}
        />
      ),
    },
    updatedAt: {
      title: "最近更新",
      key: "updatedAt",
      dataIndex: "updatedAt",
      width: columnWidth("updatedAt"),
      sorter: true,
      sortOrder: sortOrder("updatedAt"),
      sortDirections: ["ascend", "descend"],
      render: (updatedAt: string) => (
        <span className={rl.noWrap}>{formatDateTime(updatedAt)}</span>
      ),
    },
  };
  const columns: ColumnsType<RecordSummary> = [
    ...tableOrder
      .map((id) => {
        const system = systemColumnKey(id);
        if (system) return systemColumns[system];
        const field = visibleColumns.find((item) => item.fieldKey === id);
        return field ? fieldColumn(field) : null;
      })
      .filter((column): column is RecordColumn => column !== null),
    {
      // The header is read by assistive technology only; the menu button is self-explanatory.
      title: <span className={styles.visuallyHidden}>操作</span>,
      key: "actions",
      width: rows.some(canCommunicate) ? 118 : 48,
      fixed: "end",
      align: "right",
      render: (_, row) => (
        <div className={rl.rowActions}>
          {communicationButton(row)}
          {rowMenu(row)}
        </div>
      ),
    },
  ];

  const handleTableChange: TableProps<RecordSummary>["onChange"] = (
    _pagination,
    _filters,
    sorter,
    extra,
  ) => {
    if (extra.action !== "sort" || Array.isArray(sorter)) {
      return;
    }
    if (!sorter.order) {
      apply({
        ...query,
        page: 1,
        sort: schema.defaultView.sort.field,
        direction: schema.defaultView.sort.direction,
      });
      return;
    }
    const sort = String(sorter.columnKey ?? "");
    if (
      !sortableFields.has(sort) &&
      !["recordNo", "updatedAt", "nextFollowUpAt"].includes(sort)
    )
      return;
    apply({
      ...query,
      page: 1,
      sort,
      direction: sorter.order === "ascend" ? "asc" : "desc",
    });
  };
  const columnLabel = (key: string) =>
    key in SYSTEM_COLUMN_LABELS
      ? SYSTEM_COLUMN_LABELS[key as SystemColumnKey]
      : (schema.fields.find((field) => field.fieldKey === key)?.label ?? key);
  const resizableColumns: ColumnsType<RecordSummary> = columns.map((column) => {
    const key = String(column.key);
    const bounds = columnBounds[key];
    if (key === "actions" || !bounds) return column;
    const width =
      typeof column.width === "number" ? column.width : bounds.width;
    return {
      ...column,
      onHeaderCell: () =>
        ({
          "aria-label": columnLabel(key),
          width,
          minWidth: hasView ? Math.max(88, bounds.min) : bounds.min,
          maxWidth: hasView ? Math.min(640, bounds.max) : bounds.max,
          resizeLabel: `拖动调整「${columnLabel(key)}」列宽，双击恢复`,
          onResize: (next: number) => setColumnWidth(key, next),
          onResizeReset: () => setColumnWidth(key, undefined),
        }) as HTMLAttributes<HTMLElement>,
    };
  });
  // The table is exactly as wide as its columns: long values wrap inside
  // their column instead of pushing the table wider.
  const tableWidth =
    resizableColumns.reduce(
      (sum, column) =>
        sum + (typeof column.width === "number" ? column.width : 0),
      0,
    ) + (rowSelection ? Number(rowSelection.columnWidth) : 0);

  return (
    <Table
      className={rl.table}
      rowKey="id"
      size="small"
      columns={resizableColumns}
      components={{ header: { cell: ResizableHeaderCell } }}
      dataSource={rows}
      loading={loading}
      onChange={handleTableChange}
      tableLayout="fixed"
      scroll={{ x: tableWidth }}
      rowSelection={rowSelection}
      aria-label={`${schema.object.name}记录`}
      locale={{ emptyText: emptyState }}
      pagination={false}
    />
  );
}
