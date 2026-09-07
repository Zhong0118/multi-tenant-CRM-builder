"use client";

import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Drawer, Form, Select, Space, Typography } from "antd";
import { useMemo, useState } from "react";

import type {
  PublishedFieldView,
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import { DynamicField, type DynamicFieldMember } from "./dynamic-field";
import type { RecordApi, RecordBatchUpdateResult } from "./record-api";

import styles from "./records.module.css";

export interface RecordBatchEditDrawerProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  records: RecordSummary[];
  members?: DynamicFieldMember[];
  canChooseOwner?: boolean;
  api: RecordApi;
  onClose: () => void;
  onCompleted: (result: RecordBatchUpdateResult) => void;
}

export function RecordBatchEditDrawer({
  tenantCode,
  schema,
  records,
  members = [],
  canChooseOwner = false,
  api,
  onClose,
  onCompleted,
}: RecordBatchEditDrawerProps) {
  const editable = schema.fields.filter((field) => field.access === "EDIT");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [owner, setOwner] = useState<string | undefined>();
  const [changeOwner, setChangeOwner] = useState(false);
  const [summary, setSummary] = useState<string>();
  const [result, setResult] = useState<RecordBatchUpdateResult>();

  const selectedFields = useMemo(
    () =>
      editable.filter((field) => selectedKeys.includes(field.fieldKey)),
    [editable, selectedKeys],
  );

  const save = useMutation({
    mutationFn: () =>
      api.batchUpdate(tenantCode, schema.object.code, {
        items: records.map((record) => ({
          recordId: record.id,
          version: record.version,
        })),
        values: payload(selectedFields, values),
        ...(canChooseOwner && changeOwner
          ? { ownerMemberId: owner ?? null }
          : {}),
      }),
    onSuccess: (next) => {
      setResult(next);
      setSummary(undefined);
      if (next.failed === 0) onCompleted(next);
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setSummary(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  const canSubmit =
    selectedFields.length > 0 || (canChooseOwner && changeOwner);

  return (
    <Drawer
      open
      size={480}
      title={`批量修改 ${records.length} 条`}
      onClose={onClose}
      destroyOnHidden
    >
      {summary ? <Alert type="error" showIcon title={summary} /> : null}
      {result ? (
        <Alert
          type={result.failed === 0 ? "success" : "warning"}
          showIcon
          title={`成功 ${result.updated} 条，失败 ${result.failed} 条。失败行会保留原值。`}
        />
      ) : null}

      <Typography.Paragraph type="secondary">
        只改勾选的字段。未勾选的字段保持原值。版本冲突或无权的行会单独失败，不会整批回滚。
      </Typography.Paragraph>

      <Form component={false} layout="vertical">
        <div className={styles.columnChooser}>
          {editable.map((field) => {
            const selected = selectedKeys.includes(field.fieldKey);
            return (
              <label key={field.fieldKey} className={styles.columnChooserRow}>
                <input
                  type="checkbox"
                  aria-label={`批量修改 ${field.label}`}
                  checked={selected}
                  onChange={(event) =>
                    setSelectedKeys((current) =>
                      event.target.checked
                        ? [...current, field.fieldKey]
                        : current.filter((key) => key !== field.fieldKey),
                    )
                  }
                />
                <span>{field.label}</span>
              </label>
            );
          })}
        </div>

        <div className={styles.formGrid}>
          {selectedFields.map((field) => (
            <DynamicField
              key={field.id}
              field={field}
              value={values[field.fieldKey] ?? null}
              members={members}
              onChange={(next) =>
                setValues((current) => ({ ...current, [field.fieldKey]: next }))
              }
            />
          ))}
        </div>

        {canChooseOwner ? (
          <Form.Item>
            <label className={styles.columnChooserRow}>
              <input
                type="checkbox"
                aria-label="同时修改负责人"
                checked={changeOwner}
                onChange={(event) => setChangeOwner(event.target.checked)}
              />
              <span>同时修改负责人</span>
            </label>
            {changeOwner ? (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="不指定负责人"
                value={owner}
                onChange={(next?: string) => setOwner(next)}
                options={members.map((member) => ({
                  value: member.id,
                  label: member.displayName ?? "未设置姓名",
                }))}
              />
            ) : null}
          </Form.Item>
        ) : null}
      </Form>

      {result && result.failed > 0 ? (
        <ul className={styles.batchErrors}>
          {result.items
            .filter((item) => item.status === "FAILED")
            .map((item) => (
              <li key={item.recordId}>
                {records.find((record) => record.id === item.recordId)?.title ??
                  item.recordId}
                ：{item.error?.message ?? "修改失败"}
              </li>
            ))}
        </ul>
      ) : null}

      <Space>
        <Button
          type="primary"
          loading={save.isPending}
          disabled={!canSubmit}
          onClick={() => save.mutate()}
        >
          应用到选中记录
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </Space>
    </Drawer>
  );
}

function payload(
  fields: PublishedFieldView[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [field.fieldKey, values[field.fieldKey] ?? null]),
  );
}
