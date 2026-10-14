"use client";

import { Alert, Typography } from "antd";

import {
  DATA_SCOPE_LABELS,
  FIELD_ACCESS_LABELS,
  type ObjectDraft,
} from "./object-types";
import styles from "./objects.module.css";

export function EmployeePermissionComparison({
  draft,
}: {
  draft: ObjectDraft;
}) {
  const published = draft.publishedEmployeeAccess;
  const saved = draft.employeeAccess;
  const scopeLabel = (
    allowed: boolean,
    scope: keyof typeof DATA_SCOPE_LABELS,
    action: string,
  ) =>
    allowed && scope !== "NONE" ? DATA_SCOPE_LABELS[scope] : `禁止${action}`;
  const rows = [
    {
      key: "create",
      label: "新建记录",
      live: published?.canCreate ? "允许新建" : "禁止新建",
      saved: saved?.canCreate ? "允许新建" : "禁止新建",
    },
    {
      key: "read",
      label: "查看记录",
      live: scopeLabel(
        published?.canRead ?? false,
        published?.readScope ?? "NONE",
        "查看",
      ),
      saved: scopeLabel(
        saved?.canRead ?? false,
        saved?.readScope ?? "NONE",
        "查看",
      ),
    },
    {
      key: "update",
      label: "修改记录",
      live: scopeLabel(
        published?.canUpdate ?? false,
        published?.updateScope ?? "NONE",
        "修改",
      ),
      saved: scopeLabel(
        saved?.canUpdate ?? false,
        saved?.updateScope ?? "NONE",
        "修改",
      ),
    },
  ];
  const liveFields = published?.fields ?? [];
  const savedFields = draft.fields.filter((field) => field.status === "ACTIVE");
  const keys = new Set([
    ...liveFields.map((field) => field.fieldKey),
    ...savedFields.map((field) => field.fieldKey),
  ]);
  for (const key of keys) {
    const liveField = liveFields.find((field) => field.fieldKey === key);
    const savedField = savedFields.find((field) => field.fieldKey === key);
    rows.push({
      key: `field:${key}`,
      label: `字段：${savedField?.label ?? liveField?.label ?? key}`,
      live: liveField ? FIELD_ACCESS_LABELS[liveField.access] : "未发布此字段",
      saved: savedField
        ? FIELD_ACCESS_LABELS[savedField.employeeAccess]
        : "字段已停用",
    });
  }
  const pending = !published || rows.some((row) => row.live !== row.saved);
  const archived = draft.object.status === "ARCHIVED";

  return (
    <>
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
      <div className={styles.permissionComparison}>
        <table aria-label="员工默认权限对照">
          <thead>
            <tr>
              <th scope="col">权限项</th>
              <th scope="col">
                {published
                  ? `${archived ? "归档前发布" : "当前生效"} · v${draft.object.publicationNumber}`
                  : "当前：尚未发布"}
              </th>
              <th scope="col">已保存草稿</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                data-changed={!published || row.live !== row.saved}
              >
                <th scope="row">{row.label}</th>
                <td>{published ? row.live : "—"}</td>
                <td>
                  {row.saved}
                  {published && row.live !== row.saved ? (
                    <span className={styles.permissionChange}>待发布</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Typography.Paragraph type="secondary">
        字段权限还受上方的新建、查看、修改权限限制。仅本人负责指记录的负责人是该员工，未分配负责人或分配给他人的记录不在此范围。
      </Typography.Paragraph>
    </>
  );
}
