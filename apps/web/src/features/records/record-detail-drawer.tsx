"use client";

import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Popconfirm, Space, Typography } from "antd";
import { useRef, useState } from "react";

import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { relationRequest } from "@/lib/api/relation-request";
import { toApiError } from "@/lib/api/api-error";

import type { DynamicFieldMember } from "./dynamic-field";
import { RecordAttachmentsPanel } from "@/features/attachments/record-attachments-panel";
import { RecordRelationsPanel } from "./record-relations-panel";
import { FollowUpPanel } from "@/features/follow-ups/follow-up-panel";
import { RecordActivityTimeline } from "./record-activity-timeline";
import { RecordAutomationPanel } from "@/features/automations/record-automation-panel";
import { RecordWorkflowPanel } from "./record-workflow-panel";
import { displayValue } from "./record-list";
import { displayRecordOwner, formatDateTime } from "./record-display-value";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";
import { defaultRecordColumnKeys } from "./record-columns";
import { RecordForm } from "./record-form";
import { canEditRecord, canEditRecordFields, recordFields } from "./record-access";

import { RecordOwnershipActions, RecordPoolStatus } from "./record-pool";
import type { RecordPoolConfig } from "./record-pool-api";
import styles from "./records.module.css";

export interface RecordDetailDrawerProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  record: RecordSummary;
  members?: DynamicFieldMember[];
  currentMemberId?: string;
  canChooseOwner?: boolean;
  canDelete?: boolean;
  initialEditing?: boolean;
  poolConfig?: RecordPoolConfig;
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
  currentMemberId,
  canChooseOwner = false,
  canDelete = false,
  initialEditing = false,
  poolConfig,
  followUpId,
  api = defaultRecordApi,
  onClose,
  onChanged,
}: RecordDetailDrawerProps) {
  const poolPreview = record.inPublicPool && !canChooseOwner;
  const canOperate = canEditRecord(schema, record, currentMemberId, canChooseOwner);
  const canEdit = canEditRecordFields(
    schema,
    record,
    currentMemberId,
    canChooseOwner,
  );
  const [editing, setEditing] = useState(initialEditing && canEdit);
  const [editingRecord, setEditingRecord] = useState<RecordSummary | undefined>(
    initialEditing && canEdit ? record : undefined,
  );
  const editSession = useRef(0);
  // Capture ownership while rendering the form, before its HTTP save starts.
  const session = editSession.current;
  const [error, setError] = useState<string>();
  const [refreshWarning, setRefreshWarning] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const fields = recordFields(schema, record);
  const summaryKeys = new Set([
    schema.object.titleFieldKey,
    ...defaultRecordColumnKeys(schema),
  ]);
  // Observe the panels' existing list caches; these observers never request counts.
  const relations = useQuery<unknown[]>({
    queryKey: ["relations", tenantCode, schema.object.code, record.id],
    queryFn: () => relationRequest<unknown[]>(`/api/v1/workspaces/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(schema.object.code)}/records/${encodeURIComponent(record.id)}/relations`),
    enabled: false,
  });
  const attachments = useQuery<unknown[]>({
    queryKey: ["attachments", tenantCode, schema.object.code, record.id],
    queryFn: skipToken,
  });
  const renderFields = (selected: typeof fields) => (
    <dl className={styles.detailFields}>
      {selected.map((field) => (
        <div key={field.id} className={styles.detailField}>
          <dt>
            {field.label}
            {field.access === "READ_ONLY" ? (
              <span className={styles.detailLock}>只读</span>
            ) : null}
          </dt>
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
      setEditingRecord(undefined);
      setEditing(false);
      setError(undefined);
      try {
        await onChanged(null);
        onClose();
      } catch {
        const message =
          "记录已删除，但刷新暂时失败。请返回列表重新载入，不要重复删除。";
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
      classNames={{
        mask: styles.detailMask,
        header: styles.detailHeader,
        body: styles.detailBody,
      }}
      onClose={onClose}
      destroyOnHidden
      title={
        <div className={styles.detailTitle}>
          <span>{record.title}</span>
          <span className={styles.recordNo}>#{record.recordNo}</span>
        </div>
      }
      extra={
        <Space size={4}>
          {canEdit && !editing && !deleted ? (
            <Button
              onClick={() => {
                setEditingRecord(record);
                setEditing(true);
              }}
            >
              编辑
            </Button>
          ) : null}
          {canDelete ? (
            <Popconfirm
              title="确认删除该记录？"
              description="删除后成员不再看到这条记录，历史数据仍会保留。"
              okText="删除记录"
              onConfirm={() => remove.mutate()}
            >
              <Button
                danger
                type="text"
                loading={remove.isPending}
                disabled={deleted}
              >
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      }
    >
      {refreshWarning ? (
        <Alert type="warning" showIcon title={refreshWarning} />
      ) : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}

      {deleted ? (
        <Button onClick={onClose}>返回列表</Button>
      ) : editing && !poolPreview ? (
        <RecordForm
          tenantCode={tenantCode}
          schema={schema}
          record={editingRecord ?? record}
          members={members}
          canChooseOwner={canChooseOwner}
          api={api}
          onSaved={async (saved) => {
            try {
              await onChanged(saved);
            } catch {
              const message =
                "记录已保存，但刷新暂时失败。请重新载入查看最新记录，不要重复提交。";
              setRefreshWarning(message);
            } finally {
              if (editSession.current === session) {
                setEditingRecord(undefined);
                setEditing(false);
              }
            }
          }}
          onCancel={() => {
            editSession.current += 1;
            setEditingRecord(undefined);
            setEditing(false);
          }}
        />
      ) : (
        <>
          {poolConfig?.enabled || canChooseOwner || record.inPublicPool ? (
            <div className={styles.detailOwnership}>
              {poolConfig?.enabled || record.inPublicPool ? <RecordPoolStatus record={record} config={poolConfig} /> : null}
              <RecordOwnershipActions key={`${record.id}:${record.version}`} tenantCode={tenantCode} objectCode={schema.object.code} record={record} schema={schema} config={poolConfig} currentMemberId={currentMemberId} isAdmin={canChooseOwner} members={members} onChanged={async (action) => {
                if (action === "RELEASE" || action === "UNPROTECT_RELEASE" || (action === "ASSIGN" && !canChooseOwner)) {
                  onClose();
                  await onChanged(null);
                } else {
                  await onChanged(await api.detail(tenantCode, schema.object.code, record.id));
                }
              }} />
            </div>
          ) : null}
          {record.poolStage ? (
            <section aria-label="流转信息" className={styles.poolConfigPreview}>
              {record.poolClaimedAt ? (
                <p>领取 / 分配于 {formatDateTime(record.poolClaimedAt)}</p>
              ) : null}
              {record.poolLastFollowUpAt ? (
                <p>最近有效跟进 {formatDateTime(record.poolLastFollowUpAt)}</p>
              ) : null}
              {record.poolProtectedAt ? (
                <p>保护开始于 {formatDateTime(record.poolProtectedAt)}</p>
              ) : null}
              {record.poolOrigin ? (
                <p>
                  领取来源{" "}
                  {record.poolOrigin === "LEAD_POOL"
                    ? (poolConfig?.labels?.leadPool ?? "初始公共池")
                    : (poolConfig?.labels?.customerPool ?? "已联系公共池")}
                </p>
              ) : null}
              {record.poolReason ? (
                <p>最近流转原因 {record.poolReason}</p>
              ) : null}
              {record.poolStage === "FOLLOWING" ? (
                <p>
                  成功新增有内容的跟进活动会续期，普通编辑和未来待办不会续期
                </p>
              ) : null}
              {record.protectionNeedsReview ? (
                <Alert
                  type="warning"
                  title="有效保护依据已发生变化，暂保留保护，请管理员复核关联业务记录后处理"
                />
              ) : null}
            </section>
          ) : null}
          {poolPreview ? <Alert type="info" showIcon title="公共池记录仅供预览，领取后可编辑和跟进" /> : null}
          <section aria-label="记录摘要" className={styles.detailSummary}>
            {renderFields(
              fields.filter((field) => summaryKeys.has(field.fieldKey)),
            )}
            <div className={styles.detailMeta}>
              <Typography.Text type="secondary">
                负责人：
                {displayRecordOwner(record.ownerMemberId, members, currentMemberId)}
              </Typography.Text>
              <Typography.Text type="secondary">
                更新于{" "}
                <time dateTime={record.updatedAt}>
                  {formatDateTime(record.updatedAt)}
                </time>
              </Typography.Text>
            </div>
          </section>

          {!poolPreview && schema.workflowEnabled !== false ? <RecordWorkflowPanel
            tenantCode={tenantCode}
            objectCode={schema.object.code}
            recordId={record.id}
            recordVersion={record.version}
            onRecordChanged={() =>
              api
                .detail(tenantCode, schema.object.code, record.id)
                .then(onChanged)
            }
          /> : null}

          {!poolPreview ? <RecordAutomationPanel
            key={`${record.id}:${schema.object.code}`}
            tenantCode={tenantCode} objectCode={schema.object.code} recordId={record.id}
            recordVersion={record.version} members={members}
            onRecordChanged={() => api.detail(tenantCode, schema.object.code, record.id).then(onChanged)}
          /> : null}

          {!poolPreview ? <FollowUpPanel
            onCompleted={async () => { await onChanged(await api.detail(tenantCode, schema.object.code, record.id)); }}
            tenantCode={tenantCode}
            followUpId={followUpId}
            record={{
              id: record.id,
              objectCode: schema.object.code,
              canCreate: canOperate,
            }}
          /> : null}

          {!poolPreview ? <RecordActivityTimeline
            onCreated={poolConfig?.lifecycleEnabled ? async () => { await onChanged(await api.detail(tenantCode, schema.object.code, record.id)); } : undefined}
            tenantCode={tenantCode}
            objectCode={schema.object.code}
            recordId={record.id}
            canCreate={canOperate}
            api={api}
          /> : null}
          <details className={styles.detailDisclosure}>
            <summary>完整业务字段</summary>
            {renderFields(fields)}
          </details>
          {!poolPreview ? <details className={styles.detailDisclosure}>
            <summary>
              关联业务记录
              {relations.data
                ? `（${relations.data.length || "暂无关联"}）`
                : "（展开查看）"}
            </summary>
            <RecordRelationsPanel
              tenantCode={tenantCode}
              objectCode={schema.object.code}
              recordId={record.id}
              canUpdate={canOperate}
            />
          </details> : null}
          {!poolPreview ? <details className={styles.detailDisclosure}>
            <summary>
              附件
              {attachments.data
                ? `（${attachments.data.length || "暂无附件"}）`
                : "（展开查看）"}
            </summary>
            <RecordAttachmentsPanel
              tenantCode={tenantCode}
              objectCode={schema.object.code}
              recordId={record.id}
              canUpdate={canOperate}
            />
          </details> : null}
        </>
      )}
    </Drawer>
  );
}
