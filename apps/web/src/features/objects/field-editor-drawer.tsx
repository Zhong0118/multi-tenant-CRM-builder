"use client";

import { Button, Drawer, Space, Typography } from "antd";
import { useState } from "react";

import { StatusTag } from "@/components/workbench/status-tag";

import {
  FieldEditorSections,
  selectOptionsProblem,
  initialValues,
  type FieldDraftValues,
} from "./field-editor-form";
import type { ConfigurableFieldView } from "./configuration-view";

import styles from "./objects.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

export type { FieldDraftValues } from "./field-editor-form";

export interface FieldEditorDrawerProps {
  field: ConfigurableFieldView | null;
  saving?: boolean;
  readOnly?: boolean;
  objectContext?: { name: string; saveEffect: string };
  error?: string;
  onSubmit: (values: FieldDraftValues) => void;
  onClose: () => void;
}

/**
 * Field configuration in four sections that mirror how a field is actually
 * decided: how it displays, what it stores, how it is validated, and what an
 * employee may do with it. A published field key and type are stable
 * identifiers, so they are shown but not editable.
 *
 * Selecting a different field remounts the editor, so the form always starts
 * from that field's saved configuration.
 */
export function FieldEditorDrawer(props: FieldEditorDrawerProps) {
  if (!props.field) return null;
  return <FieldEditor key={props.field.id} {...props} field={props.field} />;
}

function FieldEditor({
  field,
  saving = false,
  readOnly = false,
  objectContext,
  error,
  onSubmit,
  onClose,
}: FieldEditorDrawerProps & { field: ConfigurableFieldView }) {
  const [values, setValues] = useState<FieldDraftValues>(() =>
    initialValues(field),
  );

  const patch = (next: Partial<FieldDraftValues>) => {
    if (!readOnly) setValues({ ...values, ...next });
  };

  return (
    <Drawer
      open
      size={OVERLAY_SIZE.drawer}
      className={styles.fieldDrawer}
      title={
        <div className={styles.drawerTitle}>
          <span>
            {objectContext
              ? `${objectContext.name} / 字段配置`
              : "FIELD CONFIGURATION"}
          </span>
          <div>
            <strong>{field.label}</strong>
            <StatusTag tone={field.status === "ACTIVE" ? "success" : "neutral"}>
              {field.status === "ACTIVE" ? "启用中" : "已停用"}
            </StatusTag>
          </div>
          <small>决定字段如何录入、校验，以及员工是否能看到或修改。</small>
        </div>
      }
      onClose={onClose}
      destroyOnHidden
      footer={
        <div className={styles.fieldDrawerFooter}>
          <span>
            {objectContext?.saveEffect ?? "保存后仍需保存对象或模板草稿。"}
          </span>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              loading={saving}
              disabled={readOnly || Boolean(selectOptionsProblem(values))}
              onClick={() => {
                if (!readOnly) onSubmit(values);
              }}
            >
              保存字段
            </Button>
          </Space>
        </div>
      }
    >
      {error ? (
        <Typography.Paragraph type="danger">{error}</Typography.Paragraph>
      ) : null}

      <FieldEditorSections
        field={field}
        values={values}
        patch={patch}
        readOnly={readOnly}
        numbered
      />
    </Drawer>
  );
}
