"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Select, Typography } from "antd";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";

import {
  MEMBER_ACTIVITY_TYPES,
  type MemberActivityType,
  type RecordActivity,
  type RecordApi,
} from "./record-api";

import styles from "./records.module.css";

const ACTIVITY_TYPE_LABELS: Record<MemberActivityType, string> = {
  CALL: "电话",
  MESSAGE: "消息",
  MEETING: "拜访",
  NOTE: "备注",
};

export interface RecordActivityTimelineProps {
  tenantCode: string;
  objectCode: string;
  recordId: string;
  canCreate: boolean;
  api: RecordApi;
}

export function RecordActivityTimeline({
  tenantCode,
  objectCode,
  recordId,
  canCreate,
  api,
}: RecordActivityTimelineProps) {
  const queryClient = useQueryClient();
  const [activityType, setActivityType] = useState<MemberActivityType>("NOTE");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string>();
  const queryKey = [
    "workspace",
    tenantCode,
    "objects",
    objectCode,
    "records",
    recordId,
    "activities",
  ];

  const activities = useQuery({
    queryKey,
    queryFn: () => api.listActivities(tenantCode, objectCode, recordId),
  });

  const create = useMutation({
    mutationFn: () =>
      api.createActivity(tenantCode, objectCode, recordId, {
        activityType,
        content: content.trim(),
      }),
    onSuccess: () => {
      setContent("");
      setError(undefined);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  return (
    <section className={styles.timeline} aria-label="跟进记录">
      <div className={styles.timelineHeading}>
        <h2>跟进记录</h2>
        <Typography.Text type="secondary">
          按时间追加，不能修改或覆盖已有记录。
        </Typography.Text>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      {canCreate ? (
        <Form component={false} layout="vertical" className={styles.timelineComposer}>
          <div className={styles.timelineComposerRow}>
            <Form.Item label="类型" htmlFor="activity-type">
              <Select
                id="activity-type"
                value={activityType}
                onChange={setActivityType}
                options={MEMBER_ACTIVITY_TYPES.map((type) => ({
                  value: type,
                  label: ACTIVITY_TYPE_LABELS[type],
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item label="内容" htmlFor="activity-content">
            <Input.TextArea
              id="activity-content"
              rows={3}
              maxLength={4000}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Form.Item>
          <Button
            type="primary"
            loading={create.isPending}
            disabled={content.trim() === ""}
            onClick={() => create.mutate()}
          >
            追加跟进
          </Button>
        </Form>
      ) : (
        <Typography.Text type="secondary">
          当前权限只能查看跟进记录，不能追加。
        </Typography.Text>
      )}

      {activities.isError ? (
        <Alert
          type="error"
          showIcon
          title={toApiError(activities.error).message}
        />
      ) : null}

      <ol className={styles.timelineList}>
        {(activities.data?.items ?? []).map((activity) => (
          <TimelineItem key={activity.id} activity={activity} />
        ))}
      </ol>

      {activities.isSuccess && activities.data.total === 0 ? (
        <Typography.Text type="secondary">还没有跟进记录。</Typography.Text>
      ) : null}
    </section>
  );
}

function TimelineItem({ activity }: { activity: RecordActivity }) {
  return (
    <li className={styles.timelineItem}>
      <div className={styles.timelineItemMeta}>
        <strong>{ACTIVITY_TYPE_LABELS[activity.activityType]}</strong>
        <span>{activity.actorDisplayName ?? "未知成员"}</span>
        <time dateTime={activity.createdAt}>
          {formatActivityTime(activity.createdAt)}
        </time>
      </div>
      <p>{activity.content}</p>
    </li>
  );
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
