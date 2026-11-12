"use client";

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  Typography,
} from "antd";
import { type ReactNode, useEffect, useState } from "react";

import { followUpQueryKeys } from "@/features/follow-ups/follow-up-api";
import { goalKeys } from "@/features/work/work-goals-api";
import { toApiError } from "@/lib/api/api-error";

import {
  MEMBER_ACTIVITY_TYPES,
  OUTCOMES_BY_ACTIVITY_TYPE,
  type ActivityOutcome,
  type MemberActivityType,
  type RecordActivity,
  type RecordApi,
} from "./record-api";

import styles from "./records.module.css";

export const ACTIVITY_TYPE_LABELS: Record<MemberActivityType, string> = {
  CALL: "电话",
  MESSAGE: "微信/消息",
  MEETING: "拜访",
  NOTE: "备注",
};

/** Worded per kind of activity: an unanswered call is not an unanswered visit. */
export const OUTCOME_LABELS: Record<
  MemberActivityType,
  Partial<Record<ActivityOutcome, string>>
> = {
  CALL: { NOT_REACHED: "未接通", CONNECTED: "已接通" },
  MESSAGE: {
    NOT_REACHED: "未回复",
    CONNECTED: "已沟通",
    WECHAT_ADDED: "新加上微信",
  },
  MEETING: { CONNECTED: "已见面" },
  NOTE: {},
};

export interface RecordActivityTimelineProps {
  tenantCode: string;
  objectCode: string;
  recordId: string;
  canCreate: boolean;
  canDelete?: boolean;
  api: RecordApi;
  onCreated?: () => void | Promise<void>;
  onDraftStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}

