"use client";

import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Input,
  Pagination,
  Segmented,
  Tag,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";

import { Page, PageSection } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { toApiError } from "@/lib/api/api-error";

import {
  workApi,
  workKeys,
  type DailyReportView,
  type WorkApi,
  type WorkCounts,
  type WorkTask,
} from "./work-api";

import styles from "./work.module.css";

/**
 * 任务与日报: the member's general tasks and their daily report. Tasks here are
 * not tied to a customer (customer follow-ups stay in 跟进待办). The report sits
 * beside what the system recorded that day so nobody re-types it.
 */
export function MyWork({
  tenantCode,
  api = workApi,
}: {
  tenantCode: string;
  api?: WorkApi;
}) {
  return (
    <Page>
      <PageHeader
        title="任务与日报"
        description="安排给你的工作和自己的计划，以及每天的工作日报。客户跟进请在「跟进待办」处理。"
      />
      <div className={styles.columns}>
        <MyTasks tenantCode={tenantCode} api={api} />
        <ReportEditor tenantCode={tenantCode} api={api} />
      </div>
    </Page>
  );
}

function MyTasks({ tenantCode, api }: { tenantCode: string; api: WorkApi }) {
  const [status, setStatus] = useState<"OPEN" | "DONE">("OPEN");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const query = useQuery({
    queryKey: workKeys.tasks(tenantCode, { status, page }),
    queryFn: () => api.listTasks(tenantCode, { status, page }),
  });
  if (
    query.isSuccess &&
    query.isFetchedAfterMount &&
    query.fetchStatus === "idle"
  ) {
    const lastPage = Math.max(1, Math.ceil(query.data.total / query.data.limit));
    if (page > lastPage) setPage(lastPage);
  }
  return (
    <PageSection
      title="我的任务"
      description="完成时写下结果，安排任务的人会看到。"
      extra={
        <Button
          size="small"
          icon={<PlusOutlined aria-hidden />}
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          添加任务
        </Button>
      }
    >
      <Segmented
        aria-label="任务状态"
        value={status}
        onChange={(value) => {
          setStatus(value as "OPEN" | "DONE");
          setPage(1);
        }}
        options={[
          { value: "OPEN", label: "进行中" },
          { value: "DONE", label: "已完成" },
        ]}
      />
      {adding ? (
        <NewTaskForm
          tenantCode={tenantCode}
          api={api}
          onDone={() => setAdding(false)}
        />
      ) : null}
      {query.isError ? (
        <Alert type="error" showIcon title={toApiError(query.error).message} />
      ) : null}
      <ul className={styles.taskList} aria-label="任务列表">
        {(query.data?.items ?? []).map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            tenantCode={tenantCode}
            api={api}
          />
        ))}
      </ul>
      {query.isSuccess && query.data.items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            status === "OPEN" ? "没有进行中的任务" : "还没有完成的任务"
          }
        />
      ) : null}
      {query.data ? (
        <Pagination
          size="small"
          current={page}
          total={query.data.total}
          pageSize={query.data.limit}
          showSizeChanger={false}
          showTotal={(total) => `共 ${total} 项`}
          onChange={setPage}
        />
      ) : null}
    </PageSection>
  );
}

/** A task the member plans for themselves. */
export function NewTaskForm({
  tenantCode,
  api,
  onDone,
  assignee,
}: {
  tenantCode: string;
  api: WorkApi;
  onDone: () => void;
  /** Set by 团队动态 when an administrator assigns the task. */
  assignee?: { memberId: string; name: string };
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState<Dayjs | null>(
    dayjs().endOf("day").second(0).millisecond(0),
  );
  const create = useMutation({
    mutationFn: () =>
      api.createTask(tenantCode, {
        title: title.trim(),
        notes: notes.trim() || undefined,
        dueAt: dueAt!.toISOString(),
        ...(assignee ? { assigneeMemberId: assignee.memberId } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workKeys.allTasks(tenantCode),
      });
      onDone();
    },
  });
  return (
    <form
      className={styles.taskForm}
      aria-label={assignee ? `给${assignee.name}安排任务` : "添加任务"}
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() && dueAt) create.mutate();
      }}
    >
      <Input
        aria-label="任务标题"
        placeholder="要做什么"
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        autoFocus
      />
      <DatePicker
        aria-label="截止时间"
        showTime={{ format: "HH:mm" }}
        format="YYYY-MM-DD HH:mm"
        value={dueAt}
        onChange={setDueAt}
        allowClear={false}
      />
      <Input.TextArea
        aria-label="说明"
        placeholder="说明（可选）"
        rows={2}
        maxLength={4000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      {create.isError ? (
        <Alert type="error" showIcon title={toApiError(create.error).message} />
      ) : null}
      <div className={styles.formActions}>
        <Button onClick={onDone} disabled={create.isPending}>
          取消
        </Button>
        <Button
          type="primary"
          htmlType="submit"
          loading={create.isPending}
          disabled={!title.trim() || !dueAt}
        >
          {assignee ? "安排" : "添加"}
        </Button>
      </div>
    </form>
  );
}

