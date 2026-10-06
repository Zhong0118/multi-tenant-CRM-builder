"use client";

import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Popconfirm, Space, Typography } from "antd";
import { useRef, useState } from "react";

import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import type { DynamicFieldMember } from "./dynamic-field";
import { RecordAttachmentsPanel } from "@/features/attachments/record-attachments-panel";
import { RecordRelationsPanel } from "./record-relations-panel";
import { FollowUpPanel } from "@/features/follow-ups/follow-up-panel";
import { RecordActivityTimeline } from "./record-activity-timeline";
import { RecordWorkflowPanel } from "./record-workflow-panel";
import { displayValue } from "./record-list";
import { formatDateTime } from "./record-display-value";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";
import { defaultRecordColumnKeys } from "./record-columns";
import { RecordForm } from "./record-form";

import styles from "./records.module.css";

export interface RecordDetailDrawerProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  record: RecordSummary;
  members?: DynamicFieldMember[];
  canChooseOwner?: boolean;
  canDelete?: boolean;
  initialEditing?: boolean;
  followUpId?: string;
  api?: RecordApi;
  onClose: () => void;
  onChanged: (record: RecordSummary | null) => void | Promise<void>;
}

/**
 * A record opened from the list. Reading is the default; editing is an explicit
 * step, so a member cannot change a value by accident while scanning. Soft
 * delete is administrator-only and states that the record stops being visible
 * rather than being destroyed.
 */
export function RecordDetailDrawer({
  tenantCode,
  schema,
  record,
  members = [],
  canChooseOwner = false,
  canDelete = false,
  initialEditing = false,
  followUpId,
  api = defaultRecordApi,
  onClose,
  onChanged,
}: RecordDetailDrawerProps) {
  const [editing, setEditing] = useState(initialEditing);
  // Each entry to or exit from edit mode starts a new session. A save's
  // callback keeps the session it was rendered with, so a late response from
  // a cancelled edit cannot close the edit the user started afterwards.
  const [editSession, setEditSession] = useState(0);
  const currentEditSession = useRef(0);
  const switchEditing = (next: boolean) => {
    currentEditSession.current += 1;
    setEditSession(currentEditSession.current);
    setEditing(next);
  };
  const [error, setError] = useState<string>();
  const [refreshWarning, setRefreshWarning] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const fields = schema.fields.filter((field) => field.access !== "HIDDEN");
  const summaryKeys = new Set([
    schema.object.titleFieldKey,
    ...defaultRecordColumnKeys(schema),
  ]);
  // Observe the panels' existing list caches; these observers never request counts.
  const relations = useQuery<unknown[]>({
    queryKey: ["relations", tenantCode, schema.object.code, record.id],
    queryFn: skipToken,
  });
  const attachments = useQuery<unknown[]>({
    queryKey: ["attachments", tenantCode, schema.object.code, record.id],
    queryFn: skipToken,
  });
  const renderFields = (selected: typeof fields) => (
    <dl className={styles.detailFields}>
      {selected.map((field) => (
        <div key={field.id} className={styles.detailField}>
          <dt>{field.label}{field.access === "READ_ONLY" ? <span className={styles.detailLock}>仅管理员可编辑</span> : null}</dt>
          <dd>{displayValue(field, record.values[field.fieldKey], members)}</dd>
        </div>
      ))}
    </dl>
  );

  const remove = useMutation({
    mutationFn: () =>
      api.remove(tenantCode, schema.object.code, record.id, record.version),
    onSuccess: async () => {
      setDeleted(true);
      setEditing(false);
      setError(undefined);
      try {
        await onChanged(null);
        onClose();
      } catch {
        const message = "记录已删除，但刷新暂时失败。请返回列表重新载入，不要重复删除。";
        setRefreshWarning(message);
      }
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  return (
    <Drawer
      open
      size={640}
      className={styles.detailDrawer}
      onClose={onClose}
      destroyOnHidden
      title={
        <div className={styles.detailTitle}>
          <span>{record.title}</span>
          <span className={styles.recordNo}>#{record.recordNo}</span>
        </div>
      }
      extra={
        <Space>
          {schema.actions.canUpdate && !editing && !deleted ? (
            <Button onClick={() => switchEditing(true)}>编辑</Button>
          ) : null}
          {canDelete ? (
            <Popconfirm
              title="确认删除该记录？"
              description="删除后成员不再看到这条记录，历史数据仍会保留。"
              okText="删除记录"
              onConfirm={() => remove.mutate()}
            >
              <Button danger loading={remove.isPending} disabled={deleted}>
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      }
    >
      {refreshWarning ? <Alert type="warning" showIcon title={refreshWarning} /> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}

      {deleted ? <Button onClick={onClose}>返回列表</Button> : editing ? (
        <RecordForm
          tenantCode={tenantCode}
          schema={schema}
          record={record}
          members={members}
          canChooseOwner={canChooseOwner}
          api={api}
          onSaved={async (saved) => {
            const session = editSession;
            try {
              await onChanged(saved);
            } catch {
              const message = "记录已保存，但刷新暂时失败。请重新载入查看最新记录，不要重复提交。";
              setRefreshWarning(message);
            } finally {
              if (currentEditSession.current === session) switchEditing(false);
            }
          }}
          onCancel={() => switchEditing(false)}
        />
      ) : (
        <>
          <section aria-label="记录摘要" className={styles.detailSummary}>
            {renderFields(fields.filter((field) => summaryKeys.has(field.fieldKey)))}
            <div className={styles.detailMeta}>
              <Typography.Text type="secondary">
                负责人：{members.find((member) => member.id === record.ownerMemberId)?.displayName ?? (record.ownerMemberId ? "已指定" : "未指定")}
              </Typography.Text>
              <Typography.Text type="secondary">
                更新于 <time dateTime={record.updatedAt}>{formatDateTime(record.updatedAt)}</time>
              </Typography.Text>
            </div>
          </section>

          <RecordWorkflowPanel
            tenantCode={tenantCode}
            objectCode={schema.object.code}
            recordId={record.id}
            recordVersion={record.version}
            onRecordChanged={() =>
              api
                .detail(tenantCode, schema.object.code, record.id)
                .then(onChanged)
            }
          />

          <FollowUpPanel
            tenantCode={tenantCode}
            followUpId={followUpId}
            record={{
              id: record.id,
              objectCode: schema.object.code,
              canCreate: schema.actions.canUpdate,
            }}
          />

          <RecordActivityTimeline
            tenantCode={tenantCode}
            objectCode={schema.object.code}
            recordId={record.id}
            canCreate={schema.actions.canUpdate}
            api={api}
          />
          <details className={styles.detailDisclosure}>
            <summary>完整业务字段</summary>
            {renderFields(fields)}
          </details>
          <details className={styles.detailDisclosure}>
            <summary>关联业务记录{relations.data ? `（${relations.data.length || "暂无关联"}）` : "（展开查看）"}</summary>
            <RecordRelationsPanel
              tenantCode={tenantCode}
              objectCode={schema.object.code}
              recordId={record.id}
              canUpdate={schema.actions.canUpdate}
            />
          </details>
          <details className={styles.detailDisclosure}>
            <summary>附件{attachments.data ? `（${attachments.data.length || "暂无附件"}）` : "（展开查看）"}</summary>
            <RecordAttachmentsPanel
              tenantCode={tenantCode}
              objectCode={schema.object.code}
              recordId={record.id}
              canUpdate={schema.actions.canUpdate}
            />
          </details>
        </>
      )}
    </Drawer>
  );
}
