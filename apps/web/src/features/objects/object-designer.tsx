"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  EyeOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Switch,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  FIELD_ACCESS_LABELS,
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
  type PublishedFieldAccess,
  type PublishedFieldType,
  type RecordSortDirection,
  type RecordSortField,
} from "./object-types";
import { PublicationPanel } from "./publication-panel";
import { AutomationDesigner } from "@/features/automations/automation-designer";
import { WorkflowDesigner } from "./workflow-designer";

import styles from "./objects.module.css";
import designer from "./object-designer.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

type Section =
  | "basics"
  | "fields"
  | "view"
  | "permissions"
  | "workflow"
  | "automations"
  | "publications";

const FIELD_SAVED = "字段已保存";

/**
 * The designer's sections in the order an administrator works through them,
 * grouped by what they configure. `hint` says what the section decides; every
 * section except 发布与停用 saves to the draft, which employees see only after
 * the business table is published.
 */
const SECTIONS: Array<{
  key: Section;
  label: string;
  group: string;
  hint: string;
}> = [
  {
    key: "basics",
    label: "基本设置",
    group: "结构",
    hint: "名称、记录名称字段、图标",
  },
  {
    key: "fields",
    label: "字段与表单",
    group: "结构",
    hint: "字段，及表单和详情中的顺序",
  },
  {
    key: "view",
    label: "列表展示与搜索",
    group: "结构",
    hint: "表格的列和顺序、搜索、排序",
  },
  {
    key: "permissions",
    label: "员工权限",
    group: "权限",
    hint: "员工默认能做什么、看到哪些列",
  },
  {
    key: "workflow",
    label: "流程",
    group: "规则",
    hint: "状态、可执行动作和执行步骤",
  },
  {
    key: "automations",
    label: "跨表自动化",
    group: "规则",
    hint: "在其他业务表创建并关联记录",
  },
  {
    key: "publications",
    label: "发布与停用",
    group: "发布",
    hint: "发布记录、停用和恢复",
  },
];
const SECTION_GROUPS = [...new Set(SECTIONS.map((item) => item.group))];

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
  // Unsaved edits in sections other than the field editor, which reports its
  // own through `fieldDirty`.
  const [dirtySections, setDirtySections] = useState<ReadonlySet<Section>>(
    () => new Set(),
  );
  const markDirty = useCallback((key: Section, dirty: boolean) => {
    setDirtySections((current) => {
      if (current.has(key) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const dirtyHandlers = useMemo(
    () =>
      Object.fromEntries(
        SECTIONS.map((item) => [
          item.key,
          (dirty: boolean) => markDirty(item.key, dirty),
        ]),
      ) as Record<Section, (dirty: boolean) => void>,
    [markDirty],
  );
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
  const sectionDirty = (key: Section) =>
    key === "fields" ? fieldDirty : dirtySections.has(key);
  const anyDirty = fieldDirty || dirtySections.size > 0;

  // Closing the tab or reloading with unsaved edits asks first, like every
  // in-app way of leaving them. Links elsewhere in the app (the sidebar, the
  // breadcrumb) go through the same 放弃未保存的修改 dialog.
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank")
        return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setDiscardAction(() => () => router.push(`${url.pathname}${url.search}`));
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
    };
  }, [anyDirty, router]);

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

  /** Leaves the current section, first asking if it holds unsaved edits. */
  function guardSection(action: () => void) {
    if (!sectionDirty(section)) action();
    else
      setDiscardAction(() => () => {
        markDirty(section, false);
        action();
      });
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
            ? {
                options: [
                  {
                    key: "option_1",
                    label: "选项 1",
                    status: "ACTIVE",
                    color: defaultSelectOptionColor(0),
                  },
                ],
              }
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
    mutationFn: ({ fields, ...input }: EmployeePolicyInput) =>
      api.updatePermissions(tenantCode, objectId, {
        expectedVersion: draft.object.version,
        canDelete: false,
        fields: Object.fromEntries(
          draft.fields.map((field) => [
            field.fieldKey,
            fields[field.fieldKey] ?? field.employeeAccess,
          ]),
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
      <div className={`${styles.designer} ${designer.designer}`}>
        <div>
          <PageHeader
            breadcrumb={
              <Link href={`/workspace/${tenantCode}/settings/objects`}>
                业务表
              </Link>
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
                {!archived &&
                draft.object.publicationNumber !== null &&
                draft.object.hasUnpublishedChanges
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
                  title={anyDirty ? "请先保存或放弃未保存的修改" : undefined}
                  disabled={archived || anyDirty || savePermissions.isPending}
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

        <p className={designer.phoneNote}>
          手机上可以查看配置并做小幅修改；拖动排序和复杂规则建议在电脑上完成。
        </p>

        <div className={designer.shell}>
          <nav
            className={`${styles.designerNav} ${designer.rail}`}
            aria-label="业务表配置步骤"
          >
            {SECTION_GROUPS.map((group) => (
              <div
                key={group}
                className={designer.railGroup}
                role="group"
                aria-label={group}
              >
                <span className={designer.railGroupLabel} aria-hidden>
                  {group}
                </span>
                {SECTIONS.filter((item) => item.group === group).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`${styles.designerNavItem} ${designer.railItem} ${
                      section === item.key ? styles.designerNavItemActive : ""
                    }`}
                    aria-current={section === item.key ? "page" : undefined}
                    aria-describedby={`designer-hint-${item.key}`}
                    onClick={() => {
                      if (item.key !== section)
                        guardSection(() => setSection(item.key));
                    }}
                  >
                    <span className={designer.railLabel}>
                      {item.label}
                      {item.key === "fields" ? (
                        <span className={styles.designerNavCount}>
                          {draft.fields.length}
                        </span>
                      ) : null}
                      {sectionDirty(item.key) ? (
                        <span
                          className={designer.dirtyDot}
                          title="有未保存的修改"
                        >
                          <span className={designer.srOnly}>
                            ，有未保存的修改
                          </span>
                        </span>
                      ) : null}
                    </span>
                    <span
                      id={`designer-hint-${item.key}`}
                      className={designer.railHint}
                      aria-hidden
                    >
                      {item.hint}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className={`${styles.designerWorkspace} ${designer.workspace}`}>
            {section === "basics" ? (
              <>
                <BasicsSection
                  key={draft.object.version}
                  tenantCode={tenantCode}
                  draft={draft}
                  onDirtyChange={dirtyHandlers.basics}
                  saving={saveBasics.isPending}
                  onSave={(input) => {
                    if (!archived) saveBasics.mutate(input);
                  }}
                />
                <p className={designer.crossLink}>
                  停用、恢复和发布记录在
                  <Button
                    type="link"
                    size="small"
                    aria-label="前往发布与停用"
                    onClick={() =>
                      guardSection(() => setSection("publications"))
                    }
                  >
                    发布与停用
                  </Button>
                  中。
                </p>
              </>
            ) : null}

            {section === "fields" ? (
              <section className={styles.fieldsLayout}>
                <div className={styles.fieldListColumn}>
                  <div className={styles.fieldListHeading}>
                    <p className={designer.orderNote}>
                      <strong>表单顺序</strong>
                      ：拖动或用键盘调整新建、编辑表单和详情页中的字段顺序。表格的列顺序在
                      <Button
                        type="link"
                        size="small"
                        aria-label="前往列表展示与搜索"
                        onClick={() => guardSection(() => setSection("view"))}
                      >
                        列表展示与搜索
                      </Button>
                      中单独设置。
                    </p>
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
                key={draft.object.version}
                draft={draft}
                onDirtyChange={dirtyHandlers.view}
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
                onDirtyChange={dirtyHandlers.permissions}
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
                onDirtyChange={dirtyHandlers.workflow}
                onObjectVersion={setDraft}
                objectApi={api}
              />
            ) : null}

            {section === "automations" ? (
              <AutomationDesigner
                tenantCode={tenantCode}
                draft={draft}
                onObjectVersion={setDraft}
                objects={api}
              />
            ) : null}

            {section === "publications" ? (
              <PublicationHistorySection
                tenantCode={tenantCode}
                draft={draft}
                api={api}
                publishing={analyze.isPending || publish.isPending}
                publishBlocked={anyDirty || archived}
                onPublish={() => {
                  if (!archived) analyze.mutate();
                }}
                lifecycle={
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
                }
              />
            ) : null}
          </div>
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
        <p>
          {!sectionDirty(section)
            ? "有修改还没有保存，离开后会丢失。"
            : section === "fields"
              ? "当前字段的修改还没有保存，离开后会丢失。"
              : `「${SECTIONS.find((item) => item.key === section)?.label}」的修改还没有保存，离开后会丢失。`}
        </p>
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
        onRecheck={() => analyze.mutate()}
        fieldLabel={(fieldKey) =>
          draft.fields.find((field) => field.fieldKey === fieldKey)?.label
        }
        onLocate={(issue) => {
          setPanelOpen(false);
          if (issue.transitionKey || issue.actionKey) {
            setSection("workflow");
            return;
          }
          const target = draft.fields.find(
            (field) => field.fieldKey === issue.fieldKey,
          );
          setSection("fields");
          if (target) setSelectedFieldId(target.id);
        }}
      />
    </>
  );
}

/** Reports a section's unsaved state up, and clears it when the section closes. */
function useReportDirty(
  dirty: boolean,
  onDirtyChange?: (dirty: boolean) => void,
) {
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
}

function BasicsSection({
  tenantCode,
  draft,
  saving,
  onSave,
  onDirtyChange,
}: {
  tenantCode: string;
  draft: ObjectDraft;
  saving: boolean;
  onDirtyChange?: (dirty: boolean) => void;
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
  useReportDirty(
    name !== draft.object.name ||
      icon !== draft.object.icon ||
      titleFieldKey !== draft.object.titleFieldKey ||
      description !== (draft.object.description ?? ""),
    onDirtyChange,
  );
  return (
    <section className={styles.panel} aria-label="基本设置">
      <p className={styles.sectionLead}>{objectStatusDescription(draft)}</p>
      <SettingRows
        footer={
          <>
            <Typography.Text type="secondary">
              仅保存本节到对象草稿；发布后员工端生效。
            </Typography.Text>
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
        <SettingRow
          label="业务表代码"
          htmlFor="object-code"
          help={objectStableIdHelp(tenantCode)}
        >
          <Input
            id="object-code"
            value={draft.object.code}
            disabled
            className={styles.settingInput}
          />
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
        <SettingRow
          label="图标"
          help="显示在侧栏的业务表名称前，发布后员工端更新。"
        >
          <ObjectIconPicker
            value={icon}
            onChange={setIcon}
            disabled={saving || disabled}
          />
        </SettingRow>
        <SettingRow
          label="说明"
          htmlFor="object-description"
          help="显示在员工端的业务表标题下。"
        >
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
  onDirtyChange,
}: {
  draft: ObjectDraft;
  saving: boolean;
  onDirtyChange?: (dirty: boolean) => void;
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

  const initialColumns =
    draft.defaultView?.columnFieldKeys ??
    activeFields.map((field) => field.fieldKey);
  const initialSearch =
    draft.defaultView?.searchFieldKeys ??
    (draft.defaultView?.columnFieldKeys ?? []).filter((fieldKey) =>
      searchableFields.some((field) => field.fieldKey === fieldKey),
    );
  useReportDirty(
    name !== (draft.defaultView?.name ?? "默认列表") ||
      columnFieldKeys.join() !== initialColumns.join() ||
      [...searchFieldKeys].sort().join() !== [...initialSearch].sort().join() ||
      sortField !== (draft.defaultView?.sort.field ?? "updatedAt") ||
      sortDirection !== (draft.defaultView?.sort.direction ?? "desc"),
    onDirtyChange,
  );
  const archived = draft.object.status === "ARCHIVED";
  const labelOf = (fieldKey: string) =>
    activeFields.find((field) => field.fieldKey === fieldKey)?.label ??
    fieldKey;
  const sortLabel = {
    updatedAt: "最近更新时间",
    createdAt: "创建时间",
    recordNo: "记录编号",
  }[sortField];

  return (
    <section className={styles.panel} aria-label="列表展示与搜索">
      <p className={designer.lead}>
        决定打开表格时默认看到的<strong>列、列的顺序</strong>
        、关键词搜索范围和排序。 这里的列顺序<strong>与表单顺序无关</strong>
        ：新建、编辑表单和详情页中的字段顺序，在「字段与表单」中拖动调整。每位成员还可以在表格里调整自己看到的列。
      </p>

      <div className={designer.split}>
        <div className={designer.splitMain}>
          <h3 className={designer.blockTitle}>
            表格的列
            <span>
              显示 {columnFieldKeys.length} 列 · 共 {activeFields.length} 个字段
            </span>
          </h3>
          <ol
            className={designer.columnList}
            aria-label="默认在列表展示的列与顺序"
          >
            {orderedFields.map((field) => {
              const selectedIndex = columnFieldKeys.indexOf(field.fieldKey);
              const selected = selectedIndex >= 0;
              return (
                <li
                  key={field.id}
                  className={designer.columnRow}
                  data-selected={selected || undefined}
                >
                  <span className={designer.columnIndex} aria-hidden>
                    {selected ? selectedIndex + 1 : "—"}
                  </span>
                  <label>
                    <input
                      type="checkbox"
                      disabled={archived}
                      checked={selected}
                      onChange={(event) =>
                        toggleColumn(field.fieldKey, event.target.checked)
                      }
                    />
                    <span>{field.label}</span>
                    <code>{field.fieldKey}</code>
                  </label>
                  {selected ? (
                    <span className={designer.moveButtons}>
                      <Button
                        size="small"
                        type="text"
                        aria-label={`上移 ${field.label}`}
                        icon={<ArrowUpOutlined aria-hidden />}
                        disabled={archived || selectedIndex === 0}
                        onClick={() => moveColumn(field.fieldKey, -1)}
                      />
                      <Button
                        size="small"
                        type="text"
                        aria-label={`下移 ${field.label}`}
                        icon={<ArrowDownOutlined aria-hidden />}
                        disabled={
                          archived ||
                          selectedIndex === columnFieldKeys.length - 1
                        }
                        onClick={() => moveColumn(field.fieldKey, 1)}
                      />
                    </span>
                  ) : (
                    <span className={designer.columnHidden}>不显示</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <div className={designer.splitSide}>
          <figure className={designer.tablePreview} aria-label="默认列表预览">
            <figcaption>员工打开表格时看到的表头</figcaption>
            <div className={designer.tablePreviewHead}>
              {columnFieldKeys.length ? (
                columnFieldKeys.map((fieldKey, index) => (
                  <span key={fieldKey}>
                    {labelOf(fieldKey)}
                    {index === 0 ? <em>链接到记录</em> : null}
                  </span>
                ))
              ) : (
                <span className={designer.previewEmpty}>至少选择一列</span>
              )}
            </div>
            <p>
              按{sortLabel}
              {sortDirection === "desc" ? "从新到旧" : "从旧到新"}排列 · 搜索
              {[
                labelOf(draft.object.titleFieldKey),
                ...searchFieldKeys
                  .filter((key) => key !== draft.object.titleFieldKey)
                  .map(labelOf),
              ].join("、")}
            </p>
          </figure>

          <Form disabled={archived} component={false} layout="vertical">
            <Form.Item label="视图名称" htmlFor="default-view-name">
              <Input
                id="default-view-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Form.Item>
            <Form.Item
              label="关键词搜索字段"
              extra="始终包含记录名称。隐藏字段即使勾选，也不会进入员工的搜索。"
            >
              {searchableFields.length === 0 ? (
                <Typography.Text type="secondary">
                  当前没有可搜索的文本、长文本、电话或邮箱字段。
                </Typography.Text>
              ) : (
                <div className={designer.checkList}>
                  {searchableFields.map((field) => {
                    const selected = searchFieldKeys.includes(field.fieldKey);
                    const isTitle =
                      field.fieldKey === draft.object.titleFieldKey;
                    return (
                      <label key={field.id}>
                        <input
                          type="checkbox"
                          aria-label={
                            isTitle
                              ? `${field.label}（记录名称，始终可搜索）`
                              : `将${field.label}纳入关键词搜索`
                          }
                          checked={selected || isTitle}
                          disabled={archived || isTitle}
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
                        {isTitle ? <em>记录名称</em> : null}
                      </label>
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
        </div>
      </div>

      <div className={`${styles.sectionActions} ${designer.saveBar}`}>
        <Button
          type="primary"
          loading={saving}
          disabled={
            archived || name.trim() === "" || columnFieldKeys.length === 0
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

type EmployeePolicyInput = {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  readScope: PublishedDataScope;
  updateScope: PublishedDataScope;
  fields: Record<string, PublishedFieldAccess>;
};

/**
 * Employee defaults as one matrix: what employees have now (the live
 * publication), what the draft holds, and what is being changed here. Table
 * actions and column access are saved together, to the draft; they reach
 * employees when the table is published. Member exceptions live on the
 * member's own access page and take effect immediately.
 */
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
  onSave: (input: EmployeePolicyInput) => void;
}) {
  const current = draft.employeeAccess;
  const published = draft.publishedEmployeeAccess;
  const archived = draft.object.status === "ARCHIVED";
  const activeFields = draft.fields.filter(
    (field) => field.status === "ACTIVE",
  );
  const [canCreate, setCanCreate] = useState(current?.canCreate ?? false);
  const [canRead, setCanRead] = useState(current?.canRead ?? false);
  const [canUpdate, setCanUpdate] = useState(current?.canUpdate ?? false);
  const [readScope, setReadScope] = useState<PublishedDataScope>(
    current?.readScope ?? "NONE",
  );
  const [updateScope, setUpdateScope] = useState<PublishedDataScope>(
    current?.updateScope ?? "NONE",
  );
  const [fieldAccess, setFieldAccess] = useState<
    Record<string, PublishedFieldAccess>
  >(() =>
    Object.fromEntries(
      draft.fields.map((field) => [field.fieldKey, field.employeeAccess]),
    ),
  );

  const changedFields = activeFields.filter(
    (field) => fieldAccess[field.fieldKey] !== field.employeeAccess,
  );
  const dirty =
    canCreate !== (current?.canCreate ?? false) ||
    canRead !== (current?.canRead ?? false) ||
    canUpdate !== (current?.canUpdate ?? false) ||
    readScope !== (current?.readScope ?? "NONE") ||
    updateScope !== (current?.updateScope ?? "NONE") ||
    changedFields.length > 0;
  useReportDirty(dirty, onDirtyChange);

  const describe = (
    allowed: boolean,
    scope: PublishedDataScope,
    action: string,
  ) =>
    allowed && scope !== "NONE" ? DATA_SCOPE_LABELS[scope] : `禁止${action}`;
  const savedRows = {
    create: current?.canCreate ? "允许新建" : "禁止新建",
    read: describe(
      current?.canRead ?? false,
      current?.readScope ?? "NONE",
      "查看",
    ),
    update: describe(
      current?.canUpdate ?? false,
      current?.updateScope ?? "NONE",
      "修改",
    ),
  };
  const liveRows = {
    create: published?.canCreate ? "允许新建" : "禁止新建",
    read: describe(
      published?.canRead ?? false,
      published?.readScope ?? "NONE",
      "查看",
    ),
    update: describe(
      published?.canUpdate ?? false,
      published?.updateScope ?? "NONE",
      "修改",
    ),
  };
  const editedRows = {
    create: canCreate ? "允许新建" : "禁止新建",
    read: describe(canRead, readScope, "查看"),
    update: describe(canUpdate, updateScope, "修改"),
  };
  const liveFields = published?.fields ?? [];
  const pending =
    !published ||
    (["create", "read", "update"] as const).some(
      (key) => liveRows[key] !== savedRows[key],
    ) ||
    activeFields.some(
      (field) =>
        liveFields.find((live) => live.fieldKey === field.fieldKey)?.access !==
        field.employeeAccess,
    ) ||
    liveFields.some(
      (live) => !activeFields.some((field) => field.fieldKey === live.fieldKey),
    );
  const titleHidden = fieldAccess[draft.object.titleFieldKey] === "HIDDEN";
  const locked = saving || archived;

  function marker(live: string | undefined, saved: string, edited: string) {
    if (edited !== saved)
      return <span className={designer.markUnsaved}>未保存</span>;
    if (published && live !== saved)
      return <span className={styles.permissionChange}>待发布</span>;
    return null;
  }

  return (
    <section className={styles.panel} aria-label="员工权限">
      <p className={designer.lead}>
        这里是<strong>所有员工</strong>的默认权限：保存到草稿，
        <strong>发布业务表后生效</strong>。
        只对某位员工放宽或收紧时，成员的单独授权优先于这里的默认权限，在
        <Link href={`/workspace/${tenantCode}/members`}>成员</Link>
        的访问权限中设置，保存后立即生效。管理员不受这里的限制，员工不能删除记录。
      </p>
      <Alert
        showIcon
        type={pending || archived ? "warning" : "success"}
        title={
          archived
            ? "此业务表已归档，员工不可访问。"
            : !published
              ? "尚未发布，员工暂不可访问此业务表。"
              : pending
                ? "员工默认权限有待发布修改"
                : "已保存的员工默认权限与当前生效版本一致"
        }
        description={
          pending && !archived
            ? "保存只更新草稿。检查并发布后，新的默认权限才会生效。"
            : undefined
        }
      />
      {dirty ? (
        <Alert
          type="warning"
          showIcon
          title="有未保存的权限修改，请先保存再发布。"
        />
      ) : null}

      <div className={designer.matrixScroll}>
        <table className={designer.matrix} aria-label="员工默认权限对照">
          <thead>
            <tr>
              <th scope="col">权限项</th>
              <th scope="col">
                {published
                  ? `${archived ? "归档前发布" : "当前生效"} · v${draft.object.publicationNumber}`
                  : "当前：尚未发布"}
              </th>
              <th scope="col">已保存草稿</th>
              <th scope="col">修改为</th>
            </tr>
          </thead>
          <tbody>
            <tr className={designer.matrixGroup}>
              <th scope="rowgroup" colSpan={4}>
                记录
                <span>
                  字段权限还受这里的新建、查看、修改限制；「仅本人负责」指负责人是该员工的记录。
                </span>
              </th>
            </tr>
            <tr>
              <th scope="row">新建记录</th>
              <td>{published ? liveRows.create : "—"}</td>
              <td>
                {savedRows.create}
                {marker(liveRows.create, savedRows.create, savedRows.create)}
              </td>
              <td>
                <span className={designer.matrixControl}>
                  <Switch
                    id="employee-can-create"
                    aria-label="可以新建记录"
                    size="small"
                    disabled={locked}
                    checked={canCreate}
                    onChange={setCanCreate}
                  />
                  {editedRows.create}
                  {marker(liveRows.create, savedRows.create, editedRows.create)}
                </span>
              </td>
            </tr>
            {(
              [
                [
                  "read",
                  "查看记录",
                  "可以查看记录",
                  canRead,
                  readScope,
                  "查看范围",
                ],
                [
                  "update",
                  "修改记录",
                  "可以修改记录",
                  canUpdate,
                  updateScope,
                  "修改范围",
                ],
              ] as const
            ).map(([key, label, switchLabel, allowed, scope, scopeLabel]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{published ? liveRows[key] : "—"}</td>
                <td>
                  {savedRows[key]}
                  {marker(liveRows[key], savedRows[key], savedRows[key])}
                </td>
                <td>
                  <span className={designer.matrixControl}>
                    <Switch
                      id={`employee-can-${key}`}
                      aria-label={switchLabel}
                      size="small"
                      disabled={locked}
                      checked={allowed}
                      onChange={(next) => {
                        if (key === "read") {
                          setCanRead(next);
                          // Granting an action while its scope says "no access"
                          // is a contradiction the API rejects; widen the scope
                          // instead of letting the admin save something that
                          // cannot work.
                          if (next && readScope === "NONE") setReadScope("ALL");
                        } else {
                          setCanUpdate(next);
                          if (next && updateScope === "NONE")
                            setUpdateScope("ALL");
                        }
                      }}
                    />
                    <Select
                      id={`employee-${key}-scope`}
                      aria-label={scopeLabel}
                      size="small"
                      disabled={locked}
                      value={scope}
                      className={designer.scopeSelect}
                      onChange={key === "read" ? setReadScope : setUpdateScope}
                      options={scopeOptions()}
                    />
                    {marker(liveRows[key], savedRows[key], editedRows[key])}
                  </span>
                </td>
              </tr>
            ))}
            <tr className={designer.matrixGroup}>
              <th scope="rowgroup" colSpan={4}>
                列
                <span>
                  只读列员工能看不能改；隐藏列在列表、表单、详情和搜索中都不出现。
                </span>
              </th>
            </tr>
            {activeFields.map((field) => {
              const live = liveFields.find(
                (item) => item.fieldKey === field.fieldKey,
              );
              const liveText = live
                ? FIELD_ACCESS_LABELS[live.access]
                : "未发布此字段";
              const savedText = FIELD_ACCESS_LABELS[field.employeeAccess];
              const edited =
                fieldAccess[field.fieldKey] ?? field.employeeAccess;
              return (
                <tr key={field.id}>
                  <th scope="row">
                    字段：{field.label}
                    {field.fieldKey === draft.object.titleFieldKey ? (
                      <span className={designer.rowNote}>记录名称</span>
                    ) : null}
                  </th>
                  <td>{published ? liveText : "—"}</td>
                  <td>
                    {savedText}
                    {marker(liveText, savedText, savedText)}
                  </td>
                  <td>
                    <span className={designer.matrixControl}>
                      <Segmented
                        size="small"
                        aria-label={`${field.label}的员工访问`}
                        disabled={locked}
                        value={edited}
                        onChange={(value) =>
                          setFieldAccess((all) => ({
                            ...all,
                            [field.fieldKey]: value as PublishedFieldAccess,
                          }))
                        }
                        options={(["EDIT", "READ_ONLY", "HIDDEN"] as const).map(
                          (access) => ({
                            value: access,
                            label: FIELD_ACCESS_LABELS[access],
                          }),
                        )}
                      />
                      {marker(liveText, savedText, FIELD_ACCESS_LABELS[edited])}
                    </span>
                  </td>
                </tr>
              );
            })}
            {liveFields
              .filter(
                (live) =>
                  !activeFields.some(
                    (field) => field.fieldKey === live.fieldKey,
                  ),
              )
              .map((live) => (
                <tr key={`retired:${live.fieldKey}`}>
                  <th scope="row">字段：{live.label}</th>
                  <td>{FIELD_ACCESS_LABELS[live.access]}</td>
                  <td>
                    字段已停用
                    <span className={styles.permissionChange}>待发布</span>
                  </td>
                  <td />
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {titleHidden ? (
        <Alert
          type="warning"
          showIcon
          title="隐藏记录名称列会使员工无法访问整张业务表。"
        />
      ) : null}

      <div className={`${styles.sectionActions} ${designer.saveBar}`}>
        <Button
          type="primary"
          loading={saving}
          disabled={archived}
          onClick={() =>
            onSave({
              canCreate,
              canRead,
              canUpdate,
              readScope,
              updateScope,
              fields: fieldAccess,
            })
          }
        >
          保存员工权限
        </Button>
        <Button
          onClick={onPublish}
          loading={publishing}
          disabled={dirty || saving || archived}
        >
          检查并发布
        </Button>
        <Typography.Text type="secondary">
          仅保存本节到对象草稿；发布后员工端生效。
        </Typography.Text>
      </div>
    </section>
  );
}

const CHANGE_KIND_LABELS = {
  ADDED: "新增",
  UPDATED: "修改",
  INACTIVATED: "停用",
} as const;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * 发布与停用: what each kind of change does and when, where the table stands,
 * the whole-table lifecycle, and every publication with what it changed.
 */
function PublicationHistorySection({
  tenantCode,
  draft,
  api,
  publishing,
  publishBlocked,
  onPublish,
  lifecycle,
}: {
  tenantCode: string;
  draft: ObjectDraft;
  api: ObjectApi;
  publishing: boolean;
  publishBlocked: boolean;
  onPublish: () => void;
  lifecycle: React.ReactNode;
}) {
  const history = useQuery({
    queryKey: [
      "workspace",
      tenantCode,
      "object-publications",
      draft.object.id,
      draft.object.publicationNumber,
    ],
    queryFn: () => api.listPublications(tenantCode, draft.object.id),
  });
  const archived = draft.object.status === "ARCHIVED";
  const live = draft.object.publicationNumber;
  const labelOf = (fieldKey: string) =>
    draft.fields.find((field) => field.fieldKey === fieldKey)?.label ??
    fieldKey;
  const publications = [...(history.data ?? [])].sort(
    (a, b) => b.number - a.number,
  );

  return (
    <section className={styles.panel} aria-label="发布与停用">
      <div className={designer.statusStrip}>
        <div>
          <span className={designer.statusLabel}>员工正在使用</span>
          <strong>
            {live === null ? "尚未发布" : `v${live}`}
            {archived ? "（已停用）" : null}
          </strong>
          {live !== null ? (
            <span className={designer.statusMeta}>
              发布于 {formatDateTime(draft.object.publishedAt)}
            </span>
          ) : null}
        </div>
        <div>
          <span className={designer.statusLabel}>草稿</span>
          <strong>修订 {draft.object.version}</strong>
          <span className={designer.statusMeta}>
            {archived
              ? "已停用，配置只读"
              : live === null
                ? "发布后员工才能使用这张表"
                : draft.object.hasUnpublishedChanges
                  ? "有未发布的修改"
                  : "与员工使用的版本一致"}
          </span>
        </div>
        {!archived ? (
          <Button
            type={
              draft.object.hasUnpublishedChanges || live === null
                ? "primary"
                : "default"
            }
            loading={publishing}
            disabled={publishBlocked}
            title={publishBlocked ? "请先保存或放弃未保存的修改" : undefined}
            onClick={onPublish}
          >
            检查并发布
          </Button>
        ) : null}
      </div>

      <h3 className={designer.blockTitle}>每种操作的影响</h3>
      <table className={designer.effectTable} aria-label="每种操作的影响">
        <thead>
          <tr>
            <th scope="col">操作</th>
            <th scope="col">改变什么</th>
            <th scope="col">员工何时看到</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">保存（各配置页）</th>
            <td>
              只改草稿：字段、表单顺序、列表、员工默认权限、流程和跨表规则
            </td>
            <td>发布之后</td>
          </tr>
          <tr>
            <th scope="row">发布</th>
            <td>
              发布前先检查，有阻断问题时不能发布；通过后草稿成为新版本
              {live === null ? " v1" : ` v${live + 1}`}
              ，所有员工改用新版本，已有记录保留
            </td>
            <td>立即</td>
          </tr>
          <tr>
            <th scope="row">停用业务表</th>
            <td>员工端隐藏这张表，管理员只读；记录、配置和发布记录都保留</td>
            <td>立即</td>
          </tr>
          <tr>
            <th scope="row">恢复业务表</th>
            <td>回到停用前发布的版本，不会顺带发布草稿</td>
            <td>立即</td>
          </tr>
          <tr>
            <th scope="row">成员例外</th>
            <td>
              只对某位员工放宽或收紧权限，在
              <Link href={`/workspace/${tenantCode}/members`}>成员</Link>
              中设置，不经过发布
            </td>
            <td>保存后立即</td>
          </tr>
        </tbody>
      </table>

      <div className={designer.lifecycleRow}>
        <div>
          <h3 className={designer.blockTitle}>停用与恢复</h3>
          <p className={designer.muted}>
            {archived
              ? `已停用 · 上次发布版本 v${draft.object.publicationNumber} · ${draft.object.archivedAt ? formatDateTime(draft.object.archivedAt) : "缺少历史停用时间"}`
              : live === null
                ? "尚未发布的业务表没有可停用的版本；不再需要时可在页面右上角删除草稿。"
                : "停用前会列出受影响的记录和依赖，确认后才执行。"}
          </p>
        </div>
        {lifecycle}
      </div>

      <h3 className={designer.blockTitle}>
        发布记录
        <span>发布版本不可回滚</span>
      </h3>
      {live === null ? (
        <p className={designer.muted}>该对象尚未发布，成员还看不到它。</p>
      ) : history.isPending ? (
        <p className={designer.muted} role="status">
          正在载入发布记录…
        </p>
      ) : history.isError ? (
        <Alert
          type="error"
          showIcon
          title={`发布记录读取失败：${toApiError(history.error).message}`}
          action={
            <Button size="small" onClick={() => void history.refetch()}>
              重试
            </Button>
          }
        />
      ) : (
        <ol className={designer.timeline} aria-label="发布记录">
          {publications.map((publication) => (
            <li
              key={publication.id}
              data-current={publication.number === live || undefined}
            >
              <span className={designer.timelineVersion}>
                v{publication.number}
              </span>
              <div>
                <p className={designer.timelineHead}>
                  <strong>{formatDateTime(publication.publishedAt)}</strong>
                  {publication.number === live ? (
                    <StatusTag tone={archived ? "neutral" : "success"}>
                      {archived ? "停用前发布版本" : "当前运行版本"}
                    </StatusTag>
                  ) : null}
                  <span>来自草稿修订 {publication.sourceDraftVersion}</span>
                </p>
                {publication.changes.length ? (
                  <ul className={designer.changeList}>
                    {publication.changes.map((change) => (
                      <li
                        key={`${change.kind}:${change.fieldKey}`}
                        data-kind={change.kind}
                      >
                        {CHANGE_KIND_LABELS[change.kind]}字段「
                        {labelOf(change.fieldKey)}」
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={designer.muted}>
                    没有字段变化（权限、列表、流程或规则的调整）
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
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
