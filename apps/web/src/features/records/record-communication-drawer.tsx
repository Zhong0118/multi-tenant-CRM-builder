"use client";

import { CommentOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Modal } from "antd";
import { useState } from "react";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { canEditRecord } from "./record-access";
import type { RecordApi } from "./record-api";
import {
  ACTIVITY_TYPE_LABELS,
  OUTCOME_LABELS,
  RecordActivityTimeline,
} from "./record-activity-timeline";
import { formatDateTime } from "./record-display-value";
import styles from "./record-communication.module.css";

export function RecordCommunicationPreview({
  record,
  onOpen,
}: {
  record: RecordSummary;
  onOpen: () => void;
}) {
  const activity = record.latestActivity;
  if (activity === undefined)
    return <span className={styles.unavailable}>—</span>;
  return (
    <button
      type="button"
      className={styles.preview}
      onClick={onOpen}
      aria-label={`查看动态 ${record.title}`}
    >
      {activity ? (
        <>
          <span className={styles.tags}>
            <span className={styles.kind} data-kind={activity.activityType}>
              {ACTIVITY_TYPE_LABELS[activity.activityType]}
            </span>
            {activity.outcome && (
              <span className={styles.outcome} data-outcome={activity.outcome}>
                {OUTCOME_LABELS[activity.activityType][activity.outcome]}
              </span>
            )}
          </span>
          <span className={styles.excerpt}>{activity.content}</span>
          <span className={styles.meta}>
            {activity.actorDisplayName ?? "未知成员"} ·{" "}
            {formatDateTime(activity.createdAt)}
          </span>
        </>
      ) : (
        <span className={styles.empty}>
          <CommentOutlined aria-hidden />
          暂无沟通记录<span className={styles.openHint}>查看</span>
        </span>
      )}
    </button>
  );
}

export function RecordCommunicationDrawer({
  tenantCode,
  schema,
  record,
  currentMemberId,
  isAdmin,
  api,
  onClose,
  onCreated,
}: {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  record: RecordSummary;
  currentMemberId?: string;
  isAdmin: boolean;
  api: RecordApi;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState({ dirty: false, saving: false });
  const [modal, contextHolder] = Modal.useModal();
  const detail = useQuery({
    queryKey: [
      "workspace",
      tenantCode,
      "objects",
      schema.object.code,
      "records",
      record.id,
      "communication-detail",
    ],
    queryFn: () => api.detail(tenantCode, schema.object.code, record.id),
    staleTime: 0,
  });
  const close = () => {
    if (draft.saving) return;
    if (!draft.dirty) {
      setOpen(false);
      return;
    }
    modal.confirm({
      title: "放弃未保存的沟通内容？",
      content: "关闭后本次输入不会保存",
      okText: "放弃并关闭",
      cancelText: "继续填写",
      onOk: () => setOpen(false),
    });
  };
  const current = detail.data;
  const accessLost =
    detail.isError && [401, 403, 404].includes(toApiError(detail.error).status);
  const restricted = Boolean(current?.inPublicPool && !isAdmin);
  return (
    <>
      {contextHolder}
      <Drawer
        open={open}
        afterOpenChange={(visible) => {
          if (!visible) onClose();
        }}
        size={560}
        styles={{ wrapper: { maxWidth: "100vw" } }}
        title="沟通动态"
        onClose={close}
        closable={!draft.saving}
        maskClosable={!draft.saving}
        keyboard={!draft.saving}
      >
        <div className={styles.heading}>
          <strong>{record.title}</strong>
          <span>#{record.recordNo}</span>
        </div>
        {detail.isError && (
          <Alert
            type="error"
            showIcon
            title={toApiError(detail.error).message}
            action={<Button onClick={() => detail.refetch()}>重试</Button>}
          />
        )}
        {detail.isPending ? (
          <p className={styles.meta}>正在加载记录…</p>
        ) : accessLost ? null : restricted ? (
          <Alert type="info" title="公共池预览不展示沟通历史，请领取后查看" />
        ) : current ? (
          <RecordActivityTimeline
            tenantCode={tenantCode}
            objectCode={schema.object.code}
            recordId={current.id}
            canCreate={canEditRecord(schema, current, currentMemberId, isAdmin)}
            canDelete={isAdmin}
            api={api}
            onDraftStateChange={setDraft}
            onCreated={async () => {
              await onCreated();
              await detail.refetch();
            }}
          />
        ) : null}
      </Drawer>
    </>
  );
}
