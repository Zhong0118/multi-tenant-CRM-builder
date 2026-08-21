"use client";

import { Button, Segmented, Tag, Typography } from "antd";

import {
  DATA_SCOPE_LABELS,
  FIELD_ACCESS_LABELS,
  fieldTypeLabel,
  type ObjectDraft,
  type PublishedFieldAccess,
} from "./object-types";

import styles from "./objects.module.css";

export type PreviewRole = "TENANT_ADMIN" | "EMPLOYEE";

export interface ObjectPreviewProps {
  draft: ObjectDraft;
  role: PreviewRole;
  onRoleChange: (role: PreviewRole) => void;
}

/**
 * Shows the configuration as each role will really experience it: a hidden
 * field is absent rather than greyed out, an employee without create access
 * gets no create action, and an OWN scope renders the "my records" title the
 * employee will actually see.
 */
export function ObjectPreview({
  draft,
  role,
  onRoleChange,
}: ObjectPreviewProps) {
  const asEmployee = role === "EMPLOYEE";
  const access = draft.employeeAccess;
  const canCreate = asEmployee ? (access?.canCreate ?? false) : true;
  const readScope = asEmployee ? (access?.readScope ?? "NONE") : "ALL";
  const visibleFields = draft.fields.filter(
    (field) =>
      field.status === "ACTIVE" &&
      (!asEmployee || field.employeeAccess !== "HIDDEN"),
  );

  return (
    <section role="region" aria-label="权限预览" className={styles.preview}>
      <div className={styles.previewHeader}>
        <div>
          <span className={styles.previewTitle}>
            {readScope === "OWN"
              ? `我的${draft.object.name}`
              : draft.object.name}
          </span>
          <Typography.Text type="secondary"> · </Typography.Text>
          <Typography.Text type="secondary">
            {DATA_SCOPE_LABELS[readScope]}
          </Typography.Text>
        </div>
        <div>{canCreate ? <Button type="primary">新建记录</Button> : null}</div>
      </div>

      <Segmented
        aria-label="预览角色"
        value={role}
        onChange={(next) => onRoleChange(next as PreviewRole)}
        options={[
          { label: "管理员视角", value: "TENANT_ADMIN" },
          { label: "员工视角", value: "EMPLOYEE" },
        ]}
      />

      <div className={styles.previewFields} style={{ marginTop: 12 }}>
        {visibleFields.length === 0 ? (
          <Typography.Text type="secondary">
            当前角色看不到任何字段。
          </Typography.Text>
        ) : (
          visibleFields.map((field) => (
            <div key={field.id} className={styles.previewField}>
              <strong>{field.label}</strong>
              <span className={styles.stableKey}>{field.fieldKey}</span>
              <Typography.Text type="secondary">
                {fieldTypeLabel(field.type)}
              </Typography.Text>
              {field.required ? <Tag>必填</Tag> : null}
              {asEmployee && field.employeeAccess === "READ_ONLY" ? (
                <Tag>{FIELD_ACCESS_LABELS.READ_ONLY}</Tag>
              ) : null}
              {!asEmployee && field.employeeAccess !== "EDIT" ? (
                <Tag>
                  员工
                  {
                    FIELD_ACCESS_LABELS[
                      field.employeeAccess as PublishedFieldAccess
                    ]
                  }
                </Tag>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
