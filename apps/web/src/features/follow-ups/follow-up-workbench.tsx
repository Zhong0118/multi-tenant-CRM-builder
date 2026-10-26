"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { sourceRecordHref } from "@/features/records/source-navigation";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "antd";
import { useState } from "react";
import {
  followUpApi,
  followUpQueryKeys,
  type FollowUpWorkbench,
  type FollowUpWorkbenchItem,
} from "./follow-up-api";
import { PendingContacts } from "./pending-contacts";
import { FollowUpCompletionDialog } from "./follow-up-completion";
import { describeDue } from "@/lib/format/due";
import { useNow } from "@/lib/format/use-now";
import {
  workApi,
  workKeys,
  type WorkApi,
  type WorkTaskPage,
} from "@/features/work/work-api";
import styles from "./follow-ups.module.css";

const BUCKETS = [
  { key: "overdue", label: "已逾期" },
  { key: "today", label: "今日" },
  { key: "upcoming", label: "近期" },
] as const;

/**
 * The employee-home Personal Follow-up Workbench (§9).
 *
 * It is a fixed block, not a published Dashboard widget: personal execution data
 * must not depend on an administrator configuring anything. Completion goes
 * through the ordinary versioned Follow-up PATCH — there is no home-page write
 * shortcut — and a failure here never breaks the Dashboard below it.
 */
