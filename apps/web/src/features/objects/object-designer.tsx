"use client";

import { EyeOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SettingRow, SettingRows } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { ObjectIcon } from "@/components/navigation/object-icon";
import { StatusTag } from "@/components/workbench/status-tag";
import { toApiError } from "@/lib/api/api-error";

import { FieldEditorPanel } from "./field-editor-panel";
import { fieldSavePayload, type FieldDraftValues } from "./field-editor-form";
import type {
  ConfigurableFieldView,
  ConfigurableObjectView,
} from "./configuration-view";
import { ObjectLifecycleControl } from "./object-lifecycle-control";
import { FieldList } from "./field-list";
import { ObjectIconPicker } from "./object-icon-picker";
import { objectApi as defaultObjectApi, type ObjectApi } from "./object-api";
import { ObjectPreview, type PreviewRole } from "./object-preview";
import {
  DATA_SCOPE_LABELS,
  defaultSelectOptionColor,
  FIELD_KEY_PATTERN,
  FIELD_TYPE_LABELS,
  isSearchableFieldType,
  PUBLISHED_FIELD_TYPES,
  TITLE_FIELD_TYPES,
  objectStatusLabel,
  objectStableId,
  objectStableIdHelp,
  type ObjectDraft,
  type PublicationAnalysis,
  type PublishedDataScope,
  type PublishedFieldType,
  type RecordSortDirection,
  type RecordSortField,
} from "./object-types";
import { EmployeePermissionComparison } from "./employee-permission-comparison";
import { PublicationPanel } from "./publication-panel";
import { AutomationDesigner } from "@/features/automations/automation-designer";
import { WorkflowDesigner } from "./workflow-designer";

import styles from "./objects.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

type Section =
  "basics" | "fields" | "view" | "permissions" | "workflow" | "automations" | "publications";

const FIELD_SAVED = "字段已保存";

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "basics", label: "基本设置" },
  { key: "fields", label: "字段与表单" },
  { key: "view", label: "列表展示与搜索" },
  { key: "permissions", label: "员工权限" },
  { key: "workflow", label: "流程" },
  { key: "automations", label: "跨表自动化" },
  { key: "publications", label: "发布记录" },
];

export interface ObjectDesignerProps {
  tenantCode: string;
  initialDraft: ObjectDraft;
  initialSection?: "automations";
  api?: ObjectApi;
}

/**
 * The object designer. Every mutation carries the draft version the
 * administrator was looking at, and a version conflict leaves the local draft
 * untouched while offering an explicit reload — a stale overwrite is never
 * silently applied.
 */
