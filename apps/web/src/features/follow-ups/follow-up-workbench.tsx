"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "antd";
import { useState } from "react";
import { toApiError } from "@/lib/api/api-error";
import {
  followUpApi,
  followUpQueryKeys,
  type FollowUpWorkbench,
  type FollowUpWorkbenchItem,
} from "./follow-up-api";
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
}: {
  tenantCode: string;
  api?: typeof followUpApi;
}) {
  const client = useQueryClient();
  const [error, setError] = useState<string>();

  const query = useQuery({
    queryKey: followUpQueryKeys.workbench(tenantCode),
    queryFn: () => api.workbench(tenantCode),
    refetchInterval: 60_000,
  });

  const complete = useMutation({
    mutationFn: (task: FollowUpWorkbenchItem) =>
      api.update(tenantCode, task.id, {
        version: task.version,
        status: "DONE",
      }),
    onSuccess: async () => {
      setError(undefined);
      await client.invalidateQueries({
        queryKey: followUpQueryKeys.root(tenantCode),
      });
    },
    onError: async (caught) => {
      setError(toApiError(caught).message);
      await client.invalidateQueries({
        queryKey: followUpQueryKeys.root(tenantCode),
      });
    },
  });

  const data: FollowUpWorkbench | undefined = query.data;
  const hasItems =
    data !== undefined &&
    BUCKETS.some((bucket) => data.preview[bucket.key].length > 0);

  return (
    <section
      className={styles.workbench}
      data-testid="personal-follow-up-workbench"
      aria-label="我的跟进"
    >
      <div className={styles.workbenchHeading}>
        <div>
          <h2>我的跟进</h2>
          <p>只显示分配给你、且你当前有权查看的记录事项。</p>
        </div>
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable
          onClose={() => setError(undefined)}
        />
      )}

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

      {data && (
        <>
          <div className={styles.workbenchCounts}>
            <span>
              全部待办
              <strong data-testid="workbench-count-all">
                {data.counts.allOpen}
              </strong>
            </span>
            <span className={data.counts.overdue ? styles.overdue : undefined}>
              已逾期
              <strong data-testid="workbench-count-overdue">
                {data.counts.overdue}
              </strong>
            </span>
            <span>
              今日
              <strong data-testid="workbench-count-today">
                {data.counts.today}
              </strong>
            </span>
            <span>
              未来7天
              <strong data-testid="workbench-count-upcoming">
                {data.counts.upcoming}
              </strong>
            </span>
          </div>

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
              >
                <h3 className={styles.bucketTitle}>{bucket.label}</h3>
                <ul className={styles.list}>
                  {items.map((task) => (
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
                          href={`/workspace/${tenantCode}/objects/${task.objectCode}/${task.recordId}`}
                        >
                          {task.recordTitle}{" "}
                          <span className={styles.muted}>
                            · {task.objectName}
                          </span>
                        </Link>
                        <time dateTime={task.dueAt}>
                          {formatTenantDue(task.dueAt, data.timezone)}
                        </time>
                      </div>
                      {task.canManage && (
                        <div className={styles.actions}>
                          <Button
                            size="small"
                            type="primary"
                            data-testid={`workbench-complete-${task.id}`}
                            disabled={complete.isPending}
                            onClick={() => complete.mutate(task)}
                          >
                            完成
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <Link
            className={styles.workbenchAll}
            href={`/workspace/${tenantCode}/follow-ups`}
          >
            查看全部跟进
          </Link>
        </>
      )}
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
