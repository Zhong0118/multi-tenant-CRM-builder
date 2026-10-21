"use client";

import { Alert, Button, Space } from "antd";
import { useEffect, useState } from "react";

import {
  FieldEditorSections,
  initialValues,
  type FieldDraftValues,
} from "./field-editor-form";
import { FieldTypeBadge } from "./field-list";
import { fieldTypeLabel } from "./object-types";
import type { ConfigurableFieldView } from "./configuration-view";

import styles from "./objects.module.css";

export interface FieldEditorPanelProps {
  field: ConfigurableFieldView;
  titleFieldKey: string;
  saving?: boolean;
  /** What saving does, stated where the button is. */
  saveEffect: string;
  /** Confirmation of the last save, shown until the next change. */
  savedNote?: string;
  error?: string;
  onSubmit: (values: FieldDraftValues) => void;
  /** Reports whether there are edits that have not been saved. */
  onDirtyChange?: (dirty: boolean) => void;
}

function sameValues(left: FieldDraftValues, right: FieldDraftValues): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Field configuration beside the field list. The caller keys it by field (and
 * by each successful save), so it starts from that field's saved configuration
 * and keeps the member's edits through unrelated draft changes such as a
 * reorder.
 */
export function FieldEditorPanel({
  field,
  titleFieldKey,
  saving = false,
  saveEffect,
  savedNote,
  error,
  onSubmit,
  onDirtyChange,
}: FieldEditorPanelProps) {
  const [values, setValues] = useState<FieldDraftValues>(() =>
    initialValues(field),
  );
  const dirty = !sameValues(values, initialValues(field));

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  return (
    <section className={styles.fieldPanel} aria-label={`配置字段：${field.label}`}>
      <header className={styles.fieldPanelHeader}>
        <FieldTypeBadge type={field.type} />
        <div className={styles.fieldPanelTitle}>
          <h2>{field.label}</h2>
          <p>
            <span className={styles.stableKey}>{field.fieldKey}</span>
            {" · "}
            {fieldTypeLabel(field.type)}
            {field.fieldKey === titleFieldKey ? " · 记录名称" : ""}
            {field.status === "INACTIVE" ? " · 已停用" : ""}
            {field.publishedType === null ? " · 尚未发布" : ""}
          </p>
        </div>
      </header>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      <FieldEditorSections
        field={field}
        values={values}
        patch={(next) => setValues((current) => ({ ...current, ...next }))}
      />

      <footer className={styles.fieldPanelFooter}>
        <div className={styles.fieldPanelNote}>
          {dirty ? (
            <strong className={styles.fieldPanelDirty}>有未保存的修改</strong>
          ) : savedNote ? (
            <strong className={styles.fieldPanelSaved}>{savedNote}</strong>
          ) : null}
          <span>{saveEffect}</span>
        </div>
        <Space>
          <Button
            disabled={!dirty || saving}
            onClick={() => setValues(initialValues(field))}
          >
            还原
          </Button>
          <Button
            type="primary"
            disabled={!dirty}
            loading={saving}
            onClick={() => onSubmit(values)}
          >
            保存字段
          </Button>
        </Space>
      </footer>
    </section>
  );
}
