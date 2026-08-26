"use client";

import { Button, Segmented, Typography } from "antd";

import { DATA_SCOPE_LABELS, fieldTypeLabel } from "./object-types";
import type { ConfigurableObjectView } from "./configuration-view";

import styles from "./objects.module.css";

export type PreviewRole = "TENANT_ADMIN" | "EMPLOYEE";

export interface ObjectPreviewProps {
  draft: ConfigurableObjectView;
  role: PreviewRole;
  onRoleChange: (role: PreviewRole) => void;
}

/**
 * Shows the configuration as each role will really experience it, laid out like
 * the record form itself: a hidden field is absent rather than greyed out, a
 * read-only field is plain text with its reason, an employee without create
 * access gets no create action, and an OWN scope reads "my …".
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
        <span className={styles.previewTitle}>
          {readScope === "OWN" ? `我的${draft.object.name}` : draft.object.name}
        </span>
        <span className={styles.previewScope}>
          {DATA_SCOPE_LABELS[readScope]}
        </span>
      </div>

      <div className={styles.previewToolbar}>
        <Segmented
          aria-label="预览角色"
          size="small"
          value={role}
          onChange={(next) => onRoleChange(next as PreviewRole)}
          options={[
            { label: "管理员视角", value: "TENANT_ADMIN" },
            { label: "员工视角", value: "EMPLOYEE" },
          ]}
        />
        {canCreate ? (
          <Button type="primary" size="small">
            新建记录
          </Button>
        ) : null}
      </div>

      {visibleFields.length === 0 ? (
        <Typography.Paragraph type="secondary">
          当前角色看不到任何字段。
        </Typography.Paragraph>
      ) : (
        <div className={styles.previewFields}>
          {visibleFields.map((field) => {
            const readOnly = asEmployee && field.employeeAccess === "READ_ONLY";
            return (
              <div key={field.id} className={styles.previewField}>
                <span className={styles.previewFieldLabel}>
                  {field.required ? (
                    <span className={styles.previewFieldRequired}>*</span>
                  ) : null}
                  {field.label}
                  {!asEmployee && field.employeeAccess !== "EDIT" ? (
                    <span className={styles.previewFieldReason}>
                      员工{field.employeeAccess === "HIDDEN" ? "隐藏" : "只读"}
                    </span>
                  ) : null}
                </span>
                {readOnly ? (
                  <span className={styles.previewFieldReadOnly}>
                    <span>—</span>
                    <span className={styles.previewFieldReason}>
                      仅管理员可编辑
                    </span>
                  </span>
                ) : (
                  <span className={styles.previewFieldControl}>
                    {fieldTypeLabel(field.type)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
