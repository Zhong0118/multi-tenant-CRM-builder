"use client";

import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Drawer, Popconfirm, Space, Typography } from "antd";
import { useState } from "react";

import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import type { DynamicFieldMember } from "./dynamic-field";
import { displayValue } from "./record-list";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";
import { RecordForm } from "./record-form";

import styles from "./records.module.css";

export interface RecordDetailDrawerProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  record: RecordSummary;
  members?: DynamicFieldMember[];
  canChooseOwner?: boolean;
  canDelete?: boolean;
  initialEditing?: boolean;
  api?: RecordApi;
  onClose: () => void;
  onChanged: (record: RecordSummary | null) => void;
}

/**
 * A record opened from the list. Reading is the default; editing is an explicit
 * step, so a member cannot change a value by accident while scanning. Soft
 * delete is administrator-only and states that the record stops being visible
 * rather than being destroyed.
 */
export function RecordDetailDrawer({
  tenantCode,
  schema,
  record,
  members = [],
  canChooseOwner = false,
  canDelete = false,
  initialEditing = false,
  api = defaultRecordApi,
  onClose,
  onChanged,
}: RecordDetailDrawerProps) {
  const [editing, setEditing] = useState(initialEditing);
  const [error, setError] = useState<string>();

  const remove = useMutation({
    mutationFn: () =>
      api.remove(tenantCode, schema.object.code, record.id, record.version),
    onSuccess: () => {
      onChanged(null);
      onClose();
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  return (
    <Drawer
      open
      size={640}
      className={styles.detailDrawer}
      onClose={onClose}
      destroyOnHidden
      title={
        <div className={styles.detailTitle}>
          <span>{record.title}</span>
          <span className={styles.recordNo}>#{record.recordNo}</span>
        </div>
      }
      extra={
        <Space>
          {schema.actions.canUpdate && !editing ? (
            <Button onClick={() => setEditing(true)}>编辑</Button>
          ) : null}
          {canDelete ? (
            <Popconfirm
              title="确认删除该记录？"
              description="删除后成员不再看到这条记录，历史数据仍会保留。"
              okText="删除记录"
              onConfirm={() => remove.mutate()}
            >
              <Button danger loading={remove.isPending}>
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      }
    >
      {error ? <Alert type="error" showIcon title={error} /> : null}

      {editing ? (
        <RecordForm
          tenantCode={tenantCode}
          schema={schema}
          record={record}
          members={members}
          canChooseOwner={canChooseOwner}
          api={api}
          onSaved={(saved) => {
            setEditing(false);
            onChanged(saved);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <dl className={styles.detailFields}>
            {schema.fields.map((field) => (
              <div key={field.id} className={styles.detailField}>
                <dt>
                  {field.label}
                  {field.access === "READ_ONLY" ? (
                    <span className={styles.detailLock}>仅管理员可编辑</span>
                  ) : null}
                </dt>
                <dd>
                  {displayValue(field, record.values[field.fieldKey], members)}
                </dd>
              </div>
            ))}
          </dl>

          <div className={styles.detailMeta}>
            <Typography.Text type="secondary">
              负责人：
              {members.find((member) => member.id === record.ownerMemberId)
                ?.displayName ?? "未指定"}
            </Typography.Text>
            <Typography.Text type="secondary">
              版本 v{record.version}
            </Typography.Text>
          </div>
        </>
      )}
    </Drawer>
  );
}
