"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Form, Input, Modal, Select } from "antd";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { useToast } from "@/components/feedback/use-toast";
import { toApiError } from "@/lib/api/api-error";
import {
  MEMBER_ACTIVITY_TYPES,
  OUTCOMES_BY_ACTIVITY_TYPE,
  type ActivityOutcome,
  type MemberActivityType,
} from "@/features/records/record-api";
import {
  followUpQueryKeys,
  type followUpApi,
  type FollowUp,
  type FollowUpCompletionResult,
} from "./follow-up-api";
import styles from "./follow-ups.module.css";

const TYPE_LABELS: Record<MemberActivityType, string> = {
  CALL: "电话",
  MESSAGE: "微信/消息",
  MEETING: "拜访",
  NOTE: "备注",
};
const OUTCOME_LABELS: Record<
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

export function FollowUpCompletionDialog({
  tenantCode,
  task,
  api,
  onClose,
  onCompleted,
}: {
  tenantCode: string;
  task: Pick<
    FollowUp,
    "id" | "version" | "title" | "objectCode" | "recordId" | "recordTitle"
  >;
  api: typeof followUpApi;
  onClose: () => void;
  onCompleted?: () => void | Promise<void>;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [modal, modalHolder] = Modal.useModal();
  const [open, setOpen] = useState(true);
  const [activityType, setActivityType] = useState<MemberActivityType>("NOTE");
  const [outcome, setOutcome] = useState<ActivityOutcome>();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string>();
  const [committed, setCommitted] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const committedRef = useRef(false);
  const submitting = useRef(false);
  const dirty =
    !committed && (!!content.trim() || activityType !== "NOTE" || !!outcome);
  const valid = content.trim().length > 0 && content.trim().length <= 4000;

  const save = useMutation({
    mutationFn: async () => {
      let verify = conflicted;
      // Once saved, a refresh failure may only retry reads, never append again.
      if (!committedRef.current) {
        if (!verify) {
          try {
            await api.update(tenantCode, task.id, {
              version: task.version,
              status: "DONE",
              completionResult: {
                activityType,
                content: content.trim(),
                ...(outcome ? { outcome } : {}),
              },
            });
          } catch (caught) {
            if (toApiError(caught).status !== 409) throw caught;
            verify = true;
            setConflicted(true);
          }
        }
        if (verify) {
          // A lost response can leave this version stale even though its write
          // committed. A conflict alone is not proof: read the saved result.
          const completed = await findCompletedFollowUp(
            api,
            tenantCode,
            task.recordId,
            task.id,
          );
          const result = completed?.completionResult;
          if (
            completed?.status !== "DONE" ||
            completed.version !== task.version + 1 ||
            !result ||
            result.activityType !== activityType ||
            result.content !== content.trim() ||
            (result.outcome ?? undefined) !== outcome
          ) {
            throw {
              code: "RECORD_VERSION_CONFLICT",
              status: 409,
              message: "跟进状态已变化，尚未确认当前填写的结果已保存。",
              requestId: "req_unknown",
              fieldErrors: {},
            };
          }
        }
        committedRef.current = true;
        setCommitted(true);
      }
      await Promise.all([
        client.invalidateQueries(
          { queryKey: followUpQueryKeys.root(tenantCode), refetchType: "all" },
          { throwOnError: true },
        ),
        client.invalidateQueries(
          {
            queryKey: [
              "workspace",
              tenantCode,
              "objects",
              task.objectCode,
              "records",
              task.recordId,
              "activities",
            ],
            refetchType: "all",
          },
          { throwOnError: true },
        ),
        client.invalidateQueries(
          {
            queryKey: ["workspace", tenantCode, "records"],
            refetchType: "all",
          },
          { throwOnError: true },
        ),
        onCompleted?.(),
      ]);
      return verify;
    },
    onSuccess: (recovered) => {
      toast.success(
        recovered
          ? `已确认「${task.title}」已完成，结果已保存`
          : `已完成「${task.title}」，结果已记入动态`,
      );
      setOpen(false);
    },
    onError: (caught) => {
      const failure = toApiError(caught);
      setError(
        committedRef.current
          ? "跟进已完成，结果已保存，但刷新失败。请重试刷新，不会重复提交结果。"
          : `${failure.message}${conflicted || failure.status === 409 ? "草稿已保留，请刷新状态后核对。" : ""}（请求编号：${failure.requestId}）`,
      );
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function dismiss() {
    if (submitting.current) return;
    if (!dirty) return setOpen(false);
    void modal.confirm({
      title: "放弃未保存的修改？",
      content: "完成结果还没有保存，离开后会丢失。",
      okText: "放弃修改",
      okButtonProps: { danger: true },
      cancelText: "继续编辑",
      onOk: () => setOpen(false),
    });
  }

  function submit() {
    if (submitting.current || (!committed && !conflicted && !valid)) return;
    submitting.current = true;
    setError(undefined);
    save.mutate();
  }

  return (
    <>
      {modalHolder}
      <Modal
        title="完成跟进"
        open={open}
        width={OVERLAY_SIZE.form}
        className={styles.completionDialog}
        onCancel={dismiss}
        afterClose={onClose}
        okText={
          committed && !save.isPending
            ? "重试刷新"
            : conflicted
              ? "刷新状态"
              : "保存并完成"
        }
        cancelText={committed ? "关闭" : "取消"}
        onOk={submit}
        confirmLoading={save.isPending}
        okButtonProps={{ disabled: !committed && !conflicted && !valid }}
        cancelButtonProps={{ disabled: save.isPending }}
        closable={!save.isPending}
        keyboard={!save.isPending}
        mask={{ closable: !save.isPending }}
      >
        <div className={styles.completionTask}>
          <strong>{task.title}</strong>
          <span>{task.recordTitle}</span>
        </div>
        {error ? (
          <Alert
            type={committed ? "warning" : "error"}
            showIcon
            title={error}
          />
        ) : null}
        <Form
          layout="vertical"
          disabled={save.isPending || committed}
          onFinish={submit}
        >
          <div className={styles.completionFields}>
            <Form.Item label="活动类型" htmlFor={`${id}-type`}>
              <Select
                id={`${id}-type`}
                value={activityType}
                onChange={(next: MemberActivityType) => {
                  setActivityType(next);
                  setOutcome(undefined);
                }}
                options={MEMBER_ACTIVITY_TYPES.map((type) => ({
                  value: type,
                  label: TYPE_LABELS[type],
                }))}
              />
            </Form.Item>
            {OUTCOMES_BY_ACTIVITY_TYPE[activityType].length > 0 ? (
              <Form.Item label="沟通结果" htmlFor={`${id}-outcome`}>
                <Select
                  id={`${id}-outcome`}
                  value={outcome}
                  allowClear
                  placeholder="未填写"
                  onChange={setOutcome}
                  options={OUTCOMES_BY_ACTIVITY_TYPE[activityType].map(
                    (value) => ({
                      value,
                      label: OUTCOME_LABELS[activityType][value],
                    }),
                  )}
                />
              </Form.Item>
            ) : null}
          </div>
          <Form.Item label="完成结果" htmlFor={`${id}-content`} required>
            <Input.TextArea
              id={`${id}-content`}
              autoFocus
              rows={4}
              maxLength={4000}
              showCount
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="记录本次处理情况和客户反馈"
            />
          </Form.Item>
          <p className={styles.completionHint}>
            保存后会追加到记录动态。仅明确登记联系成功的沟通结果，才会更新联系状态。
          </p>
        </Form>
      </Modal>
    </>
  );
}

async function findCompletedFollowUp(
  api: typeof followUpApi,
  tenantCode: string,
  recordId: string,
  taskId: string,
): Promise<FollowUp | undefined> {
  for (let page = 1; ; page++) {
    const result = await api.list(tenantCode, {
      recordId,
      status: "DONE",
      page,
      limit: 50,
    });
    const task = result.items.find(
      (item) => item.id === taskId && item.recordId === recordId,
    );
    if (task) return task;
    if (page * result.limit >= result.total) return undefined;
  }
}

export function FollowUpSavedResult({
  result,
  timeZone,
}: {
  result: FollowUpCompletionResult;
  timeZone: string;
}) {
  return (
    <div className={styles.completionResult} aria-label="完成结果">
      <div className={styles.completionMeta}>
        <strong>{TYPE_LABELS[result.activityType]}</strong>
        {result.outcome ? (
          <span>{OUTCOME_LABELS[result.activityType][result.outcome]}</span>
        ) : null}
        <span>{result.actorDisplayName ?? "未知成员"}</span>
        <time dateTime={result.completedAt}>
          {new Intl.DateTimeFormat("zh-CN", {
            timeZone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(result.completedAt))}
        </time>
      </div>
      <p>{result.content}</p>
    </div>
  );
}
