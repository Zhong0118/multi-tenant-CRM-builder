"use client";

import { Button, Form, Input, Select, Space, Switch, Typography } from "antd";
import { useMemo, useState } from "react";

import {
  FieldEditorDrawer,
  type FieldDraftValues,
} from "../objects/field-editor-drawer";
import { FieldLedger } from "../objects/field-ledger";
import { ObjectPreview, type PreviewRole } from "../objects/object-preview";
import {
  DATA_SCOPE_LABELS,
  TITLE_FIELD_TYPES,
  type PublishedDataScope,
} from "../objects/object-types";
import {
  addField,
  buildFieldEditorPatch,
  isTemplateObjectCode,
  reorderFields,
  setDefaultView,
  setEmployeeAccess,
  setFieldStatus,
  TEMPLATE_OBJECT_CODE_MESSAGE,
  updateField,
  updateObject,
  type TemplateDraft,
} from "./template-draft";

import styles from "./templates.module.css";

export interface TemplateObjectEditorProps {
  draft: TemplateDraft;
  objectId: string;
  onChange: (draft: TemplateDraft) => void;
}

export function TemplateObjectEditor({
  draft,
  objectId,
  onChange,
}: TemplateObjectEditorProps) {
  const object = draft.objects.find((item) => item.object.id === objectId);
  const [editingFieldId, setEditingFieldId] = useState<string>();
  const [previewRole, setPreviewRole] = useState<PreviewRole>("TENANT_ADMIN");
  const editingField =
    object?.fields.find((field) => field.id === editingFieldId) ?? null;

  const titleCandidates = useMemo(
    () =>
      object?.fields.filter(
        (field) =>
          field.status === "ACTIVE" &&
          field.required &&
          TITLE_FIELD_TYPES.includes(
            field.type as (typeof TITLE_FIELD_TYPES)[number],
          ),
      ) ?? [],
    [object],
  );

  if (!object) return null;
  const objectCodeInvalid = !isTemplateObjectCode(object.object.code);

  function moveField(fieldId: string, direction: -1 | 1) {
    const fieldIds = object!.fields.map((field) => field.id);
    const from = fieldIds.indexOf(fieldId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= fieldIds.length) return;
    [fieldIds[from], fieldIds[to]] = [fieldIds[to]!, fieldIds[from]!];
    onChange(reorderFields(draft, objectId, fieldIds));
  }

  function createField() {
    const next = addField(draft, objectId);
    const nextObject = next.objects.find((item) => item.object.id === objectId);
    const created = nextObject?.fields.at(-1);
    onChange(next);
    setEditingFieldId(created?.id);
  }

  function saveField(values: FieldDraftValues) {
    if (!editingField) return;
    onChange(
      updateField(
        draft,
        objectId,
        editingField.id,
        buildFieldEditorPatch(editingField, values),
      ),
    );
    setEditingFieldId(undefined);
  }

  const defaultView = object.defaultView ?? {
    name: "默认列表",
    columnFieldKeys: [],
    sort: { field: "updatedAt" as const, direction: "desc" as const },
  };
  const permissions = object.employeeAccess ?? {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false as const,
    readScope: "ALL" as const,
    updateScope: "OWN" as const,
  };

  const patchPermissions = (patch: Partial<typeof permissions>) =>
    onChange(
      setEmployeeAccess(draft, objectId, {
        ...permissions,
        ...patch,
        canDelete: false,
      }),
    );

  return (
    <div className={styles.objectEditor}>
      <section
        className={styles.editorSection}
        aria-labelledby="template-object-basics"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="template-object-basics">基本设置</h2>
            <p>名称可以调整；发布身份锁定后，对象代码保持不变。</p>
          </div>
        </div>
        <Form
          component={false}
          layout="vertical"
          className={styles.compactForm}
        >
          <div className={styles.formGrid}>
            <Form.Item label="对象名称" htmlFor={`object-name-${objectId}`}>
              <Input
                id={`object-name-${objectId}`}
                value={object.object.name}
                onChange={(event) =>
                  onChange(
                    updateObject(draft, objectId, { name: event.target.value }),
                  )
                }
              />
            </Form.Item>
            <Form.Item
              label="对象代码"
              htmlFor={`object-code-${objectId}`}
              validateStatus={objectCodeInvalid ? "error" : undefined}
              help={
                objectCodeInvalid ? TEMPLATE_OBJECT_CODE_MESSAGE : undefined
              }
              extra={
                object.object.publishedCode
                  ? "该代码已进入发布版本，不能修改。"
                  : "必须以小写字母开头；仅使用小写字母、数字和单个连字符；首次发布后锁定。"
              }
            >
              <Input
                id={`object-code-${objectId}`}
                className={styles.code}
                value={object.object.code}
                disabled={object.object.publishedCode !== null}
                onChange={(event) =>
                  onChange(
                    updateObject(draft, objectId, { code: event.target.value }),
                  )
                }
              />
            </Form.Item>
          </div>
          <Form.Item
            label="对象说明"
            htmlFor={`object-description-${objectId}`}
          >
            <Input.TextArea
              id={`object-description-${objectId}`}
              rows={2}
              value={object.object.description ?? ""}
              onChange={(event) =>
                onChange(
                  updateObject(draft, objectId, {
                    description: event.target.value || null,
                  }),
                )
              }
            />
          </Form.Item>
          <div className={styles.formGrid}>
            <Form.Item
              label="标题字段"
              htmlFor={`object-title-field-${objectId}`}
              extra="标题字段用于记录列表和引用位置，必须启用且必填。"
            >
              <Select
                id={`object-title-field-${objectId}`}
                value={object.object.titleFieldKey || undefined}
                placeholder="先新增一个可作为标题的必填字段"
                options={titleCandidates.map((field) => ({
                  value: field.fieldKey,
                  label: `${field.label}（${field.fieldKey}）`,
                }))}
                onChange={(titleFieldKey) =>
                  onChange(updateObject(draft, objectId, { titleFieldKey }))
                }
              />
            </Form.Item>
            <Form.Item label="对象状态" htmlFor={`object-status-${objectId}`}>
              <Select
                id={`object-status-${objectId}`}
                value={object.object.status}
                options={[
                  { value: "ACTIVE", label: "启用" },
                  { value: "INACTIVE", label: "停用" },
                ]}
                onChange={(status: "ACTIVE" | "INACTIVE") =>
                  onChange(updateObject(draft, objectId, { status }))
                }
              />
            </Form.Item>
          </div>
        </Form>
      </section>

      <section
        className={styles.editorSection}
        aria-labelledby="template-object-fields"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="template-object-fields">字段</h2>
            <p>字段顺序会进入模板版本；已发布字段的字段键和类型会锁定。</p>
          </div>
          <Button type="primary" ghost onClick={createField}>
            新增字段
          </Button>
        </div>
        {object.fields.length === 0 ? (
          <div className={styles.inlineEmpty}>
            <strong>还没有字段</strong>
            <span>新增第一个必填标题字段，再配置列表视图和员工权限。</span>
            <Button onClick={createField}>新增第一个字段</Button>
          </div>
        ) : (
          <FieldLedger
            fields={object.fields}
            titleFieldKey={object.object.titleFieldKey}
            onMove={moveField}
            onSelect={(field) => setEditingFieldId(field.id)}
            onToggleStatus={(field) =>
              onChange(
                setFieldStatus(
                  draft,
                  objectId,
                  field.id,
                  field.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                ),
              )
            }
          />
        )}
      </section>

      <section
        className={styles.editorSection}
        aria-labelledby="template-object-view"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="template-object-view">列表视图</h2>
            <p>确定公司管理员拿到草稿时的默认列与排序。</p>
          </div>
        </div>
        {object.fields.length === 0 ? (
          <div className={styles.inlineEmpty}>
            <strong>列表视图等待字段</strong>
            <span>先新增字段，才能选择默认展示列。</span>
          </div>
        ) : (
          <Form
            component={false}
            layout="vertical"
            className={styles.compactForm}
          >
            <div className={styles.formGrid}>
              <Form.Item label="视图名称" htmlFor={`view-name-${objectId}`}>
                <Input
                  id={`view-name-${objectId}`}
                  value={defaultView.name}
                  onChange={(event) =>
                    onChange(
                      setDefaultView(draft, objectId, {
                        ...defaultView,
                        name: event.target.value,
                      }),
                    )
                  }
                />
              </Form.Item>
              <Form.Item
                label="默认展示列"
                htmlFor={`view-columns-${objectId}`}
              >
                <Select
                  id={`view-columns-${objectId}`}
                  mode="multiple"
                  value={defaultView.columnFieldKeys}
                  options={object.fields
                    .filter((field) => field.status === "ACTIVE")
                    .map((field) => ({
                      value: field.fieldKey,
                      label: field.label,
                    }))}
                  onChange={(columnFieldKeys: string[]) =>
                    onChange(
                      setDefaultView(draft, objectId, {
                        ...defaultView,
                        columnFieldKeys,
                      }),
                    )
                  }
                />
              </Form.Item>
            </div>
            <div className={styles.formGrid}>
              <Form.Item
                label="排序字段"
                htmlFor={`view-sort-field-${objectId}`}
              >
                <Select
                  id={`view-sort-field-${objectId}`}
                  value={defaultView.sort.field}
                  options={[
                    { value: "updatedAt", label: "更新时间" },
                    { value: "createdAt", label: "创建时间" },
                    { value: "recordNo", label: "记录编号" },
                  ]}
                  onChange={(field) =>
                    onChange(
                      setDefaultView(draft, objectId, {
                        ...defaultView,
                        sort: { ...defaultView.sort, field },
                      }),
                    )
                  }
                />
              </Form.Item>
              <Form.Item
                label="排序方向"
                htmlFor={`view-sort-direction-${objectId}`}
              >
                <Select
                  id={`view-sort-direction-${objectId}`}
                  value={defaultView.sort.direction}
                  options={[
                    { value: "desc", label: "从新到旧" },
                    { value: "asc", label: "从旧到新" },
                  ]}
                  onChange={(direction) =>
                    onChange(
                      setDefaultView(draft, objectId, {
                        ...defaultView,
                        sort: { ...defaultView.sort, direction },
                      }),
                    )
                  }
                />
              </Form.Item>
            </div>
          </Form>
        )}
      </section>

      <section
        className={styles.editorSection}
        aria-labelledby="template-object-permissions"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="template-object-permissions">员工权限</h2>
            <p>设置模板落地后的初始动作、数据范围和逐字段访问级别。</p>
          </div>
        </div>
        <div className={styles.permissionGrid}>
          <Space orientation="vertical" size={14}>
            <SwitchRow
              label="允许新建记录"
              checked={permissions.canCreate}
              onChange={(canCreate) => patchPermissions({ canCreate })}
            />
            <SwitchRow
              label="允许读取记录"
              checked={permissions.canRead}
              onChange={(canRead) => patchPermissions({ canRead })}
            />
            <SwitchRow
              label="允许更新记录"
              checked={permissions.canUpdate}
              onChange={(canUpdate) => patchPermissions({ canUpdate })}
            />
            <Typography.Text type="secondary">
              删除权限固定关闭；公司管理员可在对象草稿中继续调整。
            </Typography.Text>
          </Space>
          <Form component={false} layout="vertical">
            <Form.Item label="读取范围" htmlFor={`read-scope-${objectId}`}>
              <ScopeSelect
                id={`read-scope-${objectId}`}
                value={permissions.readScope}
                onChange={(readScope) => patchPermissions({ readScope })}
              />
            </Form.Item>
            <Form.Item label="更新范围" htmlFor={`update-scope-${objectId}`}>
              <ScopeSelect
                id={`update-scope-${objectId}`}
                value={permissions.updateScope}
                onChange={(updateScope) => patchPermissions({ updateScope })}
              />
            </Form.Item>
          </Form>
        </div>
        <ObjectPreview
          draft={object}
          role={previewRole}
          onRoleChange={setPreviewRole}
        />
      </section>

      <FieldEditorDrawer
        field={editingField}
        onClose={() => setEditingFieldId(undefined)}
        onSubmit={saveField}
      />
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Space>
      <Switch aria-label={label} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </Space>
  );
}

function ScopeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: PublishedDataScope;
  onChange: (value: PublishedDataScope) => void;
}) {
  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      options={(Object.keys(DATA_SCOPE_LABELS) as PublishedDataScope[]).map(
        (scope) => ({ value: scope, label: DATA_SCOPE_LABELS[scope] }),
      )}
    />
  );
}