export function ObjectDesigner({
  tenantCode,
  initialDraft,
  initialSection,
  api = defaultObjectApi,
}: ObjectDesignerProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [section, setSection] = useState<Section>(initialSection ?? "fields");
  const [previewRole, setPreviewRole] = useState<PreviewRole>("TENANT_ADMIN");
  const [previewOpen, setPreviewOpen] = useState(false);
  // Chosen once, up front: if the first row were only a fallback, a reorder
  // would move the editor onto whichever field becomes first.
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    initialDraft.fields[0]?.id ?? null,
  );
  // Bumped by each successful field save so the editor restarts from what was
  // saved; unrelated draft changes (a reorder) leave the member's edits alone.
  const [editorRevision, setEditorRevision] = useState(0);
  const [fieldDirty, setFieldDirty] = useState(false);
  const [fieldError, setFieldError] = useState<string>();
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [fieldCreatorOpen, setFieldCreatorOpen] = useState(false);
  const [statusField, setStatusField] = useState<ConfigurableFieldView | null>(
    null,
  );
  const [analysis, setAnalysis] = useState<PublicationAnalysis>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [conflicted, setConflicted] = useState(false);
  const [permissionsDirty, setPermissionsDirty] = useState(false);

  const objectId = draft.object.id;
  const archived = draft.object.status === "ARCHIVED";
  const configurableDraft = draft as unknown as ConfigurableObjectView;
  const statusBlockReason =
    statusField?.status === "ACTIVE"
      ? statusField.fieldKey === draft.object.titleFieldKey
        ? "请先在基本设置中更换记录名称字段，再停用此字段"
        : statusField.isSystem
          ? "系统字段不能停用"
          : undefined
      : undefined;
  // Derived from the draft, so the editor always shows the latest saved field.
  const selectedField =
    configurableDraft.fields.find((field) => field.id === selectedFieldId) ??
    configurableDraft.fields[0] ??
    null;

  /** Runs `action`, first asking before it throws away unsaved field edits. */
  function guardUnsavedField(action: () => void) {
    if (!fieldDirty) action();
    else setDiscardAction(() => action);
  }

  function accept(next: ObjectDraft, saved?: string) {
    setDraft(next);
    setError(undefined);
    setFieldError(undefined);
    setNotice(saved);
    setConflicted(false);
    void queryClient.invalidateQueries({
      queryKey: ["workspace", tenantCode, "object-definitions"],
      exact: false,
    });
  }

  function reject(caught: unknown): string {
    const apiError = toApiError(caught);
    const message = `${apiError.message}（请求编号：${apiError.requestId}）`;
    setError(message);
    setNotice(undefined);
    setConflicted(
      apiError.code === "CONFIG_VERSION_CONFLICT" || apiError.status === 409,
    );
    return message;
  }

  const reorder = useMutation({
    mutationFn: (fieldIds: string[]) =>
      api.reorderFields(tenantCode, objectId, {
        expectedVersion: draft.object.version,
        fieldIds,
      }),
    onSuccess: (next) => accept(next, "字段顺序已保存"),
    onError: reject,
  });

  const createField = useMutation({
    mutationFn: (input: {
      fieldKey: string;
      label: string;
      type: PublishedFieldType;
      required: boolean;
    }) =>
      api.createField(tenantCode, objectId, {
        expectedVersion: draft.object.version,
        fieldKey: input.fieldKey,
        label: input.label,
        type: input.type,
        required: input.required,
        defaultValue: null,
        validation: {},
        // A select starts with one active option, so it is fillable as soon as
        // it is published; the editor opens next to rename it and add more.
        config:
          input.type === "SINGLE_SELECT" || input.type === "MULTI_SELECT"
            ? { options: [{ key: "option_1", label: "选项 1", status: "ACTIVE", color: defaultSelectOptionColor(0) }] }
            : {},
        isSystem: false,
      }),
    onSuccess: (next, input) => {
      accept(next, "字段已创建");
      setFieldCreatorOpen(false);
      const created = next.fields.find(
        (field) => field.fieldKey === input.fieldKey,
      );
      if (created) setSelectedFieldId(created.id);
    },
    onError: reject,
  });

  const saveField = useMutation({
    mutationFn: ({
      field,
      values,
    }: {
      field: ConfigurableFieldView;
      values: FieldDraftValues;
    }) => {
      const updateField = async () => {
        const next = await api.updateField(tenantCode, objectId, field.id, {
          expectedVersion: draft.object.version,
          fieldKey: values.fieldKey,
          label: values.label,
          type: values.type,
          required: values.required,
          // Only the rules of the field's current type: options or length
          // limits left over from an earlier type would block publication.
          ...fieldSavePayload(values, field),
        });

        if (
          values.employeeAccess === field.employeeAccess &&
          values.fieldKey === field.fieldKey
        ) {
          return next;
        }
        const employeeAccess = next.employeeAccess ?? {
          canCreate: false,
          canRead: false,
          canUpdate: false,
          readScope: "NONE" as const,
          updateScope: "NONE" as const,
        };
        return api.updatePermissions(tenantCode, objectId, {
          expectedVersion: next.object.version,
          canCreate: employeeAccess.canCreate,
          canRead: employeeAccess.canRead,
          canUpdate: employeeAccess.canUpdate,
          canDelete: false,
          readScope: employeeAccess.readScope,
          updateScope: employeeAccess.updateScope,
          fields: Object.fromEntries(
            next.fields.map((nextField) => [
              nextField.fieldKey,
              nextField.id === field.id
                ? values.employeeAccess
                : nextField.employeeAccess,
            ]),
          ),
        });
      };
      return updateField();
    },
    onSuccess: (next) => {
      accept(next, FIELD_SAVED);
      setEditorRevision((revision) => revision + 1);
    },
    onError: (caught) => setFieldError(reject(caught)),
  });

  const changeFieldStatus = useMutation({
    mutationFn: (field: ConfigurableFieldView) =>
      api.updateField(tenantCode, objectId, field.id, {
        expectedVersion: draft.object.version,
        status: field.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      }),
    onSuccess: (next, field) => {
      accept(
        next,
        `字段已${field.status === "ACTIVE" ? "停用" : "恢复"}并保存到草稿，发布后生效`,
      );
      setStatusField(null);
      setAnalysis(undefined);
    },
    onError: reject,
  });

  const saveBasics = useMutation({
    mutationFn: (input: {
      name: string;
      titleFieldKey: string;
      description: string;
      icon: string | null;
    }) =>
      api.updateDraft(tenantCode, objectId, {
        expectedVersion: draft.object.version,
        name: input.name,
        titleFieldKey: input.titleFieldKey,
        description: input.description === "" ? null : input.description,
        icon: input.icon,
      }),
    onSuccess: (next) => accept(next, "基本设置已保存"),
    onError: reject,
  });

  const saveView = useMutation({
    mutationFn: (input: {
      name: string;
      columnFieldKeys: string[];
      searchFieldKeys: string[];
      sort: { field: RecordSortField; direction: RecordSortDirection };
    }) =>
      api.updateDefaultView(tenantCode, objectId, {
        expectedVersion: draft.object.version,
        ...input,
      }),
    onSuccess: (next) => accept(next, "列表设置已保存"),
    onError: reject,
  });

  const savePermissions = useMutation({
    mutationFn: (input: {
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      readScope: PublishedDataScope;
      updateScope: PublishedDataScope;
    }) =>
      api.updatePermissions(tenantCode, objectId, {
        expectedVersion: draft.object.version,
        canDelete: false,
        fields: Object.fromEntries(
          draft.fields.map((field) => [field.fieldKey, field.employeeAccess]),
        ),
        ...input,
      }),
    onSuccess: (next) =>
      accept(next, "员工权限已保存到草稿，尚未生效。请检查并发布变更。"),
    onError: reject,
  });

  const analyze = useMutation({
    mutationFn: () =>
      api.analyzePublication(tenantCode, objectId, draft.object.version),
    onMutate: () => {
      setError(undefined);
      setAnalysis(undefined);
      setPanelOpen(true);
    },
    onSuccess: setAnalysis,
    onError: reject,
  });

  const publish = useMutation({
    mutationFn: () => api.publish(tenantCode, objectId, draft.object.version),
    onSuccess: async () => {
      setPanelOpen(false);
      setAnalysis(undefined);
      router.refresh();
      accept(await api.draft(tenantCode, objectId), "已发布");
    },
    onError: reject,
  });

  const reload = useMutation({
    mutationFn: () => api.draft(tenantCode, objectId),
    onSuccess: (next) => {
      accept(next);
      setPanelOpen(false);
      setAnalysis(undefined);
    },
    onError: reject,
  });

  // A draft that never published has no history to keep, so it is deleted
  // outright; the API refuses this once a publication exists.
  const removeDraft = useMutation({
    mutationFn: () =>
      api.removeDraft(tenantCode, objectId, draft.object.version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workspace", tenantCode, "object-definitions"],
        exact: false,
      });
      router.push(`/workspace/${tenantCode}/settings/objects`);
      router.refresh();
    },
    onError: reject,
  });

  return (
    <>
      <div className={styles.desktopOnly}>
        <p>
          {draft.object.name}：业务表配置需要较宽的编辑区域，请在桌面端完成。
        </p>
        <Link href={`/workspace/${tenantCode}/settings/objects`}>
          返回业务表列表
        </Link>
      </div>

      <div className={styles.designer}>
        <div>
          <PageHeader
            breadcrumb={
              <Link href={`/workspace/${tenantCode}/settings/objects`}>业务表</Link>
            }
            title={
              <span className={styles.designerTitle}>
                <span className={styles.designerIcon}>
                  <ObjectIcon name={draft.object.icon} />
                </span>
                {draft.object.name}
              </span>
            }
            status={
              <StatusTag
                tone={
                  archived
                    ? "neutral"
                    : draft.object.publicationNumber === null
                      ? "info"
                      : draft.object.hasUnpublishedChanges
                        ? "warning"
                        : "success"
                }
              >
                {!archived && draft.object.publicationNumber !== null && draft.object.hasUnpublishedChanges
                  ? "有待发布改动"
                  : objectStatusLabel(draft.object)}
              </StatusTag>
            }
            description={
              <span className={styles.designerMeta}>
                <span className={styles.stableKey}>
                  {objectStableId(tenantCode, draft.object.code)}
                </span>
                <span>{draft.activeRecordCount} 条记录</span>
                <span>
                  {draft.object.publicationNumber === null
                    ? "员工端尚未发布"
                    : `${archived ? "停用前" : "员工使用"} v${draft.object.publicationNumber}`}
                </span>
                <span>草稿修订 {draft.object.version}</span>
              </span>
            }
            extra={
              <>
                {draft.object.publicationNumber === null ? (
                  <Popconfirm
                    title="删除这个业务表草稿？"
                    description="它从未发布，删除后不会保留配置，也不能恢复。"
                    okText="确认删除"
                    cancelText="取消"
                    onConfirm={() => removeDraft.mutate()}
                  >
                    <Button
                      danger
                      type="text"
                      loading={removeDraft.isPending}
                      disabled={archived}
                    >
                      删除草稿
                    </Button>
                  </Popconfirm>
                ) : null}
                <Button
                  aria-label="打开员工端预览"
                  icon={<EyeOutlined aria-hidden />}
                  onClick={() => setPreviewOpen(true)}
                >
                  员工端预览
                </Button>
                <Button
                  type="primary"
                  disabled={
                    archived ||
                    permissionsDirty ||
                    fieldDirty ||
                    savePermissions.isPending
                  }
                  loading={analyze.isPending}
                  onClick={() => analyze.mutate()}
                >
                  发布变更
                </Button>
              </>
            }
          />

          {archived ? (
            <Alert
              type="info"
              showIcon
              title="业务表已停用，配置只读，历史数据保留"
            />
          ) : null}
          {/* A saved field is confirmed beside the editor's own buttons; a second
              banner above would also push the whole editor down. */}
          {notice && notice !== FIELD_SAVED ? (
            <Alert
              type="success"
              showIcon
              closable
              title={notice}
              onClose={() => setNotice(undefined)}
            />
          ) : null}

          {error ? (
            <Alert
              type="error"
              showIcon
              title={error}
              action={
                conflicted ? (
                  <Button
                    size="small"
                    loading={reload.isPending}
                    onClick={() => reload.mutate()}
                  >
                    重新载入配置
                  </Button>
                ) : undefined
              }
            />
          ) : null}
        </div>

        <nav className={styles.designerNav} aria-label="业务表配置步骤">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.designerNavItem} ${
                section === item.key ? styles.designerNavItemActive : ""
              }`}
              aria-current={section === item.key ? "page" : undefined}
              onClick={() => {
                if (item.key !== section)
                  guardUnsavedField(() => setSection(item.key));
              }}
            >
              {item.label}
              {item.key === "fields" ? (
                <span className={styles.designerNavCount}>{draft.fields.length}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className={styles.designerWorkspace}>
          {section === "basics" ? (
            <>
              <BasicsSection
                tenantCode={tenantCode}
                draft={draft}
                saving={saveBasics.isPending}
                onSave={(input) => {
                  if (!archived) saveBasics.mutate(input);
                }}
              />
              <section className={styles.dangerZone} aria-label="停用与恢复">
                <div>
                  <h2>停用与恢复</h2>
                  <p>
                  {archived
                    ? `已停用 · 上次发布版本 v${draft.object.publicationNumber} · ${draft.object.archivedAt ? new Date(draft.object.archivedAt).toLocaleString("zh-CN") : "缺少历史停用时间"}`
                    : draft.object.publicationNumber === null
                      ? "尚未发布的业务表可使用删除草稿"
                      : "停用立即生效，保留配置和历史数据"}
                  </p>
                </div>
                <ObjectLifecycleControl
                  tenantCode={tenantCode}
                  draft={draft}
                  api={api}
                  onChanged={(next) => {
                    accept(next);
                    setFieldDirty(false);
                    setEditorRevision((revision) => revision + 1);
                    setStatusField(null);
                    setAnalysis(undefined);
                    setPanelOpen(false);
                  }}
                />
              </section>
            </>
          ) : null}

          {section === "fields" ? (
            <section className={styles.fieldsLayout}>
              <div className={styles.fieldListColumn}>
                <div className={styles.fieldListHeading}>
                  <Typography.Text type="secondary">
                    拖动调整顺序，选中后在右侧编辑。
                  </Typography.Text>
                  <Button
                    icon={<PlusOutlined aria-hidden />}
                    disabled={archived}
                    onClick={() =>
                      guardUnsavedField(() => setFieldCreatorOpen(true))
                    }
                  >
                    新增字段
                  </Button>
                </div>
                <FieldList
                  fields={configurableDraft.fields}
                  titleFieldKey={draft.object.titleFieldKey}
                  selectedId={selectedField?.id ?? null}
                  reordering={archived || reorder.isPending}
                  onSelect={(field) => {
                    if (field.id !== selectedField?.id)
                      guardUnsavedField(() => setSelectedFieldId(field.id));
                  }}
                  onReorder={(fieldIds) => {
                    if (!archived) reorder.mutate(fieldIds);
                  }}
                />
              </div>
              <div className={styles.fieldEditorColumn}>
                {selectedField ? (
                  <FieldEditorPanel
                    key={`${selectedField.id}:${editorRevision}`}
                    field={selectedField}
                    titleFieldKey={draft.object.titleFieldKey}
                    saving={saveField.isPending}
                    readOnly={archived}
                    onToggleStatus={
                      archived
                        ? undefined
                        : () =>
                            guardUnsavedField(() => {
                              setError(undefined);
                              setStatusField(selectedField);
                            })
                    }
                    saveEffect="保存字段直接写入对象草稿；字段访问变更随后单独保存，发布后员工端生效。"
                    savedNote={notice === FIELD_SAVED ? notice : undefined}
                    error={fieldError}
                    onDirtyChange={setFieldDirty}
                    onSubmit={(values) => {
                      if (!archived)
                        saveField.mutate({ field: selectedField, values });
                    }}
                  />
                ) : (
                  <p className={styles.fieldListEmpty}>
                    添加字段后，在这里设置它的类型、校验和员工权限。
                  </p>
                )}
              </div>
            </section>
          ) : null}

          {section === "view" ? (
            <DefaultViewSection
              draft={draft}
              saving={saveView.isPending}
              onSave={(input) => {
                if (!archived) saveView.mutate(input);
              }}
            />
          ) : null}

          {section === "permissions" ? (
            <PermissionsSection
              key={draft.object.version}
              draft={draft}
              tenantCode={tenantCode}
              saving={savePermissions.isPending}
              publishing={analyze.isPending || publish.isPending}
              onDirtyChange={setPermissionsDirty}
              onPublish={() => {
                if (!archived) analyze.mutate();
              }}
              onSave={(input) => {
                if (!archived) savePermissions.mutate(input);
              }}
            />
          ) : null}

          {section === "workflow" ? (
            <WorkflowDesigner
              tenantCode={tenantCode}
              draft={draft}
              onObjectVersion={setDraft}
              objectApi={api}
            />
          ) : null}

          {section === "automations" ? (
            <AutomationDesigner tenantCode={tenantCode} draft={draft} onObjectVersion={setDraft} objects={api} />
          ) : null}

          {section === "publications" ? (
            <PublicationHistorySection draft={draft} />
          ) : null}
        </div>

      </div>

      <Drawer
        title="员工端预览"
        open={previewOpen}
        size={OVERLAY_SIZE.narrow}
        destroyOnHidden
        onClose={() => setPreviewOpen(false)}
      >
        <ObjectPreview
          draft={configurableDraft}
          role={previewRole}
          onRoleChange={setPreviewRole}
        />
      </Drawer>

      <Modal
        title={`${statusField?.status === "ACTIVE" ? "停用" : "恢复"}字段「${statusField?.label ?? ""}」`}
        open={statusField !== null}
        okText={statusField?.status === "ACTIVE" ? "确认停用" : "确认恢复"}
        cancelText="取消"
        confirmLoading={changeFieldStatus.isPending}
        okButtonProps={{
          disabled: !!statusBlockReason || archived || conflicted,
          danger: statusField?.status === "ACTIVE" && !statusBlockReason,
        }}
        cancelButtonProps={{ disabled: changeFieldStatus.isPending }}
        closable={!changeFieldStatus.isPending}
        mask={{ closable: !changeFieldStatus.isPending }}
        keyboard={!changeFieldStatus.isPending}
        onCancel={() => setStatusField(null)}
        onOk={() => {
          if (statusField && !statusBlockReason && !archived && !conflicted)
            changeFieldStatus.mutate(statusField);
        }}
      >
        <div className={styles.fieldStatusSummary}>
          {statusBlockReason ? (
            <Alert type="warning" showIcon title={statusBlockReason} />
          ) : null}
          <p>
            {statusField?.status === "ACTIVE"
              ? "发布后，管理员和员工的表单、详情及列表不再使用此字段。历史数据保留，不会删除。"
              : "发布后，字段重新用于表单和详情，原有历史数据和员工权限保留。"}
          </p>
          <p>
            {statusField?.status === "ACTIVE"
              ? "默认列表列和关键词搜索会同步移除此字段。若流程仍引用它，发布检查会提示需要修改的配置。"
              : "如需在列表展示或用于关键词搜索，请到“列表展示与搜索”重新勾选。"}
          </p>
          <Alert
            type="info"
            showIcon
            title="先保存到草稿，发布后才生效"
            description="字段停用对所有角色生效；只限制员工查看时，请使用员工访问权限。"
          />
          {error ? <Alert type="error" showIcon title={error} /> : null}
        </div>
      </Modal>

      <Modal
        open={discardAction !== null}
        title="放弃未保存的修改？"
        okText="放弃修改"
        cancelText="继续编辑"
        okButtonProps={{ danger: true }}
        onCancel={() => setDiscardAction(null)}
        onOk={() => {
          const proceed = discardAction;
          setDiscardAction(null);
          setFieldDirty(false);
          proceed?.();
        }}
      >
        <p>当前字段的修改还没有保存，离开后会丢失。</p>
      </Modal>

      {fieldCreatorOpen ? (
        <FieldCreatorModal
          firstField={draft.fields.length === 0}
          saving={createField.isPending}
          onCancel={() => setFieldCreatorOpen(false)}
          onCreate={(input) => {
            if (!archived) createField.mutate(input);
          }}
        />
      ) : null}

      <PublicationPanel
        open={panelOpen}
        analysis={analysis}
        loading={analyze.isPending}
        publishing={publish.isPending}
        error={error}
        onConfirm={() => {
          if (!archived) publish.mutate();
        }}
        onClose={() => setPanelOpen(false)}
      />
    </>
  );
}

function BasicsSection({
  tenantCode,
  draft,
  saving,
  onSave,
}: {
  tenantCode: string;
  draft: ObjectDraft;
  saving: boolean;
  onSave: (input: {
    name: string;
    titleFieldKey: string;
    description: string;
    icon: string | null;
  }) => void;
}) {
  const [name, setName] = useState(draft.object.name);
  const [icon, setIcon] = useState<string | null>(draft.object.icon);
  const [titleFieldKey, setTitleFieldKey] = useState(
    draft.object.titleFieldKey,
  );
  const [description, setDescription] = useState(
    draft.object.description ?? "",
  );
  const titleCandidates = draft.fields.filter(
    (field) =>
      field.status === "ACTIVE" &&
      field.required &&
      TITLE_FIELD_TYPES.includes(
        field.type as (typeof TITLE_FIELD_TYPES)[number],
      ),
  );

  const disabled = draft.object.status === "ARCHIVED";
  return (
    <section className={styles.panel} aria-label="基本设置">
      <p className={styles.sectionLead}>{objectStatusDescription(draft)}</p>
      <SettingRows
        footer={
          <>
            <Typography.Text type="secondary">仅保存本节到对象草稿；发布后员工端生效。</Typography.Text>
            <Button
              type="primary"
              loading={saving}
              disabled={disabled}
              onClick={() => onSave({ name, titleFieldKey, description, icon })}
            >
              保存基本设置
            </Button>
          </>
        }
      >
        <SettingRow label="业务表名称" htmlFor="object-name">
          <Input
            id="object-name"
            value={name}
            disabled={disabled}
            className={styles.settingInput}
            onChange={(event) => setName(event.target.value)}
          />
        </SettingRow>
        <SettingRow label="业务表代码" htmlFor="object-code" help={objectStableIdHelp(tenantCode)}>
          <Input id="object-code" value={draft.object.code} disabled className={styles.settingInput} />
        </SettingRow>
        <SettingRow
          label="记录名称字段"
          htmlFor="object-title-field"
          help="列表链接、搜索结果和引用里代表一条记录的名称；须为必填的文本、电话、邮箱或单选字段。"
        >
          <Select
            id="object-title-field"
            value={titleFieldKey}
            disabled={disabled}
            className={styles.settingInput}
            onChange={setTitleFieldKey}
            options={titleCandidates.map((field) => ({
              value: field.fieldKey,
              label: `${field.label}（${field.fieldKey}）`,
            }))}
          />
        </SettingRow>
        <SettingRow label="图标" help="显示在侧栏的业务表名称前，发布后员工端更新。">
          <ObjectIconPicker value={icon} onChange={setIcon} disabled={saving || disabled} />
        </SettingRow>
        <SettingRow label="说明" htmlFor="object-description" help="显示在员工端的业务表标题下。">
          <Input.TextArea
            id="object-description"
            rows={3}
            value={description}
            disabled={disabled}
            onChange={(event) => setDescription(event.target.value)}
          />
        </SettingRow>
      </SettingRows>
    </section>
  );
}

function objectStatusDescription(draft: ObjectDraft): string {
  if (draft.object.status === "ARCHIVED") {
    return "已停用：配置只读，历史记录仍然保留，恢复后沿用原发布版本。";
  }
  if (draft.object.publicationNumber === null) {
    return "草稿：只有公司管理员能看到，员工端尚未出现这张业务表。";
  }
  if (draft.object.hasUnpublishedChanges) {
    return "有未发布变更：员工仍在使用上一个已发布版本，本次修改尚未生效。";
  }
  return "已发布：员工正在使用当前版本。";
}

function FieldCreatorModal({
  firstField,
  saving,
  onCancel,
  onCreate,
}: {
  firstField: boolean;
  saving: boolean;
  onCancel: () => void;
  onCreate: (input: {
    fieldKey: string;
    label: string;
    type: PublishedFieldType;
    required: boolean;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [fieldKey, setFieldKey] = useState(firstField ? "name" : "");
  const [type, setType] = useState<PublishedFieldType>("TEXT");
  const [required, setRequired] = useState(firstField);
  const valid =
    label.trim().length > 0 && FIELD_KEY_PATTERN.test(fieldKey.trim());

  return (
    <Modal
      open
      title="新增字段"
      width={OVERLAY_SIZE.form}
      okText="创建并继续配置"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !valid }}
      onCancel={onCancel}
      onOk={() =>
        onCreate({
          label: label.trim(),
          fieldKey: fieldKey.trim(),
          type,
          required,
        })
      }
    >
      <Typography.Paragraph type="secondary">
        先确定字段的名称、键和类型；创建后会自动打开完整配置，可继续设置选项、校验和员工访问权限。
      </Typography.Paragraph>
      {firstField ? (
        <Alert
          className={styles.fieldCreatorAlert}
          type="info"
          showIcon
          title="首个字段将作为记录名称字段，建议保留 name 并设为必填文本。"
        />
      ) : null}
      <Form component={false} layout="vertical">
        <Form.Item label="字段名称" htmlFor="create-field-label" required>
          <Input
            id="create-field-label"
            autoFocus
            placeholder="例如：客户名称"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Form.Item>
        <Form.Item
          label="字段键"
          htmlFor="create-field-key"
          required
          extra="使用小写字母、数字和下划线，例如 customer_name。"
          validateStatus={
            fieldKey !== "" && !FIELD_KEY_PATTERN.test(fieldKey)
              ? "error"
              : undefined
          }
        >
          <Input
            id="create-field-key"
            value={fieldKey}
            onChange={(event) =>
              setFieldKey(
                event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
              )
            }
          />
        </Form.Item>
        <Form.Item label="字段类型" htmlFor="create-field-type">
          <Select
            id="create-field-type"
            value={type}
            onChange={setType}
            options={PUBLISHED_FIELD_TYPES.map((fieldType) => ({
              value: fieldType,
              label: FIELD_TYPE_LABELS[fieldType],
            }))}
          />
        </Form.Item>
        <Form.Item label="是否必填" htmlFor="create-field-required">
          <div className={styles.requiredControl}>
            <Switch
              id="create-field-required"
              checked={required}
              onChange={setRequired}
            />
            <span>{required ? "必须填写" : "可以留空"}</span>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function DefaultViewSection({
  draft,
  saving,
  onSave,
}: {
  draft: ObjectDraft;
  saving: boolean;
  onSave: (input: {
    name: string;
    columnFieldKeys: string[];
    searchFieldKeys: string[];
    sort: { field: RecordSortField; direction: RecordSortDirection };
  }) => void;
}) {
  const activeFields = draft.fields.filter(
    (field) => field.status === "ACTIVE",
  );
  const searchableFields = activeFields.filter((field) =>
    isSearchableFieldType(field.type),
  );
  const [name, setName] = useState(draft.defaultView?.name ?? "默认列表");
  const [columnFieldKeys, setColumnFieldKeys] = useState<string[]>(
    draft.defaultView?.columnFieldKeys ??
      activeFields.map((field) => field.fieldKey),
  );
  const [searchFieldKeys, setSearchFieldKeys] = useState<string[]>(
    draft.defaultView?.searchFieldKeys ??
      (draft.defaultView?.columnFieldKeys ?? []).filter((fieldKey) =>
        searchableFields.some((field) => field.fieldKey === fieldKey),
      ),
  );
  const [sortField, setSortField] = useState<RecordSortField>(
    draft.defaultView?.sort.field ?? "updatedAt",
  );
  const [sortDirection, setSortDirection] = useState<RecordSortDirection>(
    draft.defaultView?.sort.direction ?? "desc",
  );

  function toggleColumn(fieldKey: string, checked: boolean) {
    setColumnFieldKeys((current) =>
      checked
        ? [...current, fieldKey]
        : current.filter((candidate) => candidate !== fieldKey),
    );
  }

  function moveColumn(fieldKey: string, direction: -1 | 1) {
    setColumnFieldKeys((current) => {
      const next = [...current];
      const from = next.indexOf(fieldKey);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= next.length) return current;
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  // The list has to follow the saved column order. Rendering it in field
  // definition order instead showed the columns in a sequence the view did not
  // use, so the move buttons looked like they did nothing and the admin could
  // not read back the order they had configured.
  const orderedFields = [
    ...columnFieldKeys.flatMap((fieldKey) => {
      const field = activeFields.find((item) => item.fieldKey === fieldKey);
      return field ? [field] : [];
    }),
    ...activeFields.filter(
      (field) => !columnFieldKeys.includes(field.fieldKey),
    ),
  ];

  return (
    <section className={`${styles.panel} ${styles.formColumn}`}>
      <div className={styles.sectionHeading}>
        <h2>列表展示与搜索</h2>
      </div>
      <p className={styles.sectionLead}>
        打开表格时默认展示的列、顺序、搜索范围和排序。只影响列表，不限制详情和表单；每个人还可以调整自己的列。
      </p>
      <Form
        disabled={draft.object.status === "ARCHIVED"}
        component={false}
        layout="vertical"
      >
        <Form.Item label="视图名称" htmlFor="default-view-name">
          <Input
            id="default-view-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="默认在列表展示的列与顺序">
          <div className={styles.columnChooser}>
            {orderedFields.map((field) => {
              const selectedIndex = columnFieldKeys.indexOf(field.fieldKey);
              const selected = selectedIndex >= 0;
              return (
                <div key={field.id} className={styles.columnChooserRow}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={draft.object.status === "ARCHIVED"}
                      checked={selected}
                      onChange={(event) =>
                        toggleColumn(field.fieldKey, event.target.checked)
                      }
                    />
                    <span>{field.label}</span>
                    <code>{field.fieldKey}</code>
                  </label>
                  {selected ? (
                    <Space size={4}>
                      <Button
                        size="small"
                        disabled={
                          draft.object.status === "ARCHIVED" ||
                          selectedIndex === 0
                        }
                        onClick={() => moveColumn(field.fieldKey, -1)}
                      >
                        上移
                      </Button>
                      <Button
                        size="small"
                        disabled={
                          draft.object.status === "ARCHIVED" ||
                          selectedIndex === columnFieldKeys.length - 1
                        }
                        onClick={() => moveColumn(field.fieldKey, 1)}
                      >
                        下移
                      </Button>
                    </Space>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Form.Item>
        <Form.Item
          label="关键词搜索字段"
          extra="始终包含记录名称。未勾选任何字段时只搜标题；隐藏字段即使勾选也不会进入员工搜索。"
        >
          {searchableFields.length === 0 ? (
            <Typography.Text type="secondary">
              当前没有可搜索的文本、长文本、电话或邮箱字段。
            </Typography.Text>
          ) : (
            <div className={styles.columnChooser}>
              {searchableFields.map((field) => {
                const selected = searchFieldKeys.includes(field.fieldKey);
                const isTitle = field.fieldKey === draft.object.titleFieldKey;
                return (
                  <div key={field.id} className={styles.columnChooserRow}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={
                          isTitle
                            ? `${field.label}（记录名称，始终可搜索）`
                            : `将${field.label}纳入关键词搜索`
                        }
                        checked={selected || isTitle}
                        disabled={draft.object.status === "ARCHIVED" || isTitle}
                        onChange={(event) =>
                          setSearchFieldKeys((current) =>
                            event.target.checked
                              ? [...current, field.fieldKey]
                              : current.filter(
                                  (candidate) => candidate !== field.fieldKey,
                                ),
                          )
                        }
                      />
                      <span>{field.label}</span>
                      <code>{field.fieldKey}</code>
                    </label>
                    {isTitle ? (
                      <Typography.Text type="secondary">
                        记录名称
                      </Typography.Text>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Form.Item>
        <div className={styles.formGrid}>
          <Form.Item label="默认排序字段" htmlFor="default-sort-field">
            <Select
              id="default-sort-field"
              value={sortField}
              onChange={setSortField}
              options={[
                { value: "updatedAt", label: "最近更新时间" },
                { value: "createdAt", label: "创建时间" },
                { value: "recordNo", label: "记录编号" },
              ]}
            />
          </Form.Item>
          <Form.Item label="排序方向" htmlFor="default-sort-direction">
            <Select
              id="default-sort-direction"
              value={sortDirection}
              onChange={setSortDirection}
              options={[
                { value: "desc", label: "降序（新的在前）" },
                { value: "asc", label: "升序（旧的在前）" },
              ]}
            />
          </Form.Item>
        </div>
      </Form>
      <div className={styles.sectionActions}>
        <Button
          type="primary"
          loading={saving}
          disabled={
            draft.object.status === "ARCHIVED" ||
            name.trim() === "" ||
            columnFieldKeys.length === 0
          }
          onClick={() =>
            onSave({
              name: name.trim(),
              columnFieldKeys,
              searchFieldKeys: searchFieldKeys.filter(
                (fieldKey) => fieldKey !== draft.object.titleFieldKey,
              ),
              sort: { field: sortField, direction: sortDirection },
            })
          }
        >
          保存列表设置
        </Button>
        <Typography.Text type="secondary">
          仅保存本节到对象草稿；发布后员工端生效。
        </Typography.Text>
      </div>
    </section>
  );
}

function PermissionsSection({
  draft,
  tenantCode,
  saving,
  publishing,
  onDirtyChange,
  onPublish,
  onSave,
}: {
  draft: ObjectDraft;
  tenantCode: string;
  saving: boolean;
  publishing: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onPublish: () => void;
  onSave: (input: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    readScope: PublishedDataScope;
    updateScope: PublishedDataScope;
  }) => void;
}) {
  const current = draft.employeeAccess;
  const [canCreate, setCanCreate] = useState(current?.canCreate ?? false);
  const [canRead, setCanRead] = useState(current?.canRead ?? false);
  const [canUpdate, setCanUpdate] = useState(current?.canUpdate ?? false);
  const [readScope, setReadScope] = useState<PublishedDataScope>(
    current?.readScope ?? "NONE",
  );
  const [updateScope, setUpdateScope] = useState<PublishedDataScope>(
    current?.updateScope ?? "NONE",
  );

  const dirty =
    canCreate !== (current?.canCreate ?? false) ||
    canRead !== (current?.canRead ?? false) ||
    canUpdate !== (current?.canUpdate ?? false) ||
    readScope !== (current?.readScope ?? "NONE") ||
    updateScope !== (current?.updateScope ?? "NONE");
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <h2>员工权限</h2>
        <Typography.Text type="secondary">
          员工默认权限需要发布后生效
        </Typography.Text>
      </div>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <EmployeePermissionComparison draft={draft} />
        <Typography.Paragraph type="secondary">
          此处展示员工默认权限。成员单独授权优先于这里的默认权限，可在
          <Link href={`/workspace/${tenantCode}/members`}>成员管理</Link>
          中查看。
        </Typography.Paragraph>
        <h3>编辑草稿权限</h3>
        {dirty ? (
          <Alert
            type="warning"
            showIcon
            title="有未保存的权限修改，请先保存再发布。"
          />
        ) : null}
        <Form
          disabled={draft.object.status === "ARCHIVED"}
          component={false}
          layout="vertical"
        >
          <Form.Item label="可以新建记录" htmlFor="employee-can-create">
            <Switch
              disabled={saving || draft.object.status === "ARCHIVED"}
              id="employee-can-create"
              aria-label="可以新建记录"
              checked={canCreate}
              onChange={setCanCreate}
            />
          </Form.Item>
          <Form.Item label="可以查看记录" htmlFor="employee-can-read">
            <Switch
              disabled={saving || draft.object.status === "ARCHIVED"}
              id="employee-can-read"
              aria-label="可以查看记录"
              checked={canRead}
              onChange={(next) => {
                setCanRead(next);
                // Granting an action while its scope says "no access" is a
                // contradiction the API now rejects; widen the scope instead of
                // letting the admin save something that cannot work.
                if (next && readScope === "NONE") setReadScope("ALL");
              }}
            />
          </Form.Item>
          <Form.Item label="可以修改记录" htmlFor="employee-can-update">
            <Switch
              disabled={saving || draft.object.status === "ARCHIVED"}
              id="employee-can-update"
              aria-label="可以修改记录"
              checked={canUpdate}
              onChange={(next) => {
                setCanUpdate(next);
                if (next && updateScope === "NONE") setUpdateScope("ALL");
              }}
            />
          </Form.Item>
          <Form.Item label="查看范围" htmlFor="employee-read-scope">
            <Select
              disabled={saving || draft.object.status === "ARCHIVED"}
              id="employee-read-scope"
              value={readScope}
              onChange={setReadScope}
              options={scopeOptions()}
            />
          </Form.Item>
          <Form.Item label="修改范围" htmlFor="employee-update-scope">
            <Select
              disabled={saving || draft.object.status === "ARCHIVED"}
              id="employee-update-scope"
              value={updateScope}
              onChange={setUpdateScope}
              options={scopeOptions()}
            />
          </Form.Item>
        </Form>
        <Typography.Text type="secondary">
          员工不能删除记录，删除操作由公司管理员执行。
        </Typography.Text>
        <div className={styles.sectionActions}>
          <Button
            type="primary"
            loading={saving}
            disabled={draft.object.status === "ARCHIVED"}
            onClick={() =>
              onSave({ canCreate, canRead, canUpdate, readScope, updateScope })
            }
          >
            保存员工权限
          </Button>
          <Button
            onClick={onPublish}
            loading={publishing}
            disabled={dirty || saving || draft.object.status === "ARCHIVED"}
          >
            检查并发布
          </Button>
          <Typography.Text type="secondary">
            仅保存本节到对象草稿；发布后员工端生效。
          </Typography.Text>
        </div>
      </Space>
    </section>
  );
}

function PublicationHistorySection({ draft }: { draft: ObjectDraft }) {
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <h2>发布记录</h2>
        <Typography.Text type="secondary">发布版本不可回滚</Typography.Text>
      </div>
      {draft.object.publicationNumber === null ? (
        <Typography.Paragraph type="secondary">
          该对象尚未发布，成员还看不到它。
        </Typography.Paragraph>
      ) : (
        <div className={styles.publicationList}>
          <div className={styles.publicationRow}>
            <span className={styles.publicationNumber}>
              v{draft.object.publicationNumber}
            </span>
            <span>
              {draft.object.status === "ARCHIVED"
                ? "停用前发布版本"
                : "当前运行版本"}
            </span>
            <Typography.Text type="secondary">
              {draft.object.publishedAt ?? ""}
            </Typography.Text>
          </div>
        </div>
      )}
    </section>
  );
}

function scopeOptions() {
  return (["ALL", "OWN", "NONE"] as PublishedDataScope[]).map((scope) => ({
    value: scope,
    label: DATA_SCOPE_LABELS[scope],
  }));
}

