"use client";

import { Button, Empty } from "antd";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { DataPanel, ReadingPanel } from "@/components/workbench/surface";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import type { DashboardOverview } from "./dashboard-types";
import { overviewOpportunity } from "./dashboard-types";
import {
  BusinessObjectBar,
  DateRangeLabel,
  KpiBand,
  PanelHeading,
  PipelineLedger,
  PriorityRecordTable,
} from "./workbench-elements";
import { TrendChart } from "./workbench-charts";
import styles from "./workbench.module.css";

export function EmployeeWorkbench({
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
  const canCreate = opportunityObject?.canCreate;
  const objectName = opportunityObject?.name ?? "核心业务";
  const hasAmount = Boolean(opportunity.amountFieldKey);
  const hasDate = Boolean(opportunity.dateFieldKey);
  const visibleMetrics = overview.metrics.filter(
    (metric) =>
      hasAmount ||
      (metric.key !== "activeAmount" && metric.key !== "wonAmount"),
  );
  return (
    <div className={styles.workbench}>
      <PageHeader
        title="我的工作台"
        description={`${userName}，这是你在 ${tenantName} 的个人业绩和今天最需要处理的业务。`}
        status={<DateRangeLabel overview={overview} />}
        extra={
          canCreate ? (
            <Link
              href={`/workspace/${tenantCode}/objects/${opportunity.objectCode}/new`}
            >
              <Button type="primary">新建业务记录</Button>
            </Link>
          ) : undefined
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
            ariaLabel={`我的${objectName}趋势`}
          >
            <PanelHeading
              title={`我的${objectName}趋势`}
              description="成交结果只统计你当前有权查看的数据。"
            />
            {overview.trend.length ? (
              <TrendChart data={overview.trend} showAmount={hasAmount} />
            ) : (
              <Empty description="当前周期还没有个人成交趋势" />
            )}
          </DataPanel>
        ) : null}

        <div className={styles.analysisRail}>
          <DataPanel
            className={styles.pipelinePanel}
            ariaLabel={`我的${objectName}管道`}
          >
            <PanelHeading
              title={`我的${objectName}管道`}
              description="点击阶段查看对应业务。"
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
            ariaLabel="今日与近期任务"
          >
            <PanelHeading
              title="今天先做什么"
              description="逾期、临期和久未更新的业务优先。"
            />
            <div className={styles.attentionList}>
              {overview.attention
                .filter(
                  (item) =>
                    item.key !== "unassigned" &&
                    (hasDate ||
                      (item.key !== "overdue" && item.key !== "dueSoon")),
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

      <DataPanel className={styles.tablePanel} ariaLabel="优先跟进">
        <PanelHeading
          title={`${objectName}优先跟进`}
          description="从这里直接打开记录并继续处理。"
        />
        <PriorityRecordTable
          compact
          tenantCode={tenantCode}
          objectCode={opportunity.objectCode}
          rows={overview.records.slice(0, 8)}
          showAmount={hasAmount}
          showDueAt={hasDate}
        />
      </DataPanel>

      <BusinessObjectBar tenantCode={tenantCode} objects={businessObjects} />
    </div>
  );
}