export function TaskItem({
  task,
  tenantCode,
  api,
  showAssignee = false,
}: {
  task: WorkTask;
  tenantCode: string;
  api: WorkApi;
  showAssignee?: boolean;
}) {
  const queryClient = useQueryClient();
  const [completing, setCompleting] = useState(false);
  const [result, setResult] = useState(task.result);
  const update = useMutation({
    mutationFn: (body: Parameters<WorkApi["updateTask"]>[2]) =>
      api.updateTask(tenantCode, task.id, body),
    onSuccess: async () => {
      setCompleting(false);
      await queryClient.invalidateQueries({
        queryKey: workKeys.allTasks(tenantCode),
      });
    },
  });
  const assignedBySomeoneElse =
    task.createdByMemberId !== task.assigneeMemberId;
  return (
    <li className={styles.task} data-status={task.status}>
      <div className={styles.taskMain}>
        <strong>{task.title}</strong>
        <span className={styles.taskMeta}>
          <time
            dateTime={task.dueAt}
            className={task.overdue ? styles.overdue : undefined}
          >
            {task.overdue ? "已逾期 · " : "截止 "}
            {dayjs(task.dueAt).format("MM-DD HH:mm")}
          </time>
          {showAssignee ? <span>负责人 {task.assigneeName}</span> : null}
          {assignedBySomeoneElse && !showAssignee ? (
            <span>由 {task.createdByName} 安排</span>
          ) : null}
          {task.status === "CANCELLED" ? <Tag>已取消</Tag> : null}
        </span>
        {task.notes ? <p className={styles.taskNotes}>{task.notes}</p> : null}
        {task.status === "DONE" && task.result ? (
          <p className={styles.taskResult}>结果：{task.result}</p>
        ) : null}
      </div>
      {completing ? (
        <div className={styles.completeForm}>
          <Input.TextArea
            aria-label={`${task.title} 的结果`}
            placeholder="写下结果，例如完成了什么、数字或链接"
            rows={2}
            maxLength={4000}
            value={result}
            onChange={(event) => setResult(event.target.value)}
            autoFocus
          />
          <div className={styles.formActions}>
            <Button size="small" onClick={() => setCompleting(false)}>
              取消
            </Button>
            <Button
              size="small"
              type="primary"
              loading={update.isPending}
              onClick={() =>
                update.mutate({
                  version: task.version,
                  status: "DONE",
                  result: result.trim(),
                })
              }
            >
              标记完成
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.taskActions}>
          {task.status === "OPEN" && task.canComplete ? (
            <Button size="small" onClick={() => setCompleting(true)}>
              完成
            </Button>
          ) : null}
          {task.status !== "OPEN" && task.canComplete ? (
            <Button
              size="small"
              type="text"
              loading={update.isPending}
              onClick={() =>
                update.mutate({ version: task.version, status: "OPEN" })
              }
            >
              重新打开
            </Button>
          ) : null}
          {task.status === "OPEN" && task.canManage ? (
            <Button
              size="small"
              type="text"
              danger
              loading={update.isPending}
              onClick={() =>
                update.mutate({ version: task.version, status: "CANCELLED" })
              }
            >
              取消任务
            </Button>
          ) : null}
        </div>
      )}
      {update.isError ? (
        <Alert type="error" showIcon title={toApiError(update.error).message} />
      ) : null}
    </li>
  );
}

const SECTIONS = [
  { key: "plans", label: "今日计划" },
  { key: "completed", label: "完成情况" },
  { key: "problems", label: "遇到的问题" },
  { key: "nextSteps", label: "明日安排" },
] as const;
type Sections = Record<(typeof SECTIONS)[number]["key"], string>;
const emptySections: Sections = {
  plans: "",
  completed: "",
  problems: "",
  nextSteps: "",
};

