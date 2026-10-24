"use client";

import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Segmented,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";

import { useToast } from "@/components/feedback/use-toast";
import { DueLabel } from "@/components/workbench/due-label";
import { StatusTag } from "@/components/workbench/status-tag";
import { useTenantTimezone } from "@/features/follow-ups/use-tenant-timezone";
import { useNow } from "@/lib/format/use-now";
import { useLeaveGuard } from "@/lib/hooks/use-leave-guard";

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
  const [status, setStatus] = useState<"OPEN" | "DONE" | "CANCELLED">("OPEN");
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
          setStatus(value as "OPEN" | "DONE" | "CANCELLED");
          setPage(1);
        }}
        options={[
          { value: "OPEN", label: "进行中" },
          { value: "DONE", label: "已完成" },
          { value: "CANCELLED", label: "已取消" },
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
        <Alert
          type="error"
          showIcon
          title={`任务读取失败：${toApiError(query.error).message}`}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
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
            status === "OPEN"
              ? "没有进行中的任务"
              : status === "DONE"
                ? "还没有完成的任务"
                : "没有取消的任务"
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
  const toast = useToast();
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
      toast.success(
        assignee ? `已给${assignee.name}安排「${title.trim()}」` : `已添加「${title.trim()}」`,
      );
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
  const toast = useToast();
  const timeZone = useTenantTimezone(tenantCode);
  const now = useNow();
  const [completing, setCompleting] = useState(false);
  const [result, setResult] = useState(task.result);
  const update = useMutation({
    mutationFn: (body: Parameters<WorkApi["updateTask"]>[2]) =>
      api.updateTask(tenantCode, task.id, body),
    onSuccess: async (_saved, body) => {
      setCompleting(false);
      toast.success(
        body.status === "DONE"
          ? `已完成「${task.title}」`
          : body.status === "CANCELLED"
            ? `已取消「${task.title}」`
            : `已重新打开「${task.title}」`,
      );
      // The day's report lists the system's task record beside the text.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workKeys.allTasks(tenantCode),
        }),
        queryClient.invalidateQueries({
          queryKey: ["workspace", tenantCode, "daily-report"],
        }),
      ]);
    },
  });
  const assignedBySomeoneElse =
    task.createdByMemberId !== task.assigneeMemberId;
  return (
    <li className={styles.task} data-status={task.status}>
      <div className={styles.taskMain}>
        <span className={styles.taskTitleRow}>
          <strong>{task.title}</strong>
          {task.status === "DONE" ? (
            <StatusTag tone="success">已完成</StatusTag>
          ) : task.status === "CANCELLED" ? (
            <StatusTag tone="neutral">已取消</StatusTag>
          ) : task.overdue ? (
            <StatusTag tone="danger">已逾期</StatusTag>
          ) : null}
        </span>
        <span className={styles.taskMeta}>
          <DueLabel
            dueAt={task.dueAt}
            timeZone={timeZone}
            now={now}
            settled={task.status !== "OPEN"}
            prefix="截止"
          />
          {showAssignee ? <span>负责人 {task.assigneeName}</span> : null}
          {assignedBySomeoneElse && !showAssignee ? (
            <span>由 {task.createdByName} 安排</span>
          ) : null}
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
            <Popconfirm
              title={`取消「${task.title}」？`}
              description="取消后仍可在「已取消」中找到并重新打开。"
              okText="取消任务"
              cancelText="保留"
              okButtonProps={{ danger: true }}
              onConfirm={() =>
                update.mutate({ version: task.version, status: "CANCELLED" })
              }
            >
              <Button
                size="small"
                type="text"
                danger
                loading={update.isPending}
              >
                取消任务
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      )}
      {update.isError ? (
        <Alert
          type="error"
          showIcon
          title={`${toApiError(update.error).message}（请求编号：${toApiError(update.error).requestId}）`}
        />
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
  const [dirty, setDirty] = useState(false);
  const [switchTo, setSwitchTo] = useState<string>();
  const guard = useLeaveGuard(dirty);
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
        <span className={styles.reportDate}>
          {loaded ? <span>{weekdayOf(loaded.workDate)}</span> : null}
          <DatePicker
            aria-label="日报日期"
            size="small"
            allowClear={false}
            value={loaded ? dayjs(loaded.workDate) : null}
            disabledDate={(day) =>
              loaded ? day.isAfter(dayjs(loaded.today), "day") : false
            }
            onChange={(day) => {
              if (!day) return;
              const next = day.format("YYYY-MM-DD");
              if (dirty) setSwitchTo(next);
              else setWorkDate(next);
            }}
          />
        </span>
      }
    >
      {view.isError ? (
        <Alert
          type="error"
          showIcon
          title={`日报读取失败：${toApiError(view.error).message}`}
          action={
            <Button size="small" onClick={() => void view.refetch()}>
              重试
            </Button>
          }
        />
      ) : null}
      {view.isLoading ? <Typography.Text type="secondary">正在载入日报…</Typography.Text> : null}
      {loaded ? (
        <div className={styles.report}>
          {/* Keyed by day and version: a loaded or saved report starts a fresh draft. */}
          <ReportForm
            key={`${loaded.workDate}:${loaded.report?.version ?? 0}`}
            tenantCode={tenantCode}
            api={api}
            loaded={loaded}
            queryDate={workDate}
            onDirtyChange={setDirty}
            onReload={() => void view.refetch()}
          />
          <ReportReference
            counts={loaded.reference.counts}
            tasks={loaded.reference.tasks}
          />
        </div>
      ) : null}
      <Modal
        open={switchTo !== undefined || guard.pending !== null}
        title="放弃未保存的日报？"
        okText="放弃修改"
        cancelText="继续编辑"
        okButtonProps={{ danger: true }}
        onCancel={() => {
          setSwitchTo(undefined);
          guard.stay();
        }}
        onOk={() => {
          setDirty(false);
          if (switchTo) {
            setWorkDate(switchTo);
            setSwitchTo(undefined);
          } else {
            guard.leave();
          }
        }}
      >
        <p>这一天的日报有修改还没有保存。放弃后，本机暂存的草稿也会删除。</p>
      </Modal>
    </PageSection>
  );
}

