"use client";

import type { components } from "@crm/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Pagination,
  Segmented,
  Select,
  Table,
  Typography,
} from "antd";
import type { ColumnsType, ColumnGroupType, ColumnType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";

import { Page, PageSection, PageToolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import {
  NewTaskForm,
  ReportReference,
  TaskItem,
} from "@/features/work/my-work";
import { workApi, workKeys, type WorkApi } from "@/features/work/work-api";

import styles from "./team-activity.module.css";

type TeamActivityResponse = components["schemas"]["TeamActivityResponseDto"];
type MemberRow = components["schemas"]["TeamActivityMemberDto"];
type Counts = components["schemas"]["TeamActivityCountsDto"];

type Preset = "today" | "yesterday" | "week" | "month";
export type Period = { preset: Preset } | { from: string; to: string };

export const teamActivityApi = {
  async summarize(
    tenantCode: string,
    period: Period,
  ): Promise<TeamActivityResponse> {
    const result = await browserApiClient.GET(
      "/api/v1/workspaces/{tenantCode}/team-activity",
      {
        params: { path: { tenantCode }, query: period },
      },
    );
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
};

/** Columns grouped by kind of work; each says where its number comes from. */
const GROUPS: Array<{
  title: string;
  metrics: Array<{
    key: keyof Counts;
    title: string;
    help: string;
    warn?: boolean;
  }>;
}> = [
  {
    title: "沟通",
    metrics: [
      { key: "calls", title: "电话", help: "动态中登记的电话" },
      {
        key: "connectedCalls",
        title: "接通",
        help: "结果记为「已接通」的电话",
      },
      { key: "messages", title: "微信/消息", help: "动态中登记的消息" },
      {
        key: "wechatAdded",
        title: "新加微信",
        help: "结果记为「新加上微信」的客户；同一成员和客户只算第一次",
      },
      { key: "visits", title: "拜访", help: "动态中登记的拜访" },
    ],
  },
  {
    title: "客户",
    metrics: [
      {
        key: "customersFollowed",
        title: "跟进客户",
        help: "启用公共池的表中，有电话、消息或拜访的不同记录",
      },
      { key: "leadsClaimed", title: "领取", help: "从公共池领取的次数" },
      {
        key: "contactsConfirmed",
        title: "确认联系",
        help: "确认联系成功的次数，含登记联系结果自动确认的",
      },
      {
        key: "recordsCreated",
        title: "新建记录",
        help: "期间内新建的记录，所有业务表",
      },
    ],
  },
  {
    title: "跟进待办",
    metrics: [
      { key: "followUpsDone", title: "完成", help: "期间内完成的客户跟进待办" },
      {
        key: "followUpsOverdue",
        title: "当前逾期",
        help: "现在已过期限、仍未完成",
        warn: true,
      },
      {
        key: "followUpsOverdueInPeriod",
        title: "期间逾期",
        help: "期限在期间内、没有按时完成",
        warn: true,
      },
    ],
  },
  {
    title: "工作任务",
    metrics: [
      { key: "tasksDone", title: "完成", help: "期间内完成的工作任务" },
      {
        key: "tasksOverdue",
        title: "当前逾期",
        help: "现在已过期限、仍未完成",
        warn: true,
      },
      {
        key: "tasksOverdueInPeriod",
        title: "期间逾期",
        help: "期限在期间内、没有按时完成",
        warn: true,
      },
    ],
  },
  {
    title: "日报",
    metrics: [
      { key: "reportsWritten", title: "已写", help: "期间内写了日报的天数" },
    ],
  },
];
const METRICS = GROUPS.flatMap((group) => group.metrics);

/**
 * 团队动态: each member's recorded work in a period of company calendar days,
 * with the means to act on it — assign a task, read a day's report — and the
 * team's open tasks below. Presets are resolved by the server in the company's
 * timezone.
 */
export function TeamActivity({
  tenantCode,
  api = teamActivityApi,
  work = workApi,
}: {
  tenantCode: string;
  api?: typeof teamActivityApi;
  work?: WorkApi;
}) {
  const [choice, setChoice] = useState<Preset | "custom">("today");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs(), dayjs()]);
  const period: Period =
    choice === "custom"
      ? {
          from: range[0].format("YYYY-MM-DD"),
          to: range[1].format("YYYY-MM-DD"),
        }
      : { preset: choice };
  const query = useQuery({
    queryKey: ["workspace", tenantCode, "team-activity", period],
    queryFn: () => api.summarize(tenantCode, period),
  });
  const [assignTo, setAssignTo] = useState<MemberRow>();
  const [reportOf, setReportOf] = useState<MemberRow>();
  const singleDay = query.data && query.data.from === query.data.to;

  const columns: ColumnsType<MemberRow> = [
    {
      title: "成员",
      key: "member",
      fixed: "left",
      width: 140,
      render: (_, row) => (
        <span className={styles.member}>
          <span className={styles.avatar} aria-hidden>
            {row.name.slice(0, 1)}
          </span>
          <span>
            {row.name}
            {row.status === "DISABLED" ? (
              <span className={styles.muted}> · 已停用</span>
            ) : null}
          </span>
        </span>
      ),
    },
    ...GROUPS.map((group): ColumnGroupType<MemberRow> => ({
      title: group.title,
      children: group.metrics.map((metric): ColumnType<MemberRow> => ({
        title: <span title={metric.help}>{metric.title}</span>,
        key: metric.key,
        dataIndex: metric.key,
        align: "right",
        width: 76,
        sorter: (left, right) => left[metric.key] - right[metric.key],
        render: (value: number) =>
          value ? (
            <span className={metric.warn ? styles.warn : undefined}>
              {value}
            </span>
          ) : (
            <span className={styles.zero}>0</span>
          ),
      })),
    })),
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 150,
      render: (_, row) =>
        row.status === "ACTIVE" ? (
          <span className={styles.rowActions}>
            <Button size="small" type="link" onClick={() => setAssignTo(row)}>
              安排任务
            </Button>
            {singleDay ? (
              <Button size="small" type="link" onClick={() => setReportOf(row)}>
                看日报
              </Button>
            ) : null}
          </span>
        ) : null,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="团队动态"
        description="按成员统计系统里登记的沟通、客户、待办、任务和日报，可直接安排任务、查看日报。"
      />
      <PageToolbar
        ariaLabel="统计期间"
        start={
          <>
            <Segmented
              aria-label="统计期间"
              value={choice}
              onChange={(value) => setChoice(value as Preset | "custom")}
              options={[
                { value: "today", label: "今天" },
                { value: "yesterday", label: "昨天" },
                { value: "week", label: "本周" },
                { value: "month", label: "本月" },
                { value: "custom", label: "自定义" },
              ]}
            />
            {choice === "custom" ? (
              <DatePicker.RangePicker
                aria-label="自定义日期"
                value={range}
                allowClear={false}
                onChange={(next) => {
                  if (next?.[0] && next[1]) setRange([next[0], next[1]]);
                }}
              />
            ) : null}
            {query.data ? (
              <span className={styles.period}>
                {query.data.from === query.data.to
                  ? query.data.from
                  : `${query.data.from} 至 ${query.data.to}`}
                （{query.data.timezone}）
              </span>
            ) : null}
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
          bordered
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
                    <Table.Summary.Cell
                      key={metric.key}
                      index={index + 1}
                      align="right"
                    >
                      {query.data.totals[metric.key]}
                    </Table.Summary.Cell>
                  ))}
                  <Table.Summary.Cell index={METRICS.length + 1} />
                </Table.Summary.Row>
              </Table.Summary>
            ) : null
          }
        />
      )}
      <p className={styles.source}>
        电话、微信和拜访按员工在记录「动态」中登记的条目统计；只有结果记为已接通、已沟通、新加上微信或已见面才算联系成功。没有登记的沟通不会出现在这里，日报里的文字也不计数。
      </p>

      <TeamTasks
        tenantCode={tenantCode}
        api={work}
        members={(query.data?.members ?? []).filter(
          (m) => m.status === "ACTIVE",
        )}
      />

      <Drawer
        open={!!assignTo}
        onClose={() => setAssignTo(undefined)}
        title={assignTo ? `给${assignTo.name}安排任务` : undefined}
        size="default"
        destroyOnHidden
      >
        {assignTo ? (
          <NewTaskForm
            tenantCode={tenantCode}
            api={work}
            assignee={{ memberId: assignTo.memberId, name: assignTo.name }}
            onDone={() => setAssignTo(undefined)}
          />
        ) : null}
      </Drawer>
      <Drawer
        open={!!reportOf}
        onClose={() => setReportOf(undefined)}
        title={
          reportOf && query.data
            ? `${reportOf.name} · ${query.data.from} 日报`
            : undefined
        }
        size="large"
        destroyOnHidden
      >
        {reportOf && query.data ? (
          <MemberReport
            tenantCode={tenantCode}
            api={work}
            memberId={reportOf.memberId}
            workDate={query.data.from}
          />
        ) : null}
      </Drawer>
    </Page>
  );
}