function ReportEditor({
  tenantCode,
  api,
}: {
  tenantCode: string;
  api: WorkApi;
}) {
  const [workDate, setWorkDate] = useState("today");
  const view = useQuery({
    queryKey: workKeys.report(tenantCode, workDate),
    queryFn: () => api.myReport(tenantCode, workDate),
  });
  const loaded = view.data;
  return (
    <PageSection
      title="工作日报"
      description="写给自己和管理员看；右侧的数字来自系统记录，不必重复填写。"
      extra={
        <DatePicker
          aria-label="日报日期"
          size="small"
          allowClear={false}
          value={loaded ? dayjs(loaded.workDate) : null}
          disabledDate={(day) =>
            loaded ? day.isAfter(dayjs(loaded.today), "day") : false
          }
          onChange={(day) => day && setWorkDate(day.format("YYYY-MM-DD"))}
        />
      }
    >
      {view.isError ? (
        <Alert type="error" showIcon title={toApiError(view.error).message} />
      ) : null}
      {loaded ? (
        <div className={styles.report}>
          {/* Keyed by day and version: a loaded or saved report starts a fresh draft. */}
          <ReportForm
            key={`${loaded.workDate}:${loaded.report?.version ?? 0}`}
            tenantCode={tenantCode}
            api={api}
            loaded={loaded}
            queryDate={workDate}
            onReload={() => void view.refetch()}
          />
          <ReportReference
            counts={loaded.reference.counts}
            tasks={loaded.reference.tasks}
          />
        </div>
      ) : null}
    </PageSection>
  );
}

function ReportForm({
  tenantCode,
  api,
  loaded,
  queryDate,
  onReload,
}: {
  tenantCode: string;
  api: WorkApi;
  loaded: DailyReportView;
  queryDate: string;
  onReload: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Sections>(() =>
    loaded.report
      ? {
          plans: loaded.report.plans,
          completed: loaded.report.completed,
          problems: loaded.report.problems,
          nextSteps: loaded.report.nextSteps,
        }
      : emptySections,
  );
  const save = useMutation({
    mutationFn: () =>
      api.saveReport(tenantCode, loaded.workDate, {
        version: loaded.report?.version ?? 0,
        ...draft,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workKeys.report(tenantCode, queryDate),
      });
    },
  });
  const empty = SECTIONS.every(({ key }) => draft[key].trim() === "");
  const doneTasks = loaded.reference.tasks.filter(
    (task) => task.status === "DONE",
  );
  return (
    <form
      className={styles.reportForm}
      aria-label={`${loaded.workDate} 日报`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty) save.mutate();
      }}
    >
      {SECTIONS.map(({ key, label }) => (
        <label key={key} className={styles.reportField}>
          <span>{label}</span>
          <Input.TextArea
            aria-label={label}
            rows={key === "completed" ? 4 : 2}
            maxLength={4000}
            value={draft[key]}
            onChange={(event) =>
              setDraft({ ...draft, [key]: event.target.value })
            }
          />
        </label>
      ))}
      {doneTasks.length > 0 ? (
        <Button
          size="small"
          type="link"
          className={styles.fillButton}
          onClick={() =>
            setDraft({
              ...draft,
              completed: [
                draft.completed.trim(),
                ...doneTasks.map(
                  (task) =>
                    `· ${task.title}${task.result ? `：${task.result}` : ""}`,
                ),
              ]
                .filter(Boolean)
                .join("\n"),
            })
          }
        >
          填入当天完成的任务
        </Button>
      ) : null}
      {save.isError ? (
        <Alert
          type="error"
          showIcon
          title={toApiError(save.error).message}
          action={
            toApiError(save.error).status === 409 ? (
              <Button size="small" onClick={onReload}>
                重新载入
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <div className={styles.formActions}>
        {loaded.report ? (
          <Typography.Text type="secondary">
            已保存 {dayjs(loaded.report.updatedAt).format("MM-DD HH:mm")}
          </Typography.Text>
        ) : null}
        <Button
          type="primary"
          htmlType="submit"
          loading={save.isPending}
          disabled={empty}
        >
          保存日报
        </Button>
      </div>
    </form>
  );
}

/** What the system recorded for the day, shown beside a report. */
export function ReportReference({
  counts,
  tasks,
}: {
  counts: WorkCounts;
  tasks: DailyReportView["reference"]["tasks"];
}) {
  const facts: Array<[string, string]> = [
    ["电话", `${counts.calls}（接通 ${counts.connectedCalls}）`],
    ["微信/消息", `${counts.messages}`],
    ["新加微信", `${counts.wechatAdded}`],
    ["拜访", `${counts.visits}`],
    ["跟进客户", `${counts.customersFollowed}`],
    ["完成的跟进待办", `${counts.followUpsDone}`],
    ["完成的任务", `${counts.tasksDone}`],
  ];
  return (
    <aside className={styles.reference} aria-label="当天记录">
      <h3>当天记录</h3>
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {tasks.length > 0 ? (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{task.title}</span>
              <Tag
                color={
                  task.status === "DONE"
                    ? "success"
                    : task.status === "OPEN"
                      ? "warning"
                      : undefined
                }
              >
                {task.status === "DONE"
                  ? "已完成"
                  : task.status === "OPEN"
                    ? "未完成"
                    : "已取消"}
              </Tag>
            </li>
          ))}
        </ul>
      ) : null}
      <p>按动态里登记的电话、微信和拜访统计；没有登记的沟通不会出现。</p>
    </aside>
  );
}