function weekdayOf(workDate: string) {
  return `周${"日一二三四五六"[new Date(`${workDate}T00:00:00Z`).getUTCDay()]}`;
}

/** Where an unsaved report is kept between reloads, per company, member and day. */
function draftKey(tenantCode: string, memberId: string, workDate: string) {
  return `crm.daily-report-draft.v1.${tenantCode}.${memberId}.${workDate}`;
}

function readDraft(key: string): { sections: Sections; savedAt: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sections?: Partial<Sections>; savedAt?: string };
    if (!parsed.sections || typeof parsed.savedAt !== "string") return null;
    const sections = { ...emptySections };
    for (const { key: section } of SECTIONS) {
      const value = parsed.sections[section];
      if (typeof value === "string") sections[section] = value;
    }
    return { sections, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

function sameSections(a: Sections, b: Sections) {
  return SECTIONS.every(({ key }) => a[key] === b[key]);
}

function ReportForm({
  tenantCode,
  api,
  loaded,
  queryDate,
  onDirtyChange,
  onReload,
}: {
  tenantCode: string;
  api: WorkApi;
  loaded: DailyReportView;
  queryDate: string;
  onDirtyChange: (dirty: boolean) => void;
  onReload: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useTenantTimezone(tenantCode);
  const saved: Sections = loaded.report
    ? {
        plans: loaded.report.plans,
        completed: loaded.report.completed,
        problems: loaded.report.problems,
        nextSteps: loaded.report.nextSteps,
      }
    : emptySections;
  const key = draftKey(tenantCode, loaded.memberId, loaded.workDate);
  const [draft, setDraft] = useState<Sections>(saved);
  // A draft kept from before a reload, offered back rather than applied, and
  // only when it is newer than what was saved to the server.
  const [recovery, setRecovery] = useState(() => {
    const kept = readDraft(key);
    if (!kept || sameSections(kept.sections, saved)) return null;
    if (loaded.report && loaded.report.updatedAt > kept.savedAt) return null;
    return kept;
  });
  const dirty = loaded.canEdit && !sameSections(draft, saved);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (!loaded.canEdit || typeof window === "undefined") return;
    if (dirty) {
      window.localStorage.setItem(
        key,
        JSON.stringify({ sections: draft, savedAt: new Date().toISOString() }),
      );
    } else if (!recovery) {
      window.localStorage.removeItem(key);
    }
  }, [dirty, draft, key, loaded.canEdit, recovery]);

  const save = useMutation({
    mutationFn: () =>
      api.saveReport(tenantCode, loaded.workDate, {
        version: loaded.report?.version ?? 0,
        ...draft,
      }),
    onSuccess: async () => {
      window.localStorage.removeItem(key);
      toast.success(`${loaded.workDate} 的日报已保存`);
      await queryClient.invalidateQueries({
        queryKey: workKeys.report(tenantCode, queryDate),
      });
    },
  });
  const empty = SECTIONS.every(({ key: section }) => draft[section].trim() === "");
  const doneTasks = loaded.reference.tasks.filter(
    (task) => task.status === "DONE",
  );
  const readOnly = !loaded.canEdit;
  return (
    <form
      className={styles.reportForm}
      aria-label={`${loaded.workDate} 日报`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !readOnly) save.mutate();
      }}
    >
      {readOnly ? (
        <Alert
          type="info"
          showIcon
          title="这一天的日报只能查看"
          description="日报只能在当天或之后补写自己的；这一天不能再修改。"
        />
      ) : null}
      {recovery ? (
        <Alert
          type="warning"
          showIcon
          title={`有一份未保存的日报草稿（${dayjs(recovery.savedAt).format("MM-DD HH:mm")} 暂存在本机）`}
          action={
            <span className={styles.recoveryActions}>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  setDraft(recovery.sections);
                  setRecovery(null);
                }}
              >
                恢复草稿
              </Button>
              <Button
                size="small"
                onClick={() => {
                  window.localStorage.removeItem(key);
                  setRecovery(null);
                }}
              >
                丢弃
              </Button>
            </span>
          }
        />
      ) : null}
      {SECTIONS.map(({ key: section, label }) => (
        <label key={section} className={styles.reportField}>
          <span>{label}</span>
          <Input.TextArea
            aria-label={label}
            rows={section === "completed" ? 4 : 2}
            maxLength={4000}
            value={draft[section]}
            readOnly={readOnly}
            disabled={save.isPending}
            onChange={(event) =>
              setDraft({ ...draft, [section]: event.target.value })
            }
          />
        </label>
      ))}
      {doneTasks.length > 0 && !readOnly ? (
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
          title={`${toApiError(save.error).message}（请求编号：${toApiError(save.error).requestId}）`}
          description={
            toApiError(save.error).status === 409
              ? "日报在别处更新过。你的修改仍保存在本机，重新载入后可以恢复。"
              : "你的修改仍在这里，也已暂存在本机。"
          }
          action={
            toApiError(save.error).status === 409 ? (
              <Button size="small" onClick={onReload}>
                重新载入
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {readOnly ? null : (
        <div className={styles.formActions}>
          <Typography.Text type="secondary" className={styles.saveState}>
            {dirty
              ? "有未保存的修改（已暂存在本机）"
              : loaded.report
                ? `已保存 · ${new Intl.DateTimeFormat("zh-CN", { timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(loaded.report.updatedAt))}`
                : "还没有保存"}
          </Typography.Text>
          <Button
            type="primary"
            htmlType="submit"
            loading={save.isPending}
            disabled={empty || !dirty}
          >
            保存日报
          </Button>
        </div>
      )}
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
              <StatusTag
                tone={
                  task.status === "DONE"
                    ? "success"
                    : task.status === "OPEN"
                      ? "warning"
                      : "neutral"
                }
              >
                {task.status === "DONE"
                  ? "已完成"
                  : task.status === "OPEN"
                    ? "未完成"
                    : "已取消"}
              </StatusTag>
            </li>
          ))}
        </ul>
      ) : null}
      <p>按动态里登记的电话、微信和拜访统计；没有登记的沟通不会出现。</p>
    </aside>
  );
}
