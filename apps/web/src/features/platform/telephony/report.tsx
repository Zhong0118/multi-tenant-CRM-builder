"use client";
import { useQuery } from "@tanstack/react-query";
import { DatePicker, Skeleton, Table, Tooltip } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";

import { DataPanel } from "@/components/workbench/surface";
import { LoadError } from "@/features/ai-governance/view-feedback";

import {
  PLATFORM_TELEPHONY_KEY,
  platformTelephonyApi,
  yuan,
  type TelephonyReportRow,
} from "./platform-telephony-api";
import styles from "./platform-telephony.module.css";

const money = (value: string) => (
  <span className={Number(value) < 0 ? styles.loss : undefined}>
    {yuan(value)}
  </span>
);

/** One month's revenue, cost and margin, a row per company and a total. */
export function TelephonyReportPanel({
  initialMonth = dayjs().format("YYYY-MM"),
}: {
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const report = useQuery({
    queryKey: [...PLATFORM_TELEPHONY_KEY, "report", month],
    queryFn: () => platformTelephonyApi.report(month),
  });
  const data = report.data;
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <DatePicker
          picker="month"
          aria-label="月份"
          allowClear={false}
          value={dayjs(`${month}-01`)}
          disabledDate={(day) => day.isAfter(dayjs(), "month")}
          onChange={(day: Dayjs | null) =>
            day && setMonth(day.format("YYYY-MM"))
          }
        />
        {data ? (
          <span className={styles.detail}>
            {`坐席成本按当前坐席月进价 ${yuan(data.seatMonthlyCost)} 计算，没有按月保存。`}
          </span>
        ) : null}
      </div>
      {data ? (
        <DataPanel ariaLabel="通话收支">
          <Table<TelephonyReportRow>
            rowKey="tenantId"
            className={styles.table}
            dataSource={data.rows}
            pagination={false}
            locale={{ emptyText: "这个月没有开通通话的公司" }}
            columns={[
              { title: "公司", dataIndex: "tenantName" },
              { title: "套餐", render: (_, row) => row.planName ?? "—" },
              {
                title: "分钟",
                render: (_, row) => `${row.usedMinutes} / ${row.allowance}`,
              },
              {
                title: "收入",
                align: "right",
                render: (_, row) => (
                  <Tooltip
                    title={`套餐 ${yuan(row.planPrice)} + 加量 ${yuan(row.extraPrice)}`}
                  >
                    {yuan(row.revenue)}
                  </Tooltip>
                ),
              },
              {
                title: "成本",
                align: "right",
                render: (_, row) => (
                  <Tooltip
                    title={`通话 ${yuan(row.minuteCost)} + 坐席 ${yuan(row.seatCost)}（${row.seatsProvisioned} 个）`}
                  >
                    {yuan(row.cost)}
                  </Tooltip>
                ),
              },
              {
                title: "毛利",
                align: "right",
                render: (_, row) => money(row.margin),
              },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <strong>合计</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2}>
                  {data.total.usedMinutes}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  {yuan(data.total.revenue)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  {yuan(data.total.cost)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  {money(data.total.margin)}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
        </DataPanel>
      ) : report.isError ? (
        <LoadError error={report.error} retry={() => void report.refetch()} />
      ) : (
        <Skeleton active />
      )}
    </div>
  );
}
