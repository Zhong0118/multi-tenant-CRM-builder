"use client";

import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";

import type {
  DashboardRuntime,
  DashboardRuntimeWidget,
} from "./dashboard-types";
import { layoutDashboardWidgets } from "./layout-dashboard-widgets";
import { TrendChart } from "./workbench-charts";
import styles from "./workbench.module.css";

export function DashboardRenderer({
  tenantCode,
  runtime,
}: {
  tenantCode: string;
  runtime: DashboardRuntime;
}) {
  if (!runtime.widgets.length) {
    return (
      <WidgetEmpty
        kind="unconfigured"
        title="当前发布的工作台没有可显示的组件"
        description="添加组件并发布后，这里会显示真实业务结果。"
      />
    );
  }

  const layout = layoutDashboardWidgets(runtime.widgets);
  const hasAnalysis = Boolean(layout.primaryTrend) || layout.distributions.length > 0;
  const analysisSolo = !layout.primaryTrend || layout.distributions.length === 0;
  const hasTables = layout.leaderboards.length > 0 || layout.recordLists.length > 0;
  const tablesSolo = layout.leaderboards.length === 0 || layout.recordLists.length === 0;

  function renderWidget(widget: DashboardRuntimeWidget, className?: string) {
    return (
      <WidgetSurface key={widget.id} widget={widget} className={className}>
        {widget.state === "UNAVAILABLE" ? (
          <UnavailableWidget widget={widget} />
        ) : (
          <ReadyWidget tenantCode={tenantCode} widget={widget} />
        )}
      </WidgetSurface>
    );
  }

  return (
    <div className={styles.dashboard} aria-label={runtime.title}>
      {layout.metrics.length ? (
        <section
          className={styles.metricBand}
          data-dashboard-band="metrics"
          data-metric-count={Math.min(layout.metrics.length, 5)}
          aria-label="指标"
        >
          {layout.metrics.map((widget) => renderWidget(widget, styles.metricWidget))}
        </section>
      ) : null}

      {hasAnalysis ? (
        <section
          className={`${styles.analysisBand} ${analysisSolo ? styles.analysisBandSolo : ""}`}
          data-dashboard-band="analysis"
          aria-label="分析"
        >
          {layout.primaryTrend
            ? renderWidget(layout.primaryTrend, styles.trendWidget)
            : null}
          {layout.distributions.length ? (
            <div className={styles.analysisRail}>
              {layout.distributions.map((widget) => renderWidget(widget))}
            </div>
          ) : null}
        </section>
      ) : null}

      {layout.extraTrends.length ? (
        <section className={styles.extraTrendBand} aria-label="其他趋势">
          {layout.extraTrends.map((widget) =>
            renderWidget(widget, styles.trendWidget),
          )}
        </section>
      ) : null}

      {hasTables ? (
        <section
          className={`${styles.tablesBand} ${tablesSolo ? styles.tablesBandSolo : ""}`}
          data-dashboard-band="tables"
          aria-label="列表"
        >
          {layout.leaderboards.length ? (
            <div className={styles.tableStack}>
              {layout.leaderboards.map((widget) =>
                renderWidget(widget, styles.tableWidget),
              )}
            </div>
          ) : null}
          {layout.recordLists.length ? (
            <div className={styles.tableStack}>
              {layout.recordLists.map((widget) =>
                renderWidget(widget, styles.tableWidget),
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function WidgetSurface({
  widget,
  children,
  className,
}: {
  widget: DashboardRuntimeWidget;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`${styles.widget} ${className ?? ""}`.trim()}
      data-dashboard-widget
      data-widget-id={widget.id}
      aria-label={widget.title}
    >
      <div className={styles.widgetHeading}>
        <div>
          <h2>{widget.title}</h2>
          {widget.description ? <p>{widget.description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function ReadyWidget({
  tenantCode,
  widget,
}: {
  tenantCode: string;
  widget: Exclude<DashboardRuntimeWidget, { state: "UNAVAILABLE" }>;
}) {
  switch (widget.type) {
    case "METRIC":
      return <MetricWidget value={widget.data.value} format={widget.data.format} />;
    case "STATUS_DISTRIBUTION":
      return <DistributionWidget id={widget.id} title={widget.title} data={widget.data} />;
    case "TREND":
      return widget.data.items.length ? (
        <TrendChart title={widget.title} data={widget.data.items} />
      ) : (
        <NoDataEmpty />
      );
    case "LEADERBOARD":
      return <LeaderboardWidget rows={widget.data.items} />;
    case "RECORD_LIST":
      return (
        <RecordListWidget
          tenantCode={tenantCode}
          objectCode={widget.objectCode}
          data={widget.data}
        />
      );
  }
}

function MetricWidget({
  value,
  format,
}: {
  value: number | null;
  format?: "NUMBER" | "MONEY" | "PERCENT";
}) {
  return <strong className={styles.metricValue} data-numeric>{formatValue(value, format)}</strong>;
}

function DistributionWidget({
  id,
  title,
  data,
}: {
  id: string;
  title: string;
  data: Extract<DashboardRuntimeWidget, { type: "STATUS_DISTRIBUTION"; state: "READY" }>["data"];
}) {
  if (!data.items.length) return <NoDataEmpty />;

  if (data.display === "FUNNEL") return <FunnelDistribution title={title} data={data} />;
  if (data.display === "DONUT") return <DonutDistribution id={id} title={title} data={data} />;

  const largest = Math.max(1, ...data.items.map((item) => Math.abs(item.value)));
  return (
    <div className={styles.distributionList} data-display={data.display}>
      {data.items.map((item) => {
        const direction = valueDirection(item.value);
        const width = `${(Math.abs(item.value) / largest) * 100}%`;
        return (
          <div key={item.optionKey} className={styles.distributionItem} data-direction={direction}>
            <span className={styles.distributionLabel}>
              <i style={{ backgroundColor: optionColor(item.color) }} aria-hidden />
              {item.label}
            </span>
            <span className={styles.distributionBar} aria-hidden>
              <span className={styles.distributionNegative}>
                {direction === "negative" ? (
                  <span
                    data-distribution-mark
                    data-direction={direction}
                    style={{ width, backgroundColor: optionColor(item.color) }}
                  />
                ) : null}
              </span>
              <i className={styles.distributionBaseline} />
              <span className={styles.distributionPositive}>
                {direction !== "negative" ? (
                  <span
                    data-distribution-mark
                    data-direction={direction}
                    style={{ width, backgroundColor: optionColor(item.color) }}
                  />
                ) : null}
              </span>
            </span>
            <strong data-numeric>{formatValue(item.value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function FunnelDistribution({
  title,
  data,
}: {
  title: string;
  data: Extract<DashboardRuntimeWidget, { type: "STATUS_DISTRIBUTION"; state: "READY" }>["data"];
}) {
  const largest = Math.max(1, ...data.items.map((item) => Math.abs(item.value)));
  return (
    <ol className={styles.funnelList} aria-label={title}>
      {data.items.map((item) => {
        const direction = valueDirection(item.value);
        return (
          <li
            key={item.optionKey}
            className={styles.funnelItem}
            data-funnel-stage
            data-direction={direction}
            aria-label={
              direction === "negative" ? `${item.label}：${formatValue(item.value)}，负值` : undefined
            }
            style={{
              width: `${(Math.abs(item.value) / largest) * 100}%`,
              backgroundColor: optionColor(item.color),
            }}
          >
            {direction === "negative" ? <span className={styles.negativeMark} aria-hidden>−</span> : null}
            <span>{item.label}</span>
            <strong data-numeric>{formatValue(item.value)}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function DonutDistribution({
  id,
  title,
  data,
}: {
  id: string;
  title: string;
  data: Extract<DashboardRuntimeWidget, { type: "STATUS_DISTRIBUTION"; state: "READY" }>["data"];
}) {
  const hasNegative = data.items.some((item) => item.value < 0);
  const total = data.items.reduce((sum, item) => sum + item.value, 0);

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const titleId = `${id}-donut-title`;
  const descriptionId = `${id}-donut-description`;

  return (
    <div className={styles.donutLayout}>
      <div className={styles.donutVisual}>
        {hasNegative ? (
          <p className={styles.donutWarning} role="note">存在负值，无法按整体比例展示。</p>
        ) : (
          <svg
            className={styles.donutChart}
            viewBox="0 0 100 100"
            role="img"
            aria-label={title}
            aria-describedby={descriptionId}
          >
            <title id={titleId}>{title}</title>
            <desc id={descriptionId}>
              {total === 0 ? "所有配置项的数值均为零。" : "按各项占总数比例显示。"}
            </desc>
            {total === 0 ? (
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="#D8E0E5"
                strokeWidth="14"
              />
            ) : (
              data.items.map((item, index) => {
                const length = (item.value / total) * circumference;
                const segmentOffset = data.items.slice(0, index).reduce(
                  (sum, priorItem) => sum + (priorItem.value / total) * circumference,
                  0,
                );
                return (
                  <circle
                    key={item.optionKey}
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke={optionColor(item.color)}
                    strokeWidth="14"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-segmentOffset}
                    transform="rotate(-90 50 50)"
                  />
                );
              })
            )}
          </svg>
        )}
      </div>
      <DonutLegend title={title} items={data.items} />
    </div>
  );
}

function DonutLegend({
  title,
  items,
}: {
  title: string;
  items: Extract<DashboardRuntimeWidget, { type: "STATUS_DISTRIBUTION"; state: "READY" }>["data"]["items"];
}) {
  return (
    <ul className={styles.donutLegend} aria-label={`${title}数值`}>
      {items.map((item) => (
        <li key={item.optionKey}>
          <i style={{ backgroundColor: optionColor(item.color) }} aria-hidden />
          <span>{item.label}</span>
          <strong data-numeric>{formatValue(item.value)}</strong>
        </li>
      ))}
    </ul>
  );
}

function LeaderboardWidget({
  rows,
}: {
  rows: Extract<DashboardRuntimeWidget, { type: "LEADERBOARD"; state: "READY" }>["data"]["items"];
}) {
  const columns: ColumnsType<(typeof rows)[number]> = [
    { title: "成员", dataIndex: "displayName", key: "displayName" },
    {
      title: "数值",
      dataIndex: "value",
      key: "value",
      align: "right",
      render: (value: number) => <span data-numeric>{formatValue(value)}</span>,
    },
  ];
  return (
    <Table
      className={styles.workbenchTable}
      rowKey="memberId"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={rows}
      scroll={{ x: true }}
      locale={{ emptyText: <NoDataEmpty /> }}
    />
  );
}

function RecordListWidget({
  tenantCode,
  objectCode,
  data,
}: {
  tenantCode: string;
  objectCode: string;
  data: Extract<DashboardRuntimeWidget, { type: "RECORD_LIST"; state: "READY" }>["data"];
}) {
  const columns: ColumnsType<(typeof data.items)[number]> = [
    {
      title: "记录",
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
    ...data.fields.map((field) => ({
      title: field.label,
      key: field.fieldKey,
      render: (_: unknown, row: (typeof data.items)[number]) =>
        displayValue(row.values[field.fieldKey]),
    })),
  ];
  return (
    <Table
      className={styles.workbenchTable}
      rowKey="id"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={data.items}
      scroll={{ x: true }}
      locale={{ emptyText: <NoDataEmpty /> }}
    />
  );
}

function UnavailableWidget({
  widget,
}: {
  widget: Extract<DashboardRuntimeWidget, { state: "UNAVAILABLE" }>;
}) {
  const kind = unavailableKind(widget.reason);
  return (
    <WidgetEmpty
      kind={kind}
      title={unavailableTitle(kind)}
      description={unavailableReason(widget.reason)}
    />
  );
}

function NoDataEmpty() {
  return (
    <WidgetEmpty
      kind="no-data"
      title="当前范围没有数据"
      description="所选时间范围内没有符合条件的记录。"
    />
  );
}

function WidgetEmpty({
  kind,
  title,
  description,
}: {
  kind: "unconfigured" | "no-data" | "no-permission" | "query-failed";
  title: string;
  description: string;
}) {
  return (
    <div
      className={styles.widgetEmpty}
      data-empty-kind={kind}
      data-testid={`widget-empty-${kind}`}
    >
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function unavailableKind(
  reason?: Extract<DashboardRuntimeWidget, { state: "UNAVAILABLE" }>["reason"],
): "unconfigured" | "no-data" | "no-permission" | "query-failed" {
  if (reason === "QUERY_FAILED") return "query-failed";
  if (
    reason === "FIELD_HIDDEN" ||
    reason === "OBJECT_ACCESS_DENIED" ||
    reason === "AUDIENCE_EXCLUDED"
  ) {
    return "no-permission";
  }
  return "unconfigured";
}

function unavailableTitle(
  kind: "unconfigured" | "no-data" | "no-permission" | "query-failed",
) {
  if (kind === "query-failed") return "此组件暂时无法显示";
  if (kind === "no-permission") return "没有权限查看";
  return "此组件暂时无法显示";
}

function formatValue(value: number | null, format?: "NUMBER" | "MONEY" | "PERCENT") {
  if (value === null) return "—";
  if (format === "MONEY") {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (format === "PERCENT") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("zh-CN").format(value);
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "—";
}

function optionColor(color: string) {
  return {
    GRAY: "#7C8992",
    BLUE: "#3478F6",
    CYAN: "#0891B2",
    GREEN: "#167568",
    YELLOW: "#CA8A04",
    ORANGE: "#C66C18",
    RED: "#B42318",
    PURPLE: "#7C3AED",
  }[color] ?? "#7C8992";
}

function valueDirection(value: number) {
  if (value < 0) return "negative";
  if (value > 0) return "positive";
  return "zero";
}

function unavailableReason(
  reason?: "AUDIENCE_EXCLUDED" | "OBJECT_UNAVAILABLE" | "OBJECT_ACCESS_DENIED" | "FIELD_HIDDEN" | "QUERY_FAILED",
) {
  if (!reason) return "当前权限或组件状态暂时不允许显示此结果。";
  return {
    QUERY_FAILED: "查询暂时不可用，请稍后重试。",
    FIELD_HIDDEN: "当前权限不允许读取此组件所需的数据。",
    OBJECT_ACCESS_DENIED: "当前权限不允许读取此组件的数据。",
    OBJECT_UNAVAILABLE: "此组件关联的业务表当前不可用。",
    AUDIENCE_EXCLUDED: "此组件不适用于当前角色。",
  }[reason];
}