export function PersonalFollowUpWorkbench({
  tenantCode,
  api = followUpApi,
  work = workApi,
}: {
  tenantCode: string;
  api?: typeof followUpApi;
  work?: WorkApi;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const source = `${pathname}${search ? `?${search}` : ""}`;
  const [completing, setCompleting] = useState<FollowUpWorkbenchItem>();

  const query = useQuery({
    queryKey: followUpQueryKeys.workbench(tenantCode),
    queryFn: () => api.workbench(tenantCode),
    refetchInterval: 60_000,
  });
  const tasks = useQuery({
    queryKey: workKeys.tasks(tenantCode, { scope: "mine", status: "OPEN" }),
    queryFn: () =>
      work.listTasks(tenantCode, { scope: "mine", status: "OPEN" }),
    refetchInterval: 60_000,
  });
  const now = useNow();

  const data: FollowUpWorkbench | undefined = query.data;
  const hasItems =
    data !== undefined &&
    BUCKETS.some((bucket) => data.preview[bucket.key].length > 0);
  const quiet =
    data !== undefined &&
    !hasItems &&
    !data.pendingContacts.count &&
    tasks.isSuccess &&
    tasks.data.total === 0;
  return (
    <section
      className={styles.agenda}
      data-testid="personal-follow-up-workbench"
      aria-label="我的跟进"
      data-quiet={quiet || undefined}
    >
      <header className={styles.agendaHead}>
        <h2>今天要处理</h2>
        {data ? (
          <ul className={styles.agendaCounts} aria-label="跟进待办数量">
            <li data-tone={data.counts.overdue ? "danger" : undefined}>
              已逾期
              <strong data-testid="workbench-count-overdue">
                {data.counts.overdue}
              </strong>
            </li>
            <li data-tone={data.counts.today ? "warning" : undefined}>
              今日
              <strong data-testid="workbench-count-today">
                {data.counts.today}
              </strong>
            </li>
            <li>
              未来7天
              <strong data-testid="workbench-count-upcoming">
                {data.counts.upcoming}
              </strong>
            </li>
            <li>
              全部待办
              <strong data-testid="workbench-count-all">
                {data.counts.allOpen}
              </strong>
            </li>
          </ul>
        ) : null}
        <span className={styles.agendaLinks}>
          <Link href={`/workspace/${tenantCode}/follow-ups`}>查看全部跟进</Link>
          <Link href={`/workspace/${tenantCode}/work`}>任务与日报</Link>
        </span>
      </header>
      {query.isLoading && <Skeleton active paragraph={{ rows: 2 }} />}
      {query.isError && (
        <Alert
          type="error"
          title="跟进事项暂时无法加载"
          action={
            <Button
              data-testid="workbench-retry"
              onClick={() => void query.refetch()}
            >
              重试
            </Button>
          }
        />
      )}
      {data && quiet ? (
        <p className={styles.workbenchEmpty}>
          今天没有需要处理的跟进事项，也没有进行中的任务。
        </p>
      ) : null}
      {data && !quiet ? (
        <div className={styles.agendaBody}>
          <div className={styles.agendaColumn}>
            <h3 className={styles.agendaColumnTitle}>跟进</h3>
            {!hasItems && (
              <p className={styles.workbenchEmpty}>
                今天没有需要处理的跟进事项
              </p>
            )}
            {BUCKETS.map((bucket) => {
              const items = data.preview[bucket.key];
              if (!items.length) return null;
              return (
                <section
                  key={bucket.key}
                  className={styles.bucket}
                  data-testid={`workbench-bucket-${bucket.key}`}
                  aria-label={bucket.label}
                >
                  <h4 className={styles.bucketTitle}>{bucket.label}</h4>
                  <ul className={styles.list}>
                    {items.map((task) => {
                      const due = describeDue(task.dueAt, data.timezone, now);
                      return (
                        <li
                          key={task.id}
                          className={styles.task}
                          data-testid={`workbench-item-${task.id}`}
                        >
                          <div className={styles.taskBody}>
                            <div className={styles.taskTitle}>
                              <strong>{task.title}</strong>
                            </div>
                            <Link
                              data-testid={`workbench-link-${task.id}`}
                              href={sourceRecordHref(
                                tenantCode,
                                task.objectCode,
                                task.recordId,
                                source,
                                task.id,
                              )}
                            >
                              {task.recordTitle}{" "}
                              <span className={styles.muted}>
                                · {task.objectName}
                              </span>
                            </Link>
                          </div>
                          <time
                            dateTime={task.dueAt}
                            title={due.full}
                            className={styles.due}
                            data-tone={due.tone}
                          >
                            {/今天|明天/.test(due.label)
                              ? null
                              : formatTenantDue(task.dueAt, data.timezone)}
                            <span>{due.label}</span>
                          </time>
                          {task.canManage && (
                            <div className={styles.actions}>
                              <Button
                                size="small"
                                data-testid={`workbench-complete-${task.id}`}
                                disabled={!!completing}
                                onClick={() => setCompleting(task)}
                              >
                                完成
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          <div className={styles.agendaColumn}>
            <MyOpenTasks
              tenantCode={tenantCode}
              timeZone={data.timezone}
              now={now}
              query={tasks}
            />
            <PendingContacts tenantCode={tenantCode} data={data} />
          </div>
        </div>
      ) : null}
      {completing ? <FollowUpCompletionDialog tenantCode={tenantCode} task={completing} api={api} onClose={() => setCompleting(undefined)} /> : null}
    </section>
  );
}

/** My open work tasks, the late ones first; a failure stays inside this block. */
function MyOpenTasks({
  tenantCode,
  timeZone,
  now,
  query,
}: {
  tenantCode: string;
  timeZone: string;
  now: number;
  query: ReturnType<typeof useQuery<WorkTaskPage>>;
}) {
  const open = (query.data?.items ?? [])
    .filter((task) => task.status === "OPEN")
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const total = query.data?.total ?? 0;
  return (
    <section className={styles.bucket} aria-label="我的任务">
      <h3 className={styles.agendaColumnTitle}>
        我的任务
        {total ? <span className={styles.muted}>{total} 项进行中</span> : null}
      </h3>
      {query.isError ? (
        <Alert
          type="error"
          title="任务暂时无法加载"
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      ) : query.isLoading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      ) : open.length === 0 ? (
        <p className={styles.workbenchEmpty}>没有进行中的任务</p>
      ) : (
        <ul className={styles.list}>
          {open.slice(0, 5).map((task) => {
            const due = describeDue(task.dueAt, timeZone, now);
            return (
              <li key={task.id} className={styles.task}>
                <div className={styles.taskBody}>
                  <div className={styles.taskTitle}>
                    <strong>{task.title}</strong>
                  </div>
                  <span className={styles.muted}>
                    {task.createdByMemberId === task.assigneeMemberId
                      ? "自己的计划"
                      : `${task.createdByName} 安排`}
                  </span>
                </div>
                <time
                  dateTime={task.dueAt}
                  title={due.full}
                  className={styles.due}
                  data-tone={due.tone}
                >
                  <span>{due.label}</span>
                </time>
              </li>
            );
          })}
        </ul>
      )}
      {total > 5 ? (
        <Link
          className={styles.workbenchAll}
          href={`/workspace/${tenantCode}/work`}
        >
          还有 {total - 5} 项，去任务与日报
        </Link>
      ) : null}
    </section>
  );
}

/**
 * Due times are rendered in the tenant's timezone, never the browser's: the
 * buckets were computed on the tenant calendar, so a locally-formatted time
 * could contradict the section it appears in.
 */
function formatTenantDue(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
