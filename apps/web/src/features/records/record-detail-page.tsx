"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Popconfirm, Space, Tabs } from "antd";
import Link from "next/link";
import { useRef, useState } from "react";

import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { relationRequest } from "@/lib/api/relation-request";

import { RecordAttachmentsPanel } from "@/features/attachments/record-attachments-panel";
import { FollowUpPanel } from "@/features/follow-ups/follow-up-panel";
import { RecordAutomationPanel } from "@/features/automations/record-automation-panel";
import type { DynamicFieldMember } from "./dynamic-field";
import { RecordActivityTimeline } from "./record-activity-timeline";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";
import { defaultRecordColumnKeys } from "./record-columns";
import {
  displayRecordOwner,
  displayValue,
  formatDateTime,
} from "./record-display-value";
import { RecordForm } from "./record-form";
import { RecordOwnershipActions, RecordPoolStatus } from "./record-pool";
import type { RecordPoolConfig } from "./record-pool-api";
import { RecordRelationsPanel } from "./record-relations-panel";
import { RecordWorkflowPanel } from "./record-workflow-panel";

import styles from "./record-detail-page.module.css";

export interface RecordDetailPageProps {
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
  returnTo?: string;
  api?: RecordApi;
  onClose: () => void;
  onChanged: (record: RecordSummary | null) => void | Promise<void>;
}

/**
 * The record as a full page rather than a drawer. The left column is the
 * property sheet (fields, owner, pool state); the right is a sticky panel of
 * tabs for follow-ups, activity, relations, attachments, workflow and
 * automations. Editing replaces the left column with the form.
 */
