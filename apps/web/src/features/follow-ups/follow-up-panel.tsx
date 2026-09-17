"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Segmented,
  Select,
  Skeleton,
  Tag,
} from "antd";
import Link from "next/link";
import { toApiError } from "@/lib/api/api-error";
import {
  followUpApi,
  followUpQueryKeys,
  type FollowUp,
  type FollowUpStatus,
} from "./follow-up-api";
import styles from "./follow-ups.module.css";

export function FollowUpPanel({
  tenantCode,
  record,
  api = followUpApi,
}: {
  tenantCode: string;
  record?: { id: string; objectCode: string; canCreate: boolean };
  api?: typeof followUpApi;
}) {
  const client = useQueryClient();
  const [status, setStatus] = useState<FollowUpStatus>("OPEN");
  const [page, setPage] = useState(1);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [rescheduling, setRescheduling] = useState<FollowUp>();
  const [reassigning, setReassigning] = useState<FollowUp>();
  const [assignee, setAssignee] = useState<string>();
  const recipients = useQuery({
    queryKey: ["follow-up-recipients", tenantCode, reassigning?.id],
    queryFn: () => api.recipients(tenantCode, reassigning!.id),
    enabled: !!reassigning,
  });
  const [newDate, setNewDate] = useState("");
  const [error, setError] = useState<string>();
  const key = followUpQueryKeys.root(tenantCode);
  const query = useQuery({
    queryKey: [...key, record?.id, status, page],
    queryFn: () =>
      api.list(tenantCode, {
        recordId: record?.id,
        status,
        page,
        limit: record ? 5 : 20,
      }),
    refetchInterval: 60_000,
  });
  const refresh = () => {
    setError(undefined);
    void client.invalidateQueries({ queryKey: key });
  };
  const fail = (caught: unknown) => setError(toApiError(caught).message);
  const create = useMutation({
    mutationFn: () =>
      api.create(tenantCode, {
        objectCode: record!.objectCode,
        recordId: record!.id,
        title: title.trim(),
        dueAt: new Date(dueAt).toISOString(),
      }),
    onSuccess: () => {
      setTitle("");
      setDueAt("");
      setStatus("OPEN");
      setPage(1);
      refresh();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: ({
      task,
      ...change
    }: {
      task: FollowUp;
      assigneeMemberId?: string;
      status?: "DONE" | "CANCELLED";
      dueAt?: string;
    }) => api.update(tenantCode, task.id, { version: task.version, ...change }),
    onSuccess: () => {
      setRescheduling(undefined);
      setReassigning(undefined);
      refresh();
    },
    onError: (caught) => {
      fail(caught);
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const validDate = (value: string) =>
    !!value && Number.isFinite(new Date(value).getTime());
  return (
    <section
      className={styles.panel}
      aria-label={record ? "记录跟进事项" : "我的跟进待办"}
    >
      <div className={styles.heading}>
        <div>
          <h2>{record ? "记录跟进事项" : "我的跟进待办"}</h2>
          <p>
            {record
              ? "为自己安排下一步，完成后保留记录。管理员可查看和处理此记录的所有跟进事项。"
              : "只显示分配给你、且你当前有权查看的记录事项。到期未完成即为逾期。"}
          </p>
        </div>
        {query.data && (
          <div className={styles.counts}>
            <span>
              待跟进 <strong>{query.data.openCount}</strong>
            </span>
            <span
              className={query.data.overdueCount ? styles.overdue : undefined}
            >
              已逾期 <strong>{query.data.overdueCount}</strong>
            </span>
          </div>
        )}
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
      {record?.canCreate && (
        <Form
          layout="vertical"
          className={styles.composer}
          onFinish={() => create.mutate()}
        >
          <Form.Item label="跟进事项" htmlFor="follow-up-title">
            <Input
              id="follow-up-title"
              placeholder="例如：确认客户反馈"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="下次跟进时间（本地时间）" htmlFor="follow-up-date">
            <Input
              id="follow-up-date"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={create.isPending}
            disabled={!title.trim() || !validDate(dueAt)}
          >
            安排跟进
          </Button>
        </Form>
      )}
      <Segmented
        block={!record}
        size="small"
        aria-label="跟进状态"
        value={status}
        options={[
          { label: "待跟进", value: "OPEN" },
          { label: "已逾期", value: "OVERDUE" },
          { label: "已完成", value: "DONE" },
          { label: "已取消", value: "CANCELLED" },
        ]}
        onChange={(value) => {
          setStatus(value as FollowUpStatus);
          setPage(1);
        }}
      />
      {query.isLoading && <Skeleton active paragraph={{ rows: 2 }} />}
      {query.isError && (
        <Alert
          type="error"
          title="待办暂时无法加载"
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}
      {query.data?.items.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            status === "OVERDUE"
              ? "目前没有逾期事项"
              : status === "OPEN"
                ? "暂无待跟进事项，从业务记录详情安排下一步。"
                : "暂无记录"
          }
        />
      )}
      <ul className={styles.list}>
        {query.data?.items.map((task) => (
          <li key={task.id} className={styles.task}>
            <div className={styles.taskBody}>
              <div className={styles.taskTitle}>
                <strong>{task.title}</strong>
                {task.overdue && <Tag color="error">已逾期</Tag>}
              </div>
              {!record && (
                <Link
                  href={`/workspace/${tenantCode}/objects/${task.objectCode}/${task.recordId}`}
                >
                  {task.recordTitle}{" "}
                  <span className={styles.muted}>· {task.objectName}</span>
                </Link>
              )}
              {record && (
                <span className={styles.muted}>
                  事项负责人：{task.assigneeName ?? "成员"}
                </span>
              )}
              <time dateTime={task.dueAt}>
                {new Date(task.dueAt).toLocaleString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </time>
            </div>
            {task.status === "OPEN" && task.canManage && (
              <div className={styles.actions}>
                <Button
                  size="small"
                  type="primary"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ task, status: "DONE" })}
                >
                  完成
                </Button>
                <Button
                  size="small"
                  disabled={update.isPending}
                  onClick={() => {
                    setRescheduling(task);
                    setNewDate(toLocalInput(task.dueAt));
                  }}
                >
                  改期
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setReassigning(task);
                    setAssignee(undefined);
                  }}
                >
                  转交
                </Button>
                <Popconfirm
                  title="取消这项跟进？"
                  description="取消后仍保留在已取消记录中。"
                  okText="确认取消"
                  cancelText="保留"
                  onConfirm={() => update.mutate({ task, status: "CANCELLED" })}
                >
                  <Button size="small" type="text" disabled={update.isPending}>
                    取消
                  </Button>
                </Popconfirm>
              </div>
            )}
          </li>
        ))}
      </ul>
      {query.data && query.data.total > query.data.limit && (
        <Pagination
          size="small"
          current={page}
          total={query.data.total}
          pageSize={query.data.limit}
          showSizeChanger={false}
          onChange={setPage}
        />
      )}
      <Modal
        title="转交跟进事项"
        open={!!reassigning}
        onCancel={() => setReassigning(undefined)}
        okText="确认转交"
        cancelText="取消"
        confirmLoading={update.isPending}
        okButtonProps={{ disabled: !assignee }}
        onOk={() => {
          if (reassigning && assignee)
            update.mutate({ task: reassigning, assigneeMemberId: assignee });
        }}
      >
        <p>仅可转交给当前有权查看和更新该记录的在职成员。</p>
        {recipients.error && (
          <Alert type="error" title={toApiError(recipients.error).message} />
        )}
        <Select
          aria-label="接手成员"
          style={{ width: "100%" }}
          value={assignee}
          onChange={setAssignee}
          loading={recipients.isFetching}
          options={recipients.data?.map((m) => ({
            label: m.displayName,
            value: m.id,
          }))}
        />
      </Modal>
      <Modal
        title="调整跟进时间"
        open={!!rescheduling}
        onCancel={() => setRescheduling(undefined)}
        okText="保存时间"
        cancelText="取消"
        confirmLoading={update.isPending}
        okButtonProps={{ disabled: !validDate(newDate) }}
        onOk={() => {
          if (rescheduling && validDate(newDate))
            update.mutate({
              task: rescheduling,
              dueAt: new Date(newDate).toISOString(),
            });
        }}
      >
        <Form layout="vertical">
          <Form.Item label="新的跟进时间（本地时间）" htmlFor="reschedule-date">
            <Input
              id="reschedule-date"
              type="datetime-local"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
function toLocalInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
