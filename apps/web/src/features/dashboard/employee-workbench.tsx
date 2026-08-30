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
import { PipelineChart, TrendChart } from "./workbench-charts";
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
  const canCreate = businessObjects.find(
    (item) => item.code === opportunity.objectCode,
  )?.canCreate;
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
              <Button type="primary">新建业务</Button>
            </Link>
          ) : undefined
        }
      />

      <KpiBand metrics={overview.metrics} />

      <div className={styles.analysisGrid}>
        <DataPanel className={styles.chartPanel} ariaLabel="我的销售管道">
          <PanelHeading
            title="我的销售管道"
            description="只统计你当前有权查看的数据。"
          />
          <PipelineChart data={overview.pipeline} />
          <PipelineLedger
            tenantCode={tenantCode}
            objectCode={opportunity.objectCode}
            stageFieldKey={opportunity.stageFieldKey}
            data={overview.pipeline}
          />
        </DataPanel>

        <ReadingPanel
          className={styles.attentionPanel}
          ariaLabel="今日与近期任务"
        >
          <PanelHeading
            title="今天先做什么"
            description="逾期、临期和长时间未更新的业务排在前面。"
          />
          <div className={styles.attentionList}>
            {overview.attention
              .filter((item) => item.key !== "unassigned")
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

      <div className={styles.lowerGrid}>
        <DataPanel className={styles.chartPanel} ariaLabel="我的业绩趋势">
          <PanelHeading
            title="我的业绩趋势"
            description="查看个人成交结果随时间的变化。"
          />
          {overview.trend.length ? (
            <TrendChart data={overview.trend} />
          ) : (
            <Empty description="当前周期还没有个人成交趋势" />
          )}
        </DataPanel>

        <DataPanel className={styles.tablePanel} ariaLabel="优先跟进">
          <PanelHeading
            title="优先跟进"
            description="从这里直接打开记录并继续处理。"
          />
          <PriorityRecordTable
            compact
            tenantCode={tenantCode}
            objectCode={opportunity.objectCode}
            rows={overview.records.slice(0, 6)}
          />
        </DataPanel>
      </div>

      <BusinessObjectBar tenantCode={tenantCode} objects={businessObjects} />
    </div>
  );
}
