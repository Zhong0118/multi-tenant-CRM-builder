"use client";

import { Avatar, Button, Empty, Progress, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { DataPanel, ReadingPanel } from "@/components/workbench/surface";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import type { DashboardOverview } from "./dashboard-types";
import { overviewOpportunity } from "./dashboard-types";
import {
  BusinessObjectBar,
  DateRangeLabel,
  formatMoney,
  KpiBand,
  PanelHeading,
  PipelineLedger,
  PriorityRecordTable,
} from "./workbench-elements";
import { TrendChart } from "./workbench-charts";
import styles from "./workbench.module.css";

export function AdminWorkbench({
  tenantCode,
  tenantName,
  userName,
  overview,
  businessObjects,
}: {
  tenantCode: string;
  tenantName: string;
  userName: string;
  overview: DashboardOverview;
  businessObjects: RuntimeObjectNavigation[];
}) {
  const opportunity = overviewOpportunity(overview)!;
  const opportunityObject = businessObjects.find(
    (item) => item.code === opportunity.objectCode,
  );
  const objectName = opportunityObject?.name ?? "核心业务";
  const hasAmount = Boolean(opportunity.amountFieldKey);
  const hasDate = Boolean(opportunity.dateFieldKey);
  const visibleMetrics = overview.metrics.filter(
    (metric) =>
      hasAmount ||
      (metric.key !== "activeAmount" && metric.key !== "wonAmount"),
  );
  const maxWonAmount = Math.max(
    1,
    ...overview.leaderboard.map((item) => item.wonAmount),
  );
  const leaderboardColumns: ColumnsType<
    DashboardOverview["leaderboard"][number]
  > = [
    {
      title: "员工",
      key: "displayName",
      dataIndex: "displayName",
      render: (value: string) => (
        <div className={styles.memberCell}>
          <Avatar size={28}>{value.slice(0, 1)}</Avatar>
          <strong>{value}</strong>
        </div>
      ),
    },
    {
      title: "成交单数",
      key: "wonCount",
      dataIndex: "wonCount",
      align: "right",
      sorter: (left, right) => left.wonCount - right.wonCount,
    },
    ...(hasAmount
      ? [
          {
            title: "成交金额",
            key: "wonAmount",
            dataIndex: "wonAmount" as const,
            align: "right" as const,
            sorter: (
              left: DashboardOverview["leaderboard"][number],
              right: DashboardOverview["leaderboard"][number],
            ) => left.wonAmount - right.wonAmount,
            render: (value: number) => (
              <div className={styles.amountCell}>
                <span data-numeric>{formatMoney(value)}</span>
                <Progress
                  percent={Math.round((value / maxWonAmount) * 100)}
                  showInfo={false}
                  size="small"
                  strokeColor="#3478f6"
                  aria-label={`成交金额占最高值 ${Math.round((value / maxWonAmount) * 100)}%`}
                />
              </div>
            ),
          },
          {
            title: "进行中金额",
            key: "activeAmount",
            dataIndex: "activeAmount" as const,
            align: "right" as const,
            sorter: (
              left: DashboardOverview["leaderboard"][number],
              right: DashboardOverview["leaderboard"][number],
            ) => left.activeAmount - right.activeAmount,
            render: (value: number) => formatMoney(value),
          },
        ]
      : []),
  ];

  return (
    <div className={styles.workbench}>
      <PageHeader
        title="运营驾驶舱"
        description={`${userName}，查看 ${tenantName} 的经营趋势、销售漏斗和当前风险。`}
        status={<DateRangeLabel overview={overview} />}
        extra={
          <div className={styles.headerActions}>
            <Link href={`/workspace/${tenantCode}/settings/dashboard`}>
              <Button>指标配置</Button>
            </Link>
            <Link href={`/workspace/${tenantCode}/settings/objects`}>
              <Button>管理业务表</Button>
            </Link>
            {opportunityObject?.canCreate ? (
              <Link
                href={`/workspace/${tenantCode}/objects/${opportunity.objectCode}/new`}
              >
                <Button type="primary">新建业务记录</Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <KpiBand metrics={visibleMetrics} />

      <div
        className={`${styles.analysisCanvas} ${
          hasDate ? "" : styles.analysisCanvasCompact
        }`}
      >
        {hasDate ? (
          <DataPanel
            className={styles.trendPanel}
            ariaLabel={`${objectName}趋势`}
          >
            <PanelHeading
              title={`${objectName}成交趋势`}
              description={
                hasAmount
                  ? "成交金额使用柱形，成交单数使用折线。"
                  : "按已配置的业务日期展示成交单数。"
              }
            />
            {overview.trend.length ? (
              <TrendChart data={overview.trend} showAmount={hasAmount} />
            ) : (
              <Empty description="当前周期还没有成交趋势" />
            )}
          </DataPanel>
        ) : null}

        <div className={styles.analysisRail}>
          <DataPanel
            className={styles.pipelinePanel}
            ariaLabel={`${objectName}漏斗`}
          >
            <PanelHeading
              title={`${objectName}漏斗`}
              description="点击阶段进入对应记录。"
            />
            <PipelineLedger
              tenantCode={tenantCode}
              objectCode={opportunity.objectCode}
              stageFieldKey={opportunity.stageFieldKey}
              data={overview.pipeline}
              showAmount={hasAmount}
            />
          </DataPanel>

          <ReadingPanel
            className={styles.attentionPanel}
            ariaLabel="异常与待办"
          >
            <PanelHeading
              title="异常与待办"
              description="先处理对结果影响最大的事项。"
            />
            <div className={styles.attentionList}>
              {overview.attention
                .filter(
                  (item) =>
                    hasDate ||
                    (item.key !== "overdue" && item.key !== "dueSoon"),
                )
                .map((item) => (
                  <Link key={item.key} href={item.href}>
                    <span>{item.label}</span>
                    <strong data-numeric>{item.count}</strong>
                    <i aria-hidden>→</i>
                  </Link>
                ))}
            </div>
          </ReadingPanel>
        </div>
      </div>

      <DataPanel className={styles.tablePanel} ariaLabel="员工业绩排行">
        <PanelHeading
          title={`${objectName}员工业绩排行`}
          description={
            hasAmount
              ? "可按成交单数、成交金额或进行中金额排序。"
              : "按成交单数查看团队表现。"
          }
        />
        <Table
          className={styles.workbenchTable}
          rowKey="memberId"
          size="small"
          pagination={false}
          columns={leaderboardColumns}
          dataSource={overview.leaderboard}
          rowClassName={(_, index) => (index === 0 ? styles.leadingRow : "")}
          locale={{
            emptyText: <Empty description="当前周期还没有员工业绩" />,
          }}
        />
      </DataPanel>

      <DataPanel className={styles.tablePanel} ariaLabel="风险业务明细">
        <PanelHeading
          title={`${objectName}优先处理明细`}
          description={
            hasDate
              ? "临期、逾期或长时间未更新的进行中业务。"
              : "按最近更新时间整理的进行中业务。"
          }
          extra={
            <Link
              className={styles.panelLink}
              href={`/workspace/${tenantCode}/objects/${opportunity.objectCode}`}
            >
              查看全部
            </Link>
          }
        />
        <PriorityRecordTable
          tenantCode={tenantCode}
          objectCode={opportunity.objectCode}
          rows={overview.records}
          showAmount={hasAmount}
          showDueAt={hasDate}
        />
      </DataPanel>

      <BusinessObjectBar tenantCode={tenantCode} objects={businessObjects} />
    </div>
  );
}