export function RecordDetailPage({
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
  returnTo,
  api = defaultRecordApi,
  onClose,
  onChanged,
}: RecordDetailPageProps) {
  const poolPreview = record.inPublicPool && !canChooseOwner;
  const canEdit = schema.actions.canUpdate && !poolPreview;
  const [editing, setEditing] = useState(initialEditing && canEdit);
  const [editingRecord, setEditingRecord] = useState<RecordSummary | undefined>(
    initialEditing && canEdit ? record : undefined,
  );
  const editSession = useRef(0);
  const session = editSession.current;
  const [error, setError] = useState<string>();
  const [refreshWarning, setRefreshWarning] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const fields = schema.fields.filter((field) => field.access !== "HIDDEN");
  const summaryKeys = new Set([
    schema.object.titleFieldKey,
    ...defaultRecordColumnKeys(schema),
  ]);
  // Observe the relations and attachments caches so the tab labels can show
  // counts without fetching — the panels below own the actual requests.
  const relations = useQuery<unknown[]>({
    queryKey: ["relations", tenantCode, schema.object.code, record.id],
    queryFn: () =>
      relationRequest<unknown[]>(
        `/api/v1/workspaces/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(schema.object.code)}/records/${encodeURIComponent(record.id)}/relations`,
      ),
    enabled: false,
  });
  const attachments = useQuery<unknown[]>({
    queryKey: ["attachments", tenantCode, schema.object.code, record.id],
    queryFn: skipToken,
  });

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
        setRefreshWarning(
          "记录已删除，但刷新暂时失败。请返回列表重新载入，不要重复删除。",
        );
      }
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  const renderFields = (selected: typeof fields) => (
    <dl className={styles.fields}>
      {selected.map((field) => (
        <div key={field.id} className={styles.field}>
          <dt>
            {field.label}
            {field.access === "READ_ONLY" ? (
              <span className={styles.fieldLock}>仅管理员可编辑</span>
            ) : null}
          </dt>
          <dd>{displayValue(field, record.values[field.fieldKey], members)}</dd>
        </div>
      ))}
    </dl>
  );

  const listPath = `/workspace/${tenantCode}/objects/${schema.object.code}`;
  const backHref = returnTo
    ? `/workspace/${tenantCode}/objects/${schema.object.code}`
    : listPath;

  return (
    <div className={styles.page} role="article" aria-label={`${record.title} #${record.recordNo}`}>
      <header className={styles.header}>
        <Link href={backHref} className={styles.back} onClick={onClose}>
          <ArrowLeftOutlined aria-hidden />
          返回列表
        </Link>
        <div className={styles.title}>
          <span className={styles.name}>{record.title}</span>
          <span className={styles.no}>#{record.recordNo}</span>
        </div>
        <div className={styles.actions}>
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
        </div>
      </header>

      <div className={styles.body}>
        <main className={styles.main}>
          {refreshWarning ? (
            <Alert type="warning" showIcon message={refreshWarning} />
          ) : null}
          {error ? <Alert type="error" showIcon message={error} /> : null}

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
                  setRefreshWarning(
                    "记录已保存，但刷新暂时失败。请重新载入查看最新记录，不要重复提交。",
                  );
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
              {(poolConfig?.enabled || canChooseOwner || record.inPublicPool) && (
                <section className={styles.section} aria-label="负责人与流转">
                  <h2 className={styles.sectionHeading}>负责人与流转</h2>
                  <div className={styles.ownerRow}>
                    {poolConfig?.enabled || record.inPublicPool ? (
                      <RecordPoolStatus record={record} config={poolConfig} />
                    ) : null}
                    <RecordOwnershipActions
                      key={`${record.id}:${record.version}`}
                      tenantCode={tenantCode}
                      objectCode={schema.object.code}
                      record={record}
                      schema={schema}
                      config={poolConfig}
                      currentMemberId={currentMemberId}
                      isAdmin={canChooseOwner}
                      members={members}
                      onChanged={async (action) => {
                        if (
                          action === "RELEASE" ||
                          action === "UNPROTECT_RELEASE" ||
                          (action === "ASSIGN" && !canChooseOwner)
                        ) {
                          onClose();
                          await onChanged(null);
                        } else {
                          await onChanged(
                            await api.detail(
                              tenantCode,
                              schema.object.code,
                              record.id,
                            ),
                          );
                        }
                      }}
                    />
                  </div>
                  {record.poolStage ? (
                    <div className={styles.poolMeta}>
                      {record.poolClaimedAt ? (
                        <p>领取 / 分配于 {formatDateTime(record.poolClaimedAt)}</p>
                      ) : null}
                      {record.poolLastFollowUpAt ? (
                        <p>
                          最近有效跟进 {formatDateTime(record.poolLastFollowUpAt)}
                        </p>
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
                          message="有效保护依据已发生变化，暂保留保护，请管理员复核关联业务记录后处理"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </section>
              )}

              {poolPreview ? (
                <Alert
                  type="info"
                  showIcon
                  message="公共池记录仅供预览，领取后可编辑和跟进"
                  className={styles.poolAlert}
                />
              ) : null}

              <section className={styles.section} aria-label="记录摘要">
                <h2 className={styles.sectionHeading}>记录摘要</h2>
                {renderFields(
                  fields.filter((field) => summaryKeys.has(field.fieldKey)),
                )}
                <div className={styles.meta}>
                  <span>
                    负责人：
                    {displayRecordOwner(
                      record.ownerMemberId,
                      members,
                      currentMemberId,
                    )}
                  </span>
                  <span>
                    更新于{" "}
                    <time dateTime={record.updatedAt}>
                      {formatDateTime(record.updatedAt)}
                    </time>
                  </span>
                </div>
              </section>

              <section className={styles.section} aria-label="完整业务字段">
                <h2 className={styles.sectionHeading}>完整业务字段</h2>
                {renderFields(fields)}
              </section>
            </>
          )}
        </main>

        {!deleted && !editing && !poolPreview ? (
          <aside className={styles.aside}>
            <Tabs
              defaultActiveKey="followups"
              items={[
                {
                  key: "followups",
                  label: "跟进",
                  children: (
                    <FollowUpPanel
                      tenantCode={tenantCode}
                      followUpId={followUpId}
                      record={{
                        id: record.id,
                        objectCode: schema.object.code,
                        canCreate: canEdit,
                      }}
                    />
                  ),
                },
                {
                  key: "activity",
                  label: "动态",
                  children: (
                    <RecordActivityTimeline
                      onCreated={
                        poolConfig?.lifecycleEnabled
                          ? async () => {
                              await onChanged(
                                await api.detail(
                                  tenantCode,
                                  schema.object.code,
                                  record.id,
                                ),
                              );
                            }
                          : undefined
                      }
                      tenantCode={tenantCode}
                      objectCode={schema.object.code}
                      recordId={record.id}
                      canCreate={canEdit}
                      api={api}
                    />
                  ),
                },
                {
                  key: "relations",
                  label: `关联${
                    relations.data ? ` (${relations.data.length})` : ""
                  }`,
                  children: (
                    <RecordRelationsPanel
                      tenantCode={tenantCode}
                      objectCode={schema.object.code}
                      recordId={record.id}
                      canUpdate={canEdit}
                    />
                  ),
                },
                {
                  key: "attachments",
                  label: `附件${
                    attachments.data ? ` (${attachments.data.length})` : ""
                  }`,
                  children: (
                    <RecordAttachmentsPanel
                      tenantCode={tenantCode}
                      objectCode={schema.object.code}
                      recordId={record.id}
                      canUpdate={canEdit}
                    />
                  ),
                },
                {
                  key: "workflow",
                  label: "流程",
                  children: (
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
                  ),
                },
                {
                  key: "automations",
                  label: "自动化",
                  children: (
                    <RecordAutomationPanel
                      key={`${record.id}:${schema.object.code}`}
                      tenantCode={tenantCode}
                      objectCode={schema.object.code}
                      recordId={record.id}
                      recordVersion={record.version}
                      members={members}
                      onRecordChanged={() =>
                        api
                          .detail(tenantCode, schema.object.code, record.id)
                          .then(onChanged)
                      }
                    />
                  ),
                },
              ]}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
