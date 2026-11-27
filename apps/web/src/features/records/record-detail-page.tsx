"use client";

import {
  EllipsisOutlined,
  LeftOutlined,
  LockOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  skipToken,
  useIsMutating,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { Alert, Button, Dropdown, Modal, Tabs, Tooltip } from "antd";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
import { CommunicationDraftAction } from "./communication-draft";
import { AssistantPanelButton } from "@/features/ai/assistant-panel-button";
import { RecordActivityTimeline } from "./record-activity-timeline";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";
import {
  displayValue,
  formatDateTime,
  RecordOwner,
} from "./record-display-value";
import { RecordForm } from "./record-form";
import {
  canEditRecord,
  canEditRecordFields,
  recordFields,
} from "./record-access";
import { RecordOwnershipActions, RecordPoolStatus } from "./record-pool";
import type { RecordPoolConfig } from "./record-pool-api";
import { RecordRelationsPanel } from "./record-relations-panel";
import { RecordWorkflowPanel } from "./record-workflow-panel";
import { CallButton } from "@/features/telephony/call-button";
import { CallDialog, type CallTarget } from "@/features/telephony/call-dialog";
import { RecordCallsPanel } from "@/features/telephony/record-calls-panel";
import {
  dialable,
  telephonyApi,
  UNAVAILABLE_REASON,
} from "@/features/telephony/telephony-api";
import { useTelephonyRuntime } from "@/features/telephony/use-telephony";

import styles from "./record-detail-page.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

export interface RecordDetailPageProps {
  tenantCode: string;
  timeZone?: string;
  schema: RuntimeObjectSchema;
  record: RecordSummary;
  members?: DynamicFieldMember[];
  currentMemberId?: string;
  canChooseOwner?: boolean;
  canDelete?: boolean;
  initialEditing?: boolean;
  poolConfig?: RecordPoolConfig;
  followUpId?: string;
  initialSection?:"activity"|"followups";
  returnTo?: string;
  /** Where this record sits in the list it was opened from, for ‹ 3/17 › paging. */
  position?: {
    index: number;
    total: number;
    previousHref?: string;
    nextHref?: string;
  };
  api?: RecordApi;
  onClose: () => void;
  onChanged: (record: RecordSummary | null) => void | Promise<void>;
}

/**
 * The record as a page of its own (Attio, HubSpot): a top bar with the way back,
 * paging through the list it came from and the record actions; the title across
 * the page; every field once in a properties column on the left, with who owns
 * it and the workflow below; the activity tabs on the right. The columns follow
 * the width the page actually has (the side assistant can take some of it).
 */
export function RecordDetailPage({
  tenantCode,
  timeZone = "Asia/Shanghai",
  schema,
  record,
  members = [],
  currentMemberId,
  canChooseOwner = false,
  canDelete = false,
  initialEditing = false,
  poolConfig,
  followUpId,initialSection,
  position,
  api = defaultRecordApi,
  onClose,
  onChanged,
}: RecordDetailPageProps) {
  const ownershipPending =
    useIsMutating({
      mutationKey: [
        "record-ownership",
        tenantCode,
        schema.object.code,
        record.id,
      ],
    }) > 0;
  const poolPreview = record.inPublicPool && !canChooseOwner;
  const canOperate = canEditRecord(
    schema,
    record,
    currentMemberId,
    canChooseOwner,
  );
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
  const session = editSession.current;
  const [error, setError] = useState<string>();
  const [refreshWarning, setRefreshWarning] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [modal, modalHolder] = Modal.useModal();
  /** Leaving the page with unsaved edits asks first; otherwise it just goes. */
  const leave = (go: () => void) => {
    if (!(editing && formDirty)) return go();
    void modal.confirm({
      title: "放弃未保存的修改？",
      content: "这条记录的修改还没有保存，离开后会丢失。",
      okText: "放弃修改",
      okButtonProps: { danger: true },
      autoFocusButton: "cancel",
      cancelText: "继续编辑",
      onOk: go,
    });
  };
  const fields = recordFields(schema, record);
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

  // Calling: which of this record's numbers the member may dial, and the
  // calls already made on it.
  const telephony = useTelephonyRuntime(
    tenantCode,
    schema.object.code,
    record.id,
  ).data;
  const calls = useQuery({
    queryKey: ["telephony-calls", tenantCode, schema.object.code, record.id],
    queryFn: () =>
      telephonyApi.calls(tenantCode, {
        objectCode: schema.object.code,
        recordId: record.id,
        page: 1,
        limit: 20,
      }),
    enabled: Boolean(telephony?.enabled),
  });
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  const callableFields = new Set(
    telephony?.enabled ? telephony.fields.map((field) => field.fieldKey) : [],
  );
  const callBlocked = telephony?.available
    ? null
    : (UNAVAILABLE_REASON[telephony?.reason ?? ""] ?? "现在不能外呼");

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

  const ownershipVisible = Boolean(
    poolConfig?.enabled || canChooseOwner || record.inPublicPool,
  );
  const poolLabel = (origin: string) =>
    origin === "LEAD_POOL"
      ? (poolConfig?.labels?.leadPool ?? "初始公共池")
      : (poolConfig?.labels?.customerPool ?? "已联系公共池");
  const poolFacts = record.poolStage
    ? [
        record.poolClaimedAt
          ? ["领取 / 分配", formatDateTime(record.poolClaimedAt, timeZone)]
          : null,
        record.poolLastFollowUpAt
          ? ["最近有效跟进", formatDateTime(record.poolLastFollowUpAt, timeZone)]
          : null,
        record.poolProtectedAt
          ? ["保护开始", formatDateTime(record.poolProtectedAt, timeZone)]
          : null,
        record.poolOrigin ? ["领取来源", poolLabel(record.poolOrigin)] : null,
        record.poolReason ? ["最近流转原因", record.poolReason] : null,
      ].filter((fact): fact is string[] => fact !== null)
    : [];

  const refresh = () =>
    api.detail(tenantCode, schema.object.code, record.id).then(onChanged);
  const listPath = `/workspace/${tenantCode}/objects/${schema.object.code}`;

  const activeMembers = members.filter(
    (member) => member.status !== "DISABLED",
  );
  const tabKey = `crm.record.tab.${tenantCode}.${currentMemberId ?? "anonymous"}`;
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
  useEffect(() => {
    try {
      const stored = followUpId
        ? DEFAULT_TAB
        : initialSection ?? window.localStorage.getItem(tabKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored && TAB_KEYS.has(stored)) setActiveTab(stored);
    } catch {
      // A refused storage keeps the default tab.
    }
  }, [tabKey, followUpId,initialSection]);
  // With nothing open to follow up but a history to read, the page opens on
  // 动态 instead of a near-empty list, unless the person asked for 跟进 by
  // name or click.
  const [openFollowUps, setOpenFollowUps] = useState<number>();
  const [activityCount, setActivityCount] = useState<number>();
  const [tabChosen, setTabChosen] = useState(false);
  const shownTab =
    activeTab === "followups" &&
    openFollowUps === 0 &&
    !!activityCount &&
    !tabChosen &&
    !followUpId &&
    !initialSection
      ? "activity"
      : activeTab;
  const chooseTab = (key: string) => {
    setTabChosen(true);
    setActiveTab(key);
    try {
      window.localStorage.setItem(tabKey, key);
    } catch {
      // Storage refused: the tab still switches for this visit.
    }
  };

  const communicationAction = canOperate && !deleted && (
    <CommunicationDraftAction
      key={record.id}
      buttonType="primary"
      tenantCode={tenantCode}
      objectCode={schema.object.code}
      recordId={record.id}
      recordTitle={record.title}
      fields={recordFields(schema, record)}
      members={members}
      onSaved={refresh}
    />
  );
  const tabs = [
    {
      key: "followups",
      label: <TabLabel label="跟进" count={openFollowUps} />,
      children: (
        <FollowUpPanel
          onOpenCount={setOpenFollowUps}
          onCompleted={async () => {
            await refresh();
          }}
          tenantCode={tenantCode}
          followUpId={followUpId}
          record={{
            id: record.id,
            objectCode: schema.object.code,
            canCreate: canOperate,
          }}
          assignees={canChooseOwner ? activeMembers : undefined}
        />
      ),
    },
    {
      key: "activity",
      label: "动态",
      children: (
        <RecordActivityTimeline
          onCount={setActivityCount}
          action={shownTab === "activity" && communicationAction}
          onCreated={
            poolConfig?.lifecycleEnabled
              ? async () => {
                  await refresh();
                }
              : undefined
          }
          tenantCode={tenantCode}
          objectCode={schema.object.code}
          recordId={record.id}
          canCreate={canOperate}
          canDelete={canChooseOwner}
          api={api}
        />
      ),
    },
    ...(telephony?.enabled || calls.data?.total
      ? [
          {
            key: "calls",
            label: <TabLabel label="通话" count={calls.data?.total} />,
            children: (
              <RecordCallsPanel
                calls={calls.data}
                error={calls.error}
                timeZone={timeZone}
              />
            ),
          },
        ]
      : []),
    {
      key: "relations",
      label: <TabLabel label="关联" count={relations.data?.length} />,
      children: (
        <RecordRelationsPanel
          tenantCode={tenantCode}
          objectCode={schema.object.code}
          recordId={record.id}
          canUpdate={canOperate}
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
          canUpdate={canOperate}
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
          members={activeMembers}
          onRecordChanged={refresh}
        />
      ),
    },
  ];

  const ownershipActions = ownershipVisible && !deleted && (
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
            await api.detail(tenantCode, schema.object.code, record.id),
          );
        }
      }}
    />
  );

  const ownership = (
    <section className={styles.railBlock} aria-label="负责人与流转">
      {/* The actions sit on the heading's line, which is as wide as the
          rail: next to the owner they wrapped as soon as there were two. */}
      <div className={styles.railHead}>
        <h2 className={styles.sectionTitle}>归属</h2>
        {ownershipActions}
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>负责人</dt>
          <dd>
            <RecordOwner
              ownerMemberId={record.ownerMemberId}
              members={members}
              currentMemberId={currentMemberId}
              size="md"
            />
          </dd>
        </div>
        {poolConfig?.enabled || record.inPublicPool ? (
          <div>
            <dt>归属状态</dt>
            <dd>
              <RecordPoolStatus record={record} config={poolConfig} timeZone={timeZone} />
            </dd>
          </div>
        ) : null}
        {poolFacts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {record.poolStage === "FOLLOWING" ? (
        <p className={styles.hint}>
          成功新增有内容的跟进活动会续期，普通编辑和未来待办不会续期
        </p>
      ) : null}
      {record.protectionNeedsReview ? (
        <Alert
          type="warning"
          showIcon
          title="有效保护依据已发生变化，暂保留保护，请管理员复核关联业务记录后处理"
        />
      ) : null}
    </section>
  );

  return (
    <div
      className={styles.page}
      role="article"
      aria-label={`${record.title} #${record.recordNo}`}
    >
      <header className={styles.topbar}>
        <nav className={styles.crumbs} aria-label="位置">
          <Link
            href={listPath}
            className={styles.crumbLink}
            onClick={(event) => {
              event.preventDefault();
              leave(onClose);
            }}
          >
            <LeftOutlined aria-hidden className={styles.crumbBack} />
            <ObjectIcon name={schema.object.icon} />
            <span>{schema.object.name}</span>
          </Link>
          <span className={styles.crumbDivider} aria-hidden>
            /
          </span>
          <span className={styles.crumbCurrent}>#{record.recordNo}</span>
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
                  onClick={(event) => {
                    if (!(editing && formDirty) || !position.previousHref)
                      return;
                    event.preventDefault();
                    const target = position.previousHref;
                    leave(() => window.location.assign(target));
                  }}
                />
              </Tooltip>
              <span className={styles.pagerText}>
                {position.index + 1} / {position.total}
              </span>
              <Tooltip title="下一条">
                <Button
                  type="text"
                  size="small"
                  aria-label="下一条"
                  icon={<RightOutlined aria-hidden />}
                  disabled={!position.nextHref}
                  href={position.nextHref}
                  onClick={(event) => {
                    if (!(editing && formDirty) || !position.nextHref) return;
                    event.preventDefault();
                    const target = position.nextHref;
                    leave(() => window.location.assign(target));
                  }}
                />
              </Tooltip>
            </div>
          ) : null}
          {shownTab !== "activity" && communicationAction}
          {canEdit && !editing && !deleted ? (
            <Button
              disabled={ownershipPending}
              type={canOperate ? "default" : "primary"}
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
                items: [
                  {
                    key: "delete",
                    label: "删除记录",
                    danger: true,
                    onClick: () => setConfirmDelete(true),
                  },
                ],
              }}
            >
              <Button
                aria-label="更多操作"
                icon={<EllipsisOutlined aria-hidden />}
                loading={remove.isPending}
                disabled={deleted}
              />
            </Dropdown>
          ) : null}
          <AssistantPanelButton key={`assistant-${record.id}`} tenantCode={tenantCode} memberId={currentMemberId} objectCode={schema.object.code} objectName={schema.object.name} recordId={record.id} recordTitle={recordFields(schema,record).some(f=>f.fieldKey===schema.object.titleFieldKey)?record.title:'记录 '+record.recordNo}/>
        </div>
      </header>

      <div className={styles.body}>
        <div
          className={styles.layout}
          data-editing={editing && !poolPreview && !deleted ? "" : undefined}
        >
          <div className={styles.head}>
            <h1 className={styles.title}>{record.title}</h1>
            <p className={styles.meta}>
              <span className={styles.no}>#{record.recordNo}</span>
              <span aria-hidden>·</span>
              <span>
                更新于{" "}
                <time dateTime={record.updatedAt}>
                  {formatDateTime(record.updatedAt, timeZone)}
                </time>
              </span>
            </p>
            {refreshWarning || error || poolPreview ? (
              <div className={styles.notices}>
                {refreshWarning ? (
                  <Alert type="warning" showIcon title={refreshWarning} />
                ) : null}
                {error ? <Alert type="error" showIcon title={error} /> : null}
                {poolPreview ? (
                  <Alert
                    type="info"
                    showIcon
                    title="公共池记录仅供预览，领取后可编辑和跟进"
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <section className={styles.props} aria-label="记录信息">
            <h2 className={styles.sectionTitle}>
              {editing && !poolPreview && !deleted ? "编辑记录" : "详细信息"}
            </h2>
            {deleted ? (
              <Button onClick={onClose}>返回列表</Button>
            ) : editing && !poolPreview ? (
              <div
                className={styles.editor}
                aria-label="编辑记录"
                role="region"
              >
                <RecordForm
                  tenantCode={tenantCode}
                  schema={schema}
                  record={editingRecord ?? record}
                  members={members}
                  canChooseOwner={canChooseOwner}
                  api={api}
                  onDirtyChange={setFormDirty}
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
              </div>
            ) : (
              <dl className={styles.fieldList} aria-label="业务字段">
                {/* The title is the heading above; the list holds the rest. */}
                {fields
                  .filter(
                    (field) => field.fieldKey !== schema.object.titleFieldKey,
                  )
                  .map((field) => (
                    <div
                      key={field.id}
                      className={styles.field}
                      data-span={
                        isLongField(field.type, record.values[field.fieldKey])
                          ? "full"
                          : undefined
                      }
                    >
                      <dt>
                        <span className={styles.fieldLabel}>{field.label}</span>
                        {field.access === "READ_ONLY" ||
                        field.access === "CREATE_ONLY" ? (
                          <Tooltip title="只读">
                            <LockOutlined
                              className={styles.fieldLock}
                              aria-label="只读"
                            />
                          </Tooltip>
                        ) : null}
                      </dt>
                      <dd data-type={field.type}>
                        {callableFields.has(field.fieldKey) &&
                        dialable(record.values[field.fieldKey]) &&
                        !deleted &&
                        !poolPreview ? (
                          <span className={styles.callable}>
                            {displayValue(
                              field,
                              record.values[field.fieldKey],
                              members,
                              timeZone,
                            )}
                            <CallButton
                              label={`拨打${field.label}`}
                              disabledReason={callBlocked}
                              onCall={() =>
                                setCallTarget({
                                  objectCode: schema.object.code,
                                  recordId: record.id,
                                  recordTitle: record.title,
                                  values: record.values,
                                  fieldKey: field.fieldKey,
                                })
                              }
                            />
                          </span>
                        ) : (
                          displayValue(
                            field,
                            record.values[field.fieldKey],
                            members,
                            timeZone,
                          )
                        )}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
          </section>

          <aside className={styles.rail} aria-label="归属与流程">
            {ownership}
            {!deleted && !poolPreview && schema.workflowEnabled !== false ? (
              <div className={styles.railBlock} data-slot="workflow">
                <RecordWorkflowPanel
                  tenantCode={tenantCode}
                  objectCode={schema.object.code}
                  recordId={record.id}
                  recordVersion={record.version}
                  onRecordChanged={refresh}
                />
              </div>
            ) : null}
          </aside>

          {!deleted && !poolPreview ? (
            <section className={styles.activity} aria-label="业务活动">
              <Tabs
                className={styles.tabs}
                activeKey={shownTab}
                onChange={chooseTab}
                items={tabs.map((tab) => ({
                  key: tab.key,
                  label: tab.label,
                  children: tab.children,
                  // These fetch their counts when mounted, so tabs can say
                  // how many there are before opening, and the page can pick
                  // the one with something to show.
                  forceRender:
                    tab.key === "followups" ||
                    tab.key === "activity" ||
                    tab.key === "relations" ||
                    tab.key === "attachments",
                }))}
              />
            </section>
          ) : null}
        </div>
      </div>

      {modalHolder}
      <CallDialog
        tenantCode={tenantCode}
        target={callTarget}
        onClose={() => setCallTarget(null)}
        onFollowUp={() => chooseTab("activity")}
      />
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

const DEFAULT_TAB = "followups";
const TAB_KEYS = new Set([
  "followups",
  "activity",
  "relations",
  "attachments",
  "automations",
  "calls",
]);

/** Notes and long text read across the whole width instead of a narrow cell. */
function isLongField(type: string, value: unknown) {
  if (type === "TEXTAREA" || type === "MULTI_SELECT") return true;
  return (
    typeof value === "string" && (value.length > 48 || value.includes("\n"))
  );
}

function TabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <span className={styles.tabLabel}>
      {label}
      {count !== undefined ? (
        <span className={styles.tabCount}>{count}</span>
      ) : null}
    </span>
  );
}
