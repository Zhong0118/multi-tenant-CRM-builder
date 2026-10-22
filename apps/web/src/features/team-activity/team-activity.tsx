"use client";

import type { components } from "@crm/contracts";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Segmented, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";

import { Page, PageToolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import styles from "./team-activity.module.css";

type TeamActivityResponse = components["schemas"]["TeamActivityResponseDto"];
type MemberRow = components["schemas"]["TeamActivityMemberDto"];
type Counts = components["schemas"]["TeamActivityCountsDto"];

type Preset = "today" | "yesterday" | "week" | "month" | "custom";

export const teamActivityApi = {
  async summarize(tenantCode: string, from: string, to: string): Promise<TeamActivityResponse> {
    const result = await browserApiClient.GET("/api/v1/workspaces/{tenantCode}/team-activity", {
      params: { path: { tenantCode }, query: { from, to } },
    });
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
};

function presetRange(preset: Exclude<Preset, "custom">): [Dayjs, Dayjs] {
  const today = dayjs();
  if (preset === "yesterday") return [today.subtract(1, "day"), today.subtract(1, "day")];
  if (preset === "week") return [today.subtract((today.day() + 6) % 7, "day"), today];
  if (preset === "month") return [today.startOf("month"), today];
  return [today, today];
}

/** One column per recorded kind of work, labelled the way employees log it. */
const METRICS: Array<{ key: keyof Counts; title: string; help: string }> = [
  { key: "calls", title: "电话", help: "记录「动态」中登记的电话" },
  { key: "messages", title: "微信/消息", help: "记录「动态」中登记的消息，含微信沟通" },
  { key: "visits", title: "拜访", help: "记录「动态」中登记的拜访" },
  { key: "customersFollowed", title: "跟进客户", help: "登记过以上动态或备注的不同记录数" },
  { key: "contactsConfirmed", title: "确认联系", help: "公共池中「确认已联系 / 已加微信」的次数" },
  { key: "leadsClaimed", title: "领取线索", help: "从公共池领取的次数" },
  { key: "tasksDone", title: "完成待办", help: "期间内完成的跟进待办" },
  { key: "tasksOverdue", title: "逾期待办", help: "当前已过期限仍未完成的跟进待办" },
  { key: "recordsCreated", title: "新建记录", help: "期间内新建的记录，所有业务表" },
];

/**
 * 团队动态: what each member did in a period, counted only from what the
 * system records when the work happens — activities logged on records, pool
 * claims and contact confirmations, follow-up tasks, created records. Work
 * nobody logged is not guessed at; the page says where each number comes from.
 */
export function TeamActivity({
  tenantCode,
  api = teamActivityApi,
}: {
  tenantCode: string;
  api?: typeof teamActivityApi;
}) {
  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => presetRange("today"));
  const from = range[0].format("YYYY-MM-DD");
  const to = range[1].format("YYYY-MM-DD");
  const query = useQuery({
    queryKey: ["workspace", tenantCode, "team-activity", from, to],
    queryFn: () => api.summarize(tenantCode, from, to),
  });

  const columns: ColumnsType<MemberRow> = [
    {
      title: "成员",
      key: "member",
      fixed: "left",
      width: 160,
      render: (_, row) => (
        <span className={styles.member}>
          <span className={styles.avatar} aria-hidden>{row.name.slice(0, 1)}</span>
          <span>
            {row.name}
            {row.status === "DISABLED" ? <span className={styles.muted}> · 已停用</span> : null}
          </span>
        </span>
      ),
    },
    ...METRICS.map((metric) => ({
      title: <span title={metric.help}>{metric.title}</span>,
      key: metric.key,
      dataIndex: metric.key,
      align: "right" as const,
      width: 96,
      sorter: (left: MemberRow, right: MemberRow) => left[metric.key] - right[metric.key],
      render: (value: number) =>
        value ? (
          <span className={metric.key === "tasksOverdue" ? styles.warn : undefined}>{value}</span>
        ) : (
          <span className={styles.zero}>0</span>
        ),
    })),
  ];

  return (
    <Page>
      <PageHeader
        title="团队动态"
        description="按成员统计记录里登记的电话、微信、拜访与跟进，以及公共池领取、确认联系和待办完成情况。"
      />
      <PageToolbar
        ariaLabel="统计期间"
        start={
          <>
            <Segmented
              aria-label="统计期间"
              value={preset}
              onChange={(value) => {
                const next = value as Preset;
                setPreset(next);
                if (next !== "custom") setRange(presetRange(next));
              }}
              options={[
                { value: "today", label: "今天" },
                { value: "yesterday", label: "昨天" },
                { value: "week", label: "本周" },
                { value: "month", label: "本月" },
                { value: "custom", label: "自定义" },
              ]}
            />
            {preset === "custom" ? (
              <DatePicker.RangePicker
                aria-label="自定义日期"
                value={range}
                allowClear={false}
                disabledDate={(day) => day.isAfter(dayjs(), "day")}
                onChange={(next) => {
                  if (next?.[0] && next[1]) setRange([next[0], next[1]]);
                }}
              />
            ) : (
              <span className={styles.period}>
                {from === to ? from : `${from} 至 ${to}`}
              </span>
            )}
          </>
        }
      />
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          title="团队动态暂时无法加载"
          description={toApiError(query.error).message}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      ) : (
        <Table
          className={styles.table}
          rowKey="memberId"
          size="small"
          loading={query.isFetching}
          columns={columns}
          dataSource={query.data?.members ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          aria-label="成员动态"
          summary={() =>
            query.data ? (
              <Table.Summary fixed="bottom">
                <Table.Summary.Row className={styles.totals}>
                  <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                  {METRICS.map((metric, index) => (
                    <Table.Summary.Cell key={metric.key} index={index + 1} align="right">
                      {query.data.totals[metric.key]}
                    </Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              </Table.Summary>
            ) : null
          }
        />
      )}
      <p className={styles.source}>
        电话、微信和拜访按员工在记录页「动态」中登记的条目统计；没有登记的沟通不会出现在这里。
      </p>
    </Page>
  );
}