export function RecordActivityTimeline({
  tenantCode,
  objectCode,
  recordId,
  canCreate,
  canDelete = false,
  api,
  onCreated,
  onDraftStateChange,
}: RecordActivityTimelineProps) {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [activityType, setActivityType] = useState<MemberActivityType>("NOTE");
  const [outcome, setOutcome] = useState<ActivityOutcome>();
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

  const activities = useInfiniteQuery({
    queryKey: [...queryKey, "history"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.listActivities(tenantCode, objectCode, recordId, {
        page: pageParam,
        limit: 20,
      }),
    getNextPageParam: (last) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
  });

  const create = useMutation({
    mutationFn: () =>
      api.createActivity(tenantCode, objectCode, recordId, {
        activityType,
        content: content.trim(),
        ...(outcome ? { outcome } : {}),
      }),
    onSuccess: async () => {
      setContent("");
      setOutcome(undefined);
      setError(undefined);
      void queryClient.invalidateQueries({ queryKey });
      try {
        await onCreated?.();
      } catch {
        setError(
          "活动已保存，但流转信息刷新失败，请刷新页面查看最新期限，不要重复提交",
        );
      }
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  const remove = useMutation({
    mutationFn: (activityId: string) =>
      api.deleteActivity(tenantCode, objectCode, recordId, activityId),
    onSuccess: async () => {
      setError(undefined);
      try {
        await Promise.all(
          [
            queryKey,
            ["workspace", tenantCode, "records", objectCode],
            followUpQueryKeys.root(tenantCode),
            ["workspace", tenantCode, "team-activity"],
            ["workspace", tenantCode, "daily-report"],
            ["workspace", tenantCode, "daily-reports"],
            goalKeys.progress(tenantCode),
          ].map((key) =>
            queryClient.invalidateQueries(
              { queryKey: key },
              { throwOnError: true },
            ),
          ),
        );
      } catch {
        setError("动态已删除，请刷新页面查看最新记录");
      }
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  useEffect(() => {
    onDraftStateChange?.({
      dirty: content.trim() !== "",
      saving: create.isPending,
    });
  }, [content, create.isPending, onDraftStateChange]);
  const items = [
    ...new Map(
      (activities.data?.pages.flatMap((page) => page.items) ?? []).map(
        (item) => [item.id, item],
      ),
    ).values(),
  ];

  return (
    <section className={styles.timeline} aria-label="活动历史">
      <h2 className={styles.visuallyHidden}>活动历史</h2>
      <div className={styles.timelineHeading}>
        <Typography.Text type="secondary">
          按时间追加，已有记录不能修改。
        </Typography.Text>
        {canCreate && !composing ? (
          <Button
            size="small"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setComposing(true)}
            aria-expanded={false}
          >
            追加活动
          </Button>
        ) : null}
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}
      {canCreate && composing ? (
        <Form
          component={false}
          layout="vertical"
          className={styles.timelineComposer}
        >
          <div className={styles.timelineComposerRow}>
            <Form.Item label="类型" htmlFor="activity-type">
              <Select
                id="activity-type"
                value={activityType}
                onChange={(next) => {
                  setActivityType(next);
                  setOutcome(undefined);
                }}
                options={MEMBER_ACTIVITY_TYPES.map((type) => ({
                  value: type,
                  label: ACTIVITY_TYPE_LABELS[type],
                }))}
              />
            </Form.Item>
            {OUTCOMES_BY_ACTIVITY_TYPE[activityType].length > 0 ? (
              <Form.Item label="结果" htmlFor="activity-outcome">
                <Select
                  id="activity-outcome"
                  allowClear
                  placeholder="未填写"
                  value={outcome}
                  onChange={(next: ActivityOutcome | undefined) =>
                    setOutcome(next)
                  }
                  options={OUTCOMES_BY_ACTIVITY_TYPE[activityType].map(
                    (key) => ({
                      value: key,
                      label: OUTCOME_LABELS[activityType][key],
                    }),
                  )}
                />
              </Form.Item>
            ) : null}
          </div>
          <Typography.Text type="secondary" className={styles.timelineHint}>
            结果记为已接通、已沟通、新加上微信或已见面，才算联系成功：等待联系的记录会进入下一阶段。未接通、未回复和备注不会。
          </Typography.Text>
          <Form.Item label="内容" htmlFor="activity-content">
            <Input.TextArea
              autoFocus
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
            保存活动
          </Button>
          <Button
            onClick={() => setComposing(false)}
            disabled={create.isPending}
          >
            收起表单
          </Button>
        </Form>
      ) : !canCreate ? (
        <Typography.Text type="secondary">
          当前权限只能查看活动历史，不能追加。
        </Typography.Text>
      ) : null}

      {activities.isError ? (
        <Alert
          type="error"
          showIcon
          title={toApiError(activities.error).message}
          action={
            <Button
              size="small"
              onClick={() =>
                activities.isFetchNextPageError
                  ? activities.fetchNextPage()
                  : activities.refetch()
              }
            >
              重试
            </Button>
          }
        />
      ) : null}

      <ol className={styles.timelineList}>
        {items.map((activity) => (
          <TimelineItem
            key={activity.id}
            activity={activity}
            deleting={remove.isPending && remove.variables === activity.id}
          >
            {canDelete && canCreate && activity.actorMemberId && (
              <Popconfirm
                title="删除这条沟通动态？"
                description="删除后无法恢复"
                okText="确认删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => remove.mutate(activity.id)}
              >
                <Button
                  size="small"
                  type="text"
                  danger
                  aria-label="删除动态"
                  className={styles.deleteActivity}
                  icon={<DeleteOutlined aria-hidden />}
                  disabled={remove.isPending}
                  loading={remove.isPending && remove.variables === activity.id}
                >
                  删除
                </Button>
              </Popconfirm>
            )}
          </TimelineItem>
        ))}
      </ol>

      {activities.isPending ? (
        <Typography.Text type="secondary">正在加载沟通记录…</Typography.Text>
      ) : null}
      {activities.hasNextPage ? (
        <Button
          block
          loading={activities.isFetchingNextPage}
          onClick={() => activities.fetchNextPage()}
        >
          加载更多动态
        </Button>
      ) : null}
      {activities.isSuccess && items.length === 0 ? (
        <Typography.Text type="secondary">还没有活动记录。</Typography.Text>
      ) : null}
    </section>
  );
}

function TimelineItem({
  activity,
  deleting,
  children,
}: {
  activity: RecordActivity;
  deleting: boolean;
  children: ReactNode;
}) {
  return (
    <li className={styles.timelineItem} data-deleting={deleting || undefined}>
      <div className={styles.timelineItemMeta}>
        <span className={styles.activityType} data-kind={activity.activityType}>
          {ACTIVITY_TYPE_LABELS[activity.activityType]}
        </span>
        {activity.outcome ? (
          <span
            className={styles.timelineOutcome}
            data-outcome={activity.outcome}
          >
            {OUTCOME_LABELS[activity.activityType][activity.outcome] ??
              activity.outcome}
          </span>
        ) : null}
        <span>{activity.actorDisplayName ?? "未知成员"}</span>
        <time dateTime={activity.createdAt}>
          {formatActivityTime(activity.createdAt)}
        </time>
        {children}
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
