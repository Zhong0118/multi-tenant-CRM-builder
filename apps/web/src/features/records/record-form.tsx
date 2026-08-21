"use client";

import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Select, Space } from "antd";
import { useState } from "react";

import type {
  PublishedFieldView,
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import { DynamicField, type DynamicFieldMember } from "./dynamic-field";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";

import styles from "./records.module.css";

export interface RecordFormProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  record?: RecordSummary;
  members?: DynamicFieldMember[];
  canChooseOwner?: boolean;
  api?: RecordApi;
  onSaved: (record: RecordSummary) => void;
  onCancel?: () => void;
}

/**
 * Builds a record from the published schema. Only `EDIT` fields ever reach the
 * payload — a read-only or hidden value is never sent, so the form cannot ask
 * the API to reject something the member could not have changed.
 *
 * A failed save keeps every entered value. A version conflict is surfaced with
 * an explicit reload rather than overwriting whoever saved first.
 */
export function RecordForm({
  tenantCode,
  schema,
  record,
  members = [],
  canChooseOwner = false,
  api = defaultRecordApi,
  onSaved,
  onCancel,
}: RecordFormProps) {
  const editable = schema.fields.filter((field) => field.access === "EDIT");
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValues(schema, record),
  );
  const [owner, setOwner] = useState<string | undefined>(
    record?.ownerMemberId ?? undefined,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string>();
  const [conflicted, setConflicted] = useState(false);

  const mode = record ? "UPDATE" : "CREATE";
  const objectCode = schema.object.code;

  const save = useMutation({
    mutationFn: () =>
      record
        ? api.update(tenantCode, objectCode, record.id, {
            version: record.version,
            values: payload(editable, values),
            ...(canChooseOwner ? { ownerMemberId: owner ?? null } : {}),
          })
        : api.create(tenantCode, objectCode, {
            values: payload(editable, values),
            ...(canChooseOwner && owner ? { ownerMemberId: owner } : {}),
          }),
    onSuccess: (saved) => {
      setSummary(undefined);
      setConflicted(false);
      onSaved(saved);
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setSummary(`${apiError.message}（请求编号：${apiError.requestId}）`);
      setConflicted(
        apiError.code === "RECORD_VERSION_CONFLICT" || apiError.status === 409,
      );
      setFieldErrors(
        Object.fromEntries(
          Object.entries(apiError.fieldErrors).map(([key, messages]) => [
            key,
            messages.join("；"),
          ]),
        ),
      );
    },
  });

  function submit() {
    const missing = editable.filter(
      (field) => field.required && isEmpty(values[field.fieldKey]),
    );
    if (missing.length > 0) {
      setFieldErrors(
        Object.fromEntries(
          missing.map((field) => [field.fieldKey, `请填写${field.label}。`]),
        ),
      );
      setSummary("请补全标记为错误的字段。");
      document.getElementById(`dynamic-field-${missing[0].fieldKey}`)?.focus();
      return;
    }
    setFieldErrors({});
    setSummary(undefined);
    save.mutate();
  }

  return (
    <div className={styles.form}>
      {summary ? (
        <Alert
          type="error"
          showIcon
          title={summary}
          action={
            conflicted ? (
              <Button size="small" onClick={() => window.location.reload()}>
                重新载入记录
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <Form component={false} layout="vertical">
        <div className={styles.formGrid}>
          {schema.fields.map((field) => (
            <DynamicField
              key={field.id}
              field={field}
              value={values[field.fieldKey] ?? null}
              members={members}
              error={fieldErrors[field.fieldKey]}
              onChange={(next) =>
                setValues((current) => ({ ...current, [field.fieldKey]: next }))
              }
            />
          ))}

          {canChooseOwner ? (
            <Form.Item
              label="负责人"
              htmlFor="record-owner"
              extra="不选择时记录暂不指定负责人。"
            >
              <Select
                id="record-owner"
                allowClear
                showSearch
                optionFilterProp="label"
                value={owner}
                onChange={(next?: string) => setOwner(next)}
                options={members.map((member) => ({
                  value: member.id,
                  label: member.displayName ?? "未设置姓名",
                }))}
              />
            </Form.Item>
          ) : null}
        </div>
      </Form>

      <Space>
        <Button type="primary" loading={save.isPending} onClick={submit}>
          {mode === "CREATE" ? "创建记录" : "保存修改"}
        </Button>
        {onCancel ? <Button onClick={onCancel}>取消</Button> : null}
      </Space>
    </div>
  );
}

function initialValues(
  schema: RuntimeObjectSchema,
  record?: RecordSummary,
): Record<string, unknown> {
  if (record) return { ...record.values };
  return Object.fromEntries(
    schema.fields
      .filter((field) => field.access === "EDIT" && field.defaultValue !== null)
      .map((field) => [field.fieldKey, field.defaultValue]),
  );
}

/**
 * An untouched optional field is omitted rather than sent as null: on update a
 * missing key means "leave as it was", while an explicit null clears the value.
 */
function payload(
  editable: PublishedFieldView[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    editable
      .filter((field) => values[field.fieldKey] !== undefined)
      .map((field) => [field.fieldKey, values[field.fieldKey]]),
  );
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}
