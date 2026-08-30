"use client";

import { Button, Empty, Table } from "antd";
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
import { PipelineChart, TrendChart } from "./workbench-charts";
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
  const leaderboardColumns: ColumnsType<
    DashboardOverview["leaderboard"][number]
  > = [
    {
      title: "员工",
      key: "displayName",
      dataIndex: "displayName",
    },
    {
      title: "成交单数",
      key: "wonCount",
      dataIndex: "wonCount",
      align: "right",
      sorter: (left, right) => left.wonCount - right.wonCount,
    },
    {
      title: "成交金额",
      key: "wonAmount",
      dataIndex: "wonAmount",
      align: "right",
      sorter: (left, right) => left.wonAmount - right.wonAmount,
      render: (value: number) => formatMoney(value),
    },
    {
      title: "进行中金额",
      key: "activeAmount",
      dataIndex: "activeAmount",
      align: "right",
      sorter: (left, right) => left.activeAmount - right.activeAmount,
      render: (value: number) => formatMoney(value),
    },
  ];

  return (
    <div className={styles.workbench}>
      <PageHeader
        title="管理工作台"
        description={`${userName}，这里显示 ${tenantName} 的真实团队经营结果和需要处理的业务。`}
        status={<DateRangeLabel overview={overview} />}
        extra={
          <div className={styles.headerActions}>
            <Link href={`/workspace/${tenantCode}/settings/dashboard`}>
              <Button>指标配置</Button>
            </Link>
            <Link href={`/workspace/${tenantCode}/settings/objects`}>
              <Button type="primary">管理业务表</Button>
            </Link>
          </div>
        }
      />

      <KpiBand metrics={overview.metrics} />

      <div className={styles.analysisGrid}>
        <DataPanel className={styles.chartPanel} ariaLabel="销售管道">
          <PanelHeading
            title="销售管道"
            description="阶段数量与当前金额；点击阶段进入对应记录。"
          />
          <PipelineChart data={overview.pipeline} />
          <PipelineLedger
            tenantCode={tenantCode}
            objectCode={opportunity.objectCode}
            stageFieldKey={opportunity.stageFieldKey}
            data={overview.pipeline}
          />
        </DataPanel>

        <ReadingPanel className={styles.attentionPanel} ariaLabel="需要处理">
          <PanelHeading
            title="需要处理"
            description="按风险优先，而不是按创建时间堆记录。"
          />
          <div className={styles.attentionList}>
            {overview.attention.map((item) => (
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
        <DataPanel className={styles.chartPanel} ariaLabel="成交趋势">
          <PanelHeading
            title="成交趋势"
            description="成交金额使用柱形，成交单数使用折线。"
          />
          {overview.trend.length ? (
            <TrendChart data={overview.trend} />
          ) : (
            <Empty description="当前周期还没有成交趋势" />
          )}
        </DataPanel>

        <DataPanel className={styles.tablePanel} ariaLabel="员工业绩排行">
          <PanelHeading
            title="员工业绩排行"
            description="可按成交单数、成交金额或进行中金额排序。"
          />
          <Table
            className={styles.workbenchTable}
            rowKey="memberId"
            size="small"
            pagination={false}
            columns={leaderboardColumns}
            dataSource={overview.leaderboard}
            locale={{
              emptyText: <Empty description="当前周期还没有员工业绩" />,
            }}
          />
        </DataPanel>
      </div>

      <DataPanel className={styles.tablePanel} ariaLabel="风险业务明细">
        <PanelHeading
          title="风险业务明细"
          description="临期、逾期、高金额或长时间未更新的进行中业务。"
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
        />
      </DataPanel>

      <BusinessObjectBar tenantCode={tenantCode} objects={businessObjects} />
    </div>
  );
}
