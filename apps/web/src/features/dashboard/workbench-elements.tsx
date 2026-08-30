"use client";

import type { ColumnsType } from "antd/es/table";
import { Empty, Table } from "antd";
import Link from "next/link";

import { StatusTag } from "@/components/workbench/status-tag";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import type { DashboardOverview } from "./dashboard-types";
import styles from "./workbench.module.css";

export function KpiBand({
  metrics,
}: {
  metrics: DashboardOverview["metrics"];
}) {
  return (
    <section className={styles.kpiBand} aria-label="关键经营指标">
      {metrics.map((metric) => (
        <div key={metric.key} className={styles.kpiCell}>
          <span>{metric.label}</span>
          <strong data-numeric>
            {formatMetric(metric.value, metric.format)}
          </strong>
        </div>
      ))}
    </section>
  );
}

export function PanelHeading({
  title,
  description,
  extra,
}: {
  title: string;
  description?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className={styles.panelHeading}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {extra}
    </div>
  );
}

export function PipelineLedger({
  tenantCode,
  objectCode,
  stageFieldKey,
  data,
}: {
  tenantCode: string;
  objectCode: string;
  stageFieldKey: string;
  data: DashboardOverview["pipeline"];
}) {
  return (
    <div className={styles.pipelineLedger}>
      {data.map((item) => (
        <Link
          key={item.optionKey}
          href={recordFilterHref(
            tenantCode,
            objectCode,
            stageFieldKey,
            item.optionKey,
          )}
          data-option-color={item.color}
        >
          <i aria-hidden />
          <span>{item.label}</span>
          <strong data-numeric>{item.count}</strong>
          <small data-numeric>{formatMoney(item.amount)}</small>
        </Link>
      ))}
    </div>
  );
}

export function BusinessObjectBar({
  tenantCode,
  objects,
}: {
  tenantCode: string;
  objects: RuntimeObjectNavigation[];
}) {
  if (!objects.length) return null;
  return (
    <section className={styles.objectBar} aria-label="可用业务表">
      <div>
        <strong>业务表</strong>
        <span>{objects.length} 个已发布并授权</span>
      </div>
      <nav>
        {objects.map((object) => (
          <Link
            key={object.code}
            href={`/workspace/${tenantCode}/objects/${object.code}`}
          >
            {object.name}
            <span aria-hidden>→</span>
          </Link>
        ))}
      </nav>
    </section>
  );
}

export function PriorityRecordTable({
  tenantCode,
  objectCode,
  rows,
  compact = false,
}: {
  tenantCode: string;
  objectCode: string;
  rows: DashboardOverview["records"];
  compact?: boolean;
}) {
  const columns: ColumnsType<DashboardOverview["records"][number]> = [
    {
      title: "业务",
      key: "title",
      render: (_, row) => (
        <Link
          className={styles.recordLink}
          href={`/workspace/${tenantCode}/objects/${objectCode}/${row.id}`}
        >
          {row.title}
        </Link>
      ),
    },
    ...(!compact
      ? [
          {
            title: "负责人",
            key: "ownerName",
            dataIndex: "ownerName" as const,
            render: (value: string | null | undefined) => value ?? "未分配",
          },
        ]
      : []),
    {
      title: "金额",
      key: "amount",
      dataIndex: "amount",
      align: "right",
      sorter: (left, right) => (left.amount ?? 0) - (right.amount ?? 0),
      render: (value: number | null | undefined) => formatMoney(value ?? 0),
    },
    {
      title: "预计日期",
      key: "dueAt",
      dataIndex: "dueAt",
      sorter: (left, right) => timestamp(left.dueAt) - timestamp(right.dueAt),
      render: (value: string | null | undefined) =>
        value ? formatDate(value) : "—",
    },
    {
      title: "最近更新",
      key: "updatedAt",
      dataIndex: "updatedAt",
      sorter: (left, right) =>
        timestamp(left.updatedAt) - timestamp(right.updatedAt),
      render: (value: string) => formatDate(value),
    },
  ];
  return (
    <Table
      className={styles.workbenchTable}
      rowKey="id"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={rows}
      locale={{
        emptyText: <Empty description="当前范围没有需要优先处理的记录" />,
      }}
    />
  );
}

export function DateRangeLabel({ overview }: { overview: DashboardOverview }) {
  return (
    <StatusTag tone="neutral">
      {formatDate(overview.period.from)} 至 {formatDate(overview.period.to)}
    </StatusTag>
  );
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMetric(
  value: number | null | undefined,
  format: DashboardOverview["metrics"][number]["format"],
) {
  if (value === null || value === undefined) return "—";
  if (format === "MONEY") return formatMoney(value);
  if (format === "PERCENT") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("zh-CN").format(value);
}

function recordFilterHref(
  tenantCode: string,
  objectCode: string,
  stageFieldKey: string,
  optionKey: string,
) {
  const filters = encodeURIComponent(
    JSON.stringify({ [stageFieldKey]: [optionKey] }),
  );
  return `/workspace/${tenantCode}/objects/${objectCode}?filters=${filters}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function timestamp(value: string | null | undefined) {
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}
