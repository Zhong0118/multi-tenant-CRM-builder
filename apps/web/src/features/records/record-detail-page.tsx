"use client";

import { EllipsisOutlined, LeftOutlined, LockOutlined, RightOutlined } from "@ant-design/icons";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Collapse, Dropdown, Modal, Tooltip } from "antd";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ObjectIcon } from "@/components/navigation/object-icon";
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
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

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
  /** Where this record sits in the list it was opened from, for ‹ 3/17 › paging. */
  position?: { index: number; total: number; previousHref?: string; nextHref?: string };
  api?: RecordApi;
  onClose: () => void;
  onChanged: (record: RecordSummary | null) => void | Promise<void>;
}

/**
 * The record as a page of its own (Attio, HubSpot): a top bar with the way back,
 * paging through the list it came from and the record actions; a 360px sheet on
 * the left with who owns it and every field once; tabs with counts on the right.
 * Editing happens in the sheet, so the tabs stay in view.
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
  position,
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fields = schema.fields.filter((field) => field.access !== "HIDDEN");
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

  const ownershipVisible = Boolean(poolConfig?.enabled || canChooseOwner || record.inPublicPool);
  const poolLabel = (origin: string) =>
    origin === "LEAD_POOL"
      ? (poolConfig?.labels?.leadPool ?? "初始公共池")
      : (poolConfig?.labels?.customerPool ?? "已联系公共池");
  const poolFacts = record.poolStage
    ? [
        record.poolClaimedAt ? ["领取 / 分配", formatDateTime(record.poolClaimedAt)] : null,
        record.poolLastFollowUpAt ? ["最近有效跟进", formatDateTime(record.poolLastFollowUpAt)] : null,
        record.poolProtectedAt ? ["保护开始", formatDateTime(record.poolProtectedAt)] : null,
        record.poolOrigin ? ["领取来源", poolLabel(record.poolOrigin)] : null,
        record.poolReason ? ["最近流转原因", record.poolReason] : null,
      ].filter((fact): fact is string[] => fact !== null)
    : [];

  const refresh = () => api.detail(tenantCode, schema.object.code, record.id).then(onChanged);
  const listPath = `/workspace/${tenantCode}/objects/${schema.object.code}`;

  const [openSections, setOpenSections] = useState<string[]>(DEFAULT_OPEN_SECTIONS);
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(OPEN_SECTIONS_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(stored)) setOpenSections(stored.filter((key): key is string => typeof key === "string"));
    } catch {
      // A broken preference falls back to the default sections.
    }
  }, []);
  const saveOpenSections = (keys: string[]) => {
    setOpenSections(keys);
    try {
      window.localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(keys));
    } catch {
      // Storage refused: the sections still open and close for this visit.
    }
  };
  // The few values people look for first, above the sections (Attio's
  // highlights): selects, money, dates and people from the default columns.
  const highlightFields = fields
    .filter((field) => field.fieldKey !== schema.object.titleFieldKey)
    .filter((field) => HIGHLIGHT_TYPES.has(field.type))
    .slice(0, 3);
  const highlights: Array<{ key: string; label: string; value: ReactNode }> = [
    ...highlightFields.map((field) => ({
      key: field.fieldKey,
      label: field.label,
      value: displayValue(field, record.values[field.fieldKey], members),
    })),
    {
      key: "owner",
      label: "负责人",
      value: displayRecordOwner(record.ownerMemberId, members, currentMemberId),
    },
    { key: "updated", label: "最近更新", value: formatDateTime(record.updatedAt) },
  ];

  const tabs = [
    {
      key: "followups",
      label: "跟进",
      children: (
        <FollowUpPanel
          tenantCode={tenantCode}
          followUpId={followUpId}
          record={{ id: record.id, objectCode: schema.object.code, canCreate: canEdit }}
        />
      ),
    },
    {
      key: "activity",
      label: "动态",
      children: (
        <RecordActivityTimeline
          onCreated={poolConfig?.lifecycleEnabled ? async () => { await refresh(); } : undefined}
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
      label: <TabLabel label="关联" count={relations.data?.length} />,
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
      label: <TabLabel label="附件" count={attachments.data?.length} />,
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
          onRecordChanged={refresh}
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
          onRecordChanged={refresh}
        />
      ),
    },
  ];

  return (
    <div className={styles.page} role="article" aria-label={`${record.title} #${record.recordNo}`}>
      <header className={styles.topbar}>
        <nav className={styles.crumbs} aria-label="位置">
          <Link href={listPath} className={styles.crumbLink} onClick={(event) => { event.preventDefault(); onClose(); }}>
            <ObjectIcon name={schema.object.icon} />
            <span>{schema.object.name}</span>
          </Link>
          <span className={styles.crumbDivider} aria-hidden>/</span>
          <span className={styles.crumbCurrent}>{record.title}</span>
        </nav>
        <div className={styles.topActions}>
          {position && position.total > 1 ? (
            <div className={styles.pager} role="group" aria-label="逐条查看">
              <Tooltip title="上一条">
                <Button
                  type="text"
                  size="small"
                  aria-label="上一条"
                  icon={<LeftOutlined aria-hidden />}
                  disabled={!position.previousHref}
                  href={position.previousHref}
                />
              </Tooltip>
              <span className={styles.pagerText}>{position.index + 1} / {position.total}</span>
              <Tooltip title="下一条">
                <Button
                  type="text"
                  size="small"
                  aria-label="下一条"
                  icon={<RightOutlined aria-hidden />}
                  disabled={!position.nextHref}
                  href={position.nextHref}
                />
              </Tooltip>
            </div>
          ) : null}
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
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              disabled={deleted}
              menu={{
                items: [{ key: "delete", label: "删除记录", danger: true, onClick: () => setConfirmDelete(true) }],
              }}
            >
              <Button aria-label="更多操作" icon={<EllipsisOutlined aria-hidden />} loading={remove.isPending} disabled={deleted} />
            </Dropdown>
          ) : null}
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sheet} aria-label="记录信息">
          <div className={styles.identity}>
            <h1>{record.title}</h1>
            <p>
              <span className={styles.no}>#{record.recordNo}</span>
              <span aria-hidden>·</span>
              <span>
                更新于 <time dateTime={record.updatedAt}>{formatDateTime(record.updatedAt)}</time>
              </span>
            </p>
          </div>

          {refreshWarning ? <Alert type="warning" showIcon message={refreshWarning} /> : null}
          {error ? <Alert type="error" showIcon message={error} /> : null}

          {deleted ? (
            <Button onClick={onClose}>返回列表</Button>
          ) : editing && !poolPreview ? (
            <section className={styles.block} aria-label="编辑记录">
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
                    setRefreshWarning("记录已保存，但刷新暂时失败。请重新载入查看最新记录，不要重复提交。");
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
            </section>
          ) : (
            <>
              <section className={styles.block} aria-label="负责人与流转">
                <h2 className={styles.blockTitle}>归属</h2>
                <dl className={styles.fields}>
                  <div className={styles.field}>
                    <dt>负责人</dt>
                    <dd>{displayRecordOwner(record.ownerMemberId, members, currentMemberId)}</dd>
                  </div>
                  {poolConfig?.enabled || record.inPublicPool ? (
                    <div className={styles.field}>
                      <dt>归属状态</dt>
                      <dd><RecordPoolStatus record={record} config={poolConfig} /></dd>
                    </div>
                  ) : null}
                  {poolFacts.map(([label, value]) => (
                    <div key={label} className={styles.field}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {record.poolStage === "FOLLOWING" ? (
                  <p className={styles.hint}>成功新增有内容的跟进活动会续期，普通编辑和未来待办不会续期</p>
                ) : null}
                {record.protectionNeedsReview ? (
                  <Alert type="warning" message="有效保护依据已发生变化，暂保留保护，请管理员复核关联业务记录后处理" />
                ) : null}
                {ownershipVisible ? (
                  <div className={styles.ownerActions}>
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
                          await onChanged(await api.detail(tenantCode, schema.object.code, record.id));
                        }
                      }}
                    />
                  </div>
                ) : null}
              </section>

              {poolPreview ? (
                <Alert type="info" showIcon message="公共池记录仅供预览，领取后可编辑和跟进" />
              ) : null}

              <section className={styles.block} aria-label="业务字段">
                <h2 className={styles.blockTitle}>字段</h2>
                <dl className={styles.fields}>
                  {fields.map((field) => (
                    <div key={field.id} className={styles.field}>
                      <dt>
                        {field.label}
                        {field.access === "READ_ONLY" ? (
                          <Tooltip title="仅管理员可编辑">
                            <LockOutlined className={styles.fieldLock} aria-label="仅管理员可编辑" />
                          </Tooltip>
                        ) : null}
                      </dt>
                      <dd>{displayValue(field, record.values[field.fieldKey], members)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}
        </aside>

        {!deleted && !poolPreview ? (
          <main className={styles.sections}>
            {highlights.length ? (
              <dl className={styles.highlights} aria-label="关键信息">
                {highlights.map((item) => (
                  <div key={item.key} className={styles.highlight}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <Collapse
              className={styles.collapse}
              ghost
              activeKey={openSections}
              onChange={(keys) => saveOpenSections(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
              items={tabs.map((tab) => ({
                key: tab.key,
                label: tab.label,
                children: tab.children,
                // Relations and files fetch their counts when mounted, so their
                // headers can say how many there are while folded.
                forceRender: tab.key === "relations" || tab.key === "attachments",
              }))}
            />
          </main>
        ) : null}
      </div>

      <Modal
        open={confirmDelete}
        title="删除这条记录？"
        okText="删除记录"
        okButtonProps={{ danger: true, loading: remove.isPending }}
        cancelText="取消"
        width={OVERLAY_SIZE.confirm}
        onCancel={() => setConfirmDelete(false)}
        onOk={() => {
          setConfirmDelete(false);
          remove.mutate();
        }}
      >
        删除后成员不再看到这条记录，历史数据仍会保留。
      </Modal>
    </div>
  );
}

const OPEN_SECTIONS_KEY = "crm.record.open-sections";
const DEFAULT_OPEN_SECTIONS = ["followups", "activity", "relations"];
const HIGHLIGHT_TYPES = new Set(["SINGLE_SELECT", "MONEY", "NUMBER", "DATE", "DATETIME", "MEMBER"]);

function TabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <span className={styles.tabLabel}>
      {label}
      {count !== undefined ? <span className={styles.tabCount}>{count}</span> : null}
    </span>
  );
}