function MemberReport({
  tenantCode,
  api,
  memberId,
  workDate,
}: {
  tenantCode: string;
  api: WorkApi;
  memberId: string;
  workDate: string;
}) {
  const view = useQuery({
    queryKey: workKeys.report(tenantCode, workDate, memberId),
    queryFn: () => api.memberReport(tenantCode, workDate, memberId),
  });
  if (view.isError)
    return (
      <Alert type="error" showIcon title={toApiError(view.error).message} />
    );
  if (!view.data) return null;
  const report = view.data.report;
  return (
    <div className={styles.memberReport}>
      {report ? (
        <dl className={styles.reportText}>
          {(
            [
              ["今日计划", report.plans],
              ["完成情况", report.completed],
              ["遇到的问题", report.problems],
              ["明日安排", report.nextSteps],
            ] as const
          ).map(([label, text]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{text || <span className={styles.muted}>未填写</span>}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="这一天没有写日报"
        />
      )}
      <ReportReference
        counts={view.data.reference.counts}
        tasks={view.data.reference.tasks}
      />
    </div>
  );
}

function TeamTasks({
  tenantCode,
  api,
  members,
}: {
  tenantCode: string;
  api: WorkApi;
  members: MemberRow[];
}) {
  const [status, setStatus] = useState<"OPEN" | "DONE" | "CANCELLED">("OPEN");
  const [assignee, setAssignee] = useState<string>();
  const [page, setPage] = useState(1);
  const filter = {
    scope: "team" as const,
    status,
    assigneeMemberId: assignee,
    page,
  };
  const tasks = useQuery({
    queryKey: workKeys.tasks(tenantCode, filter),
    queryFn: () => api.listTasks(tenantCode, filter),
  });
  if (tasks.data) {
    const lastPage = Math.max(1, Math.ceil(tasks.data.total / tasks.data.limit));
    if (page > lastPage) setPage(lastPage);
  }
  return (
    <PageSection
      title="团队任务"
      description="安排给成员的工作任务和他们自己的计划；完成时成员会写下结果。"
      extra={
        <span className={styles.taskFilters}>
          <Select
            aria-label="负责人"
            size="small"
            allowClear
            placeholder="全部成员"
            value={assignee}
            onChange={(value) => {
              setAssignee(value);
              setPage(1);
            }}
            options={members.map((m) => ({ value: m.memberId, label: m.name }))}
            style={{ width: 140 }}
          />
          <Segmented
            aria-label="任务状态"
            size="small"
            value={status}
            onChange={(value) => {
              setStatus(value as typeof status);
              setPage(1);
            }}
            options={[
              { value: "OPEN", label: "进行中" },
              { value: "DONE", label: "已完成" },
              { value: "CANCELLED", label: "已取消" },
            ]}
          />
        </span>
      }
    >
      {tasks.isError ? (
        <Alert type="error" showIcon title={toApiError(tasks.error).message} />
      ) : null}
      <ul className={styles.taskList} aria-label="团队任务列表">
        {(tasks.data?.items ?? []).map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            tenantCode={tenantCode}
            api={api}
            showAssignee
          />
        ))}
      </ul>
      {tasks.isSuccess && tasks.data.items.length === 0 ? (
        <Typography.Text type="secondary">没有符合条件的任务。</Typography.Text>
      ) : null}
      {tasks.data ? (
        <Pagination
          size="small"
          current={page}
          total={tasks.data.total}
          pageSize={tasks.data.limit}
          showSizeChanger={false}
          showTotal={(total) => `共 ${total} 项`}
          onChange={setPage}
        />
      ) : null}
    </PageSection>
  );
}
