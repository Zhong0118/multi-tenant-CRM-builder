"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";

import {
  FieldEditorDrawer,
  type FieldDraftValues,
} from "./field-editor-drawer";
import { FieldLedger } from "./field-ledger";
import { objectApi as defaultObjectApi, type ObjectApi } from "./object-api";
import { ObjectPreview, type PreviewRole } from "./object-preview";
import {
  DATA_SCOPE_LABELS,
  TITLE_FIELD_TYPES,
  objectStatusLabel,
  type ObjectDraft,
  type ObjectDraftField,
  type PublicationAnalysis,
  type PublishedDataScope,
} from "./object-types";
import { PublicationPanel } from "./publication-panel";

import styles from "./objects.module.css";

type Section = "basics" | "fields" | "view" | "permissions" | "publications";

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "basics", label: "基本设置" },
  { key: "fields", label: "字段" },
  { key: "view", label: "列表视图" },
  { key: "permissions", label: "员工权限" },
  { key: "publications", label: "发布记录" },
];

export interface ObjectDesignerProps {
  tenantCode: string;
  initialDraft: ObjectDraft;
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
  api = defaultObjectApi,
}: ObjectDesignerProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initialDraft);
  const [section, setSection] = useState<Section>("fields");
  const [previewRole, setPreviewRole] = useState<PreviewRole>("TENANT_ADMIN");
  const [editingField, setEditingField] = useState<ObjectDraftField | null>(
    null,
  );
  const [analysis, setAnalysis] = useState<PublicationAnalysis>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [conflicted, setConflicted] = useState(false);

  const objectId = draft.object.id;
  const archived = draft.object.status === "ARCHIVED";

  function accept(next: ObjectDraft) {
    setDraft(next);
    setError(undefined);
    setConflicted(false);
    void queryClient.invalidateQueries({
      queryKey: ["workspace", tenantCode, "object-definitions"],
      exact: false,
    });
  }

  function reject(caught: unknown) {
    const apiError = toApiError(caught);
    setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    setConflicted(
      apiError.code === "CONFIG_VERSION_CONFLICT" || apiError.status === 409,
    );
  }

  const reorder = useMutation({
    mutationFn: (fieldIds: string[]) =>
      api.reorderFields(tenantCode, objectId, {
        expectedVersion: draft.object.version,
        fieldIds,
      }),
    onSuccess: accept,
    onError: reject,
  });

  const saveField = useMutation({
    mutationFn: ({
      field,
      values,
    }: {
      field: ObjectDraftField;
      values: FieldDraftValues;
    }) =>
      api.updateField(tenantCode, objectId, field.id, {
        expectedVersion: draft.object.version,
        label: values.label,
        type: values.type,
        required: values.required,
        validation: pruneUndefined({
          minLength: values.minLength,
          maxLength: values.maxLength,
          min: values.min,
          max: values.max,
          scale: values.scale,
        }),
        config: pruneUndefined({
          options: values.options.length > 0 ? values.options : undefined,
          help: values.help === "" ? undefined : values.help,
        }),
      }),
    onSuccess: (next) => {
      accept(next);
      setEditingField(null);
    },
    onError: reject,
  });

  const saveBasics = useMutation({
    mutationFn: (input: {
      name: string;
      titleFieldKey: string;
      description: string;
    }) =>
      api.updateDraft(tenantCode, objectId, {
        expectedVersion: draft.object.version,
        name: input.name,
        titleFieldKey: input.titleFieldKey,
        description: input.description === "" ? null : input.description,
      }),
    onSuccess: accept,
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
    onSuccess: accept,
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
      accept(await api.draft(tenantCode, objectId));
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

  function moveField(fieldId: string, direction: -1 | 1) {
    const fieldIds = draft.fields.map((field) => field.id);
    const from = fieldIds.indexOf(fieldId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= fieldIds.length) return;
    [fieldIds[from], fieldIds[to]] = [fieldIds[to], fieldIds[from]];
    reorder.mutate(fieldIds);
  }

  return (
    <>
      <p className={styles.desktopOnly}>
        对象配置需要较宽的编辑区域，请在桌面端完成。
      </p>

      <div className={styles.designer}>
        <div style={{ gridColumn: "1 / -1" }}>
          <header className={styles.designerHeader}>
            <div className={styles.designerIdentity}>
              <span className={styles.eyebrow}>OBJECT CONFIGURATION</span>
              <h1>{draft.object.name}</h1>
              <div className={styles.designerMeta}>
                <span className={styles.stableKey}>{draft.object.code}</span>
                <Tag
                  color={
                    draft.object.hasUnpublishedChanges ? "gold" : undefined
                  }
                >
                  {objectStatusLabel(draft.object)}
                </Tag>
                <Typography.Text type="secondary">
                  {draft.activeRecordCount} 条业务记录
                </Typography.Text>
              </div>
            </div>
            <div className={styles.designerActions}>
              <Button
                type="primary"
                disabled={archived}
                loading={analyze.isPending}
                onClick={() => analyze.mutate()}
              >
                发布变更
              </Button>
            </div>
          </header>

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

        <nav className={styles.designerNav} aria-label="对象配置步骤">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.designerNavItem} ${
                section === item.key ? styles.designerNavItemActive : ""
              }`}
              aria-current={section === item.key ? "page" : undefined}
              onClick={() => setSection(item.key)}
            >
              {item.label}
            </button>
          ))}
          <span className={styles.designerNavVersion}>
            {draft.object.publicationNumber === null
              ? "尚未发布"
              : `v${draft.object.publicationNumber} 当前版本`}
          </span>
        </nav>

        <div>
          {section === "basics" ? (
            <BasicsSection
              draft={draft}
              saving={saveBasics.isPending}
              onSave={(input) => saveBasics.mutate(input)}
            />
          ) : null}

          {section === "fields" ? (
            <section>
              <div className={styles.sectionHeading}>
                <h2>字段 {draft.fields.length}</h2>
                <Typography.Text type="secondary">
                  选择字段后从右侧抽屉配置
                </Typography.Text>
              </div>
              <FieldLedger
                fields={draft.fields}
                titleFieldKey={draft.object.titleFieldKey}
                reordering={reorder.isPending}
                onSelect={setEditingField}
                onMove={moveField}
              />
            </section>
          ) : null}

          {section === "view" ? <DefaultViewSection draft={draft} /> : null}

          {section === "permissions" ? (
            <PermissionsSection
              draft={draft}
              saving={savePermissions.isPending}
              onSave={(input) => savePermissions.mutate(input)}
            />
          ) : null}

          {section === "publications" ? (
            <PublicationHistorySection draft={draft} />
          ) : null}

          <div style={{ marginTop: 24 }}>
            <ObjectPreview
              draft={draft}
              role={previewRole}
              onRoleChange={setPreviewRole}
            />
          </div>
        </div>
      </div>

      <FieldEditorDrawer
        field={editingField}
        saving={saveField.isPending}
        onClose={() => setEditingField(null)}
        onSubmit={(values) => {
          if (editingField) saveField.mutate({ field: editingField, values });
        }}
      />

      <PublicationPanel
        open={panelOpen}
        analysis={analysis}
        loading={analyze.isPending}
        publishing={publish.isPending}
        error={conflicted ? error : undefined}
        onConfirm={() => publish.mutate()}
        onClose={() => setPanelOpen(false)}
      />
    </>
  );
}

function BasicsSection({
  draft,
  saving,
  onSave,
}: {
  draft: ObjectDraft;
  saving: boolean;
  onSave: (input: {
    name: string;
    titleFieldKey: string;
    description: string;
  }) => void;
}) {
  const [name, setName] = useState(draft.object.name);
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

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <h2>基本设置</h2>
      </div>
      <Form component={false} layout="vertical">
        <Form.Item label="对象名称" htmlFor="object-name">
          <Input
            id="object-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Form.Item>
        <Form.Item
          label="对象代码"
          htmlFor="object-code"
          extra="对象代码在公司内唯一，首次发布后不可修改。"
        >
          <Input id="object-code" value={draft.object.code} disabled />
        </Form.Item>
        <Form.Item
          label="标题字段"
          htmlFor="object-title-field"
          extra="标题字段必须是必填的文本、电话、邮箱或单选字段。"
        >
          <Select
            id="object-title-field"
            value={titleFieldKey}
            onChange={setTitleFieldKey}
            options={titleCandidates.map((field) => ({
              value: field.fieldKey,
              label: `${field.label}（${field.fieldKey}）`,
            }))}
          />
        </Form.Item>
        <Form.Item label="说明" htmlFor="object-description">
          <Input.TextArea
            id="object-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Form.Item>
      </Form>
      <Button
        type="primary"
        loading={saving}
        onClick={() => onSave({ name, titleFieldKey, description })}
      >
        保存基本设置
      </Button>
    </section>
  );
}

function DefaultViewSection({ draft }: { draft: ObjectDraft }) {
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <h2>列表视图</h2>
      </div>
      {draft.defaultView ? (
        <>
          <Typography.Paragraph>
            默认列：
            {draft.defaultView.columnFieldKeys.length === 0
              ? "尚未选择"
              : draft.defaultView.columnFieldKeys.join("、")}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            默认排序：{draft.defaultView.sort.field}{" "}
            {draft.defaultView.sort.direction === "desc" ? "降序" : "升序"}
          </Typography.Paragraph>
        </>
      ) : (
        <Alert
          type="warning"
          showIcon
          title="尚未配置默认列表视图，发布会被阻断。"
        />
      )}
    </section>
  );
}

function PermissionsSection({
  draft,
  saving,
  onSave,
}: {
  draft: ObjectDraft;
  saving: boolean;
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

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <h2>员工权限</h2>
        <Typography.Text type="secondary">
          员工默认权限需要发布后生效
        </Typography.Text>
      </div>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Form component={false} layout="vertical">
          <Form.Item label="可以新建记录" htmlFor="employee-can-create">
            <Switch
              id="employee-can-create"
              aria-label="可以新建记录"
              checked={canCreate}
              onChange={setCanCreate}
            />
          </Form.Item>
          <Form.Item label="可以查看记录" htmlFor="employee-can-read">
            <Switch
              id="employee-can-read"
              aria-label="可以查看记录"
              checked={canRead}
              onChange={setCanRead}
            />
          </Form.Item>
          <Form.Item label="可以修改记录" htmlFor="employee-can-update">
            <Switch
              id="employee-can-update"
              aria-label="可以修改记录"
              checked={canUpdate}
              onChange={setCanUpdate}
            />
          </Form.Item>
          <Form.Item label="查看范围" htmlFor="employee-read-scope">
            <Select
              id="employee-read-scope"
              value={readScope}
              onChange={setReadScope}
              options={scopeOptions()}
            />
          </Form.Item>
          <Form.Item label="修改范围" htmlFor="employee-update-scope">
            <Select
              id="employee-update-scope"
              value={updateScope}
              onChange={setUpdateScope}
              options={scopeOptions()}
            />
          </Form.Item>
        </Form>
        <Typography.Text type="secondary">
          本切片不授予员工删除权限，软删除仅公司管理员可执行。
        </Typography.Text>
        <Button
          type="primary"
          loading={saving}
          onClick={() =>
            onSave({ canCreate, canRead, canUpdate, readScope, updateScope })
          }
        >
          保存员工权限
        </Button>
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
            <span>当前运行版本</span>
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

function pruneUndefined<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
