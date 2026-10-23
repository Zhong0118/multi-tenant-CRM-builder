"use client";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Select } from "antd";
import { useState } from "react";
import { recordApi } from "@/features/records/record-api";
import {
  DynamicField,
  type DynamicFieldMember,
} from "@/features/records/dynamic-field";
import { toApiError } from "@/lib/api/api-error";
import { automationApi } from "./automation-api";
import {
  editableAutomationField,
  automationValueLabel,
  type AutomationPreview,
  type AutomationRule,
  type AutomationTable,
  type AutomationValue,
} from "./automation-types";
import styles from "./automations.module.css";

export function automationError(error: unknown) {
  const parsed = toApiError(error);
  const details = Object.values(parsed.fieldErrors).flat();
  return details.length ? details.join("；") : parsed.message;
}
export function PreviewValues({
  preview,
  target,
}: {
  preview: AutomationPreview;
  target?: AutomationTable;
}) {
  return (
    <div aria-label="将创建的记录">
      <p>将在「{preview.targetObjectName}」创建以下内容</p>
      <dl className={styles.previewValues}>
        {Object.entries(preview.values).map(([key, value]) => (
          <div style={{ display: "contents" }} key={key}>
            <dt>
              {target?.fields.find((field) => field.fieldKey === key)?.label ??
                preview.fieldLabels?.[key] ??
                key}
            </dt>
            <dd>
              {automationValueLabel(
                value,
                target?.fields.find((field) => field.fieldKey === key),
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.caption}>此次仅预览，没有创建记录</p>
    </div>
  );
}
export function DraftAutomationPreview({
  tenantCode,
  objectId,
  sourceCode,
  published,
  rule,
  target,
  members = [],
}: {
  members?: DynamicFieldMember[];
  tenantCode: string;
  objectId: string;
  sourceCode: string;
  published: boolean;
  rule: AutomationRule;
  target?: AutomationTable;
}) {
  const [recordId, setRecordId] = useState<string>();
  const [search, setSearch] = useState("");
  const [inputs, setInputs] = useState<Record<string, AutomationValue>>({});
  const [result, setResult] = useState<{
    signature: string;
    value: AutomationPreview;
  }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const signature = JSON.stringify({ rule, recordId, inputs });
  const records = useQuery({
    queryKey: ["automation-samples", tenantCode, sourceCode, search],
    queryFn: () =>
      recordApi.list(tenantCode, sourceCode, { page: 1, limit: 20, search }),
    enabled: published,
  });
  async function run() {
    if (!recordId) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult({
        signature,
        value: await automationApi.previewDraft(
          tenantCode,
          objectId,
          rule,
          recordId,
          inputs,
        ),
      });
    } catch (error) {
      setError(automationError(error));
      setResult(undefined);
    } finally {
      setBusy(false);
    }
  }
  if (!published)
    return (
      <p className={styles.caption}>
        先发布来源业务表并添加一条样例记录，即可预览真实取值
      </p>
    );
  return (
    <div className={styles.panel}>
      <p className={styles.caption}>
        用一条已有记录检查取值，不会写入数据。这里使用管理员权限；员工实际执行时仍按其权限检查。
      </p>
      <Form layout="vertical">
        <Form.Item label="选择样例记录" htmlFor="automation-sample">
          <Select
            id="automation-sample"
            showSearch
            filterOption={false}
            onSearch={setSearch}
            loading={records.isFetching}
            value={recordId}
            onChange={setRecordId}
            placeholder="搜索记录名称"
            options={records.data?.items.map((record) => ({
              value: record.id,
              label: `${record.title} #${record.recordNo}`,
            }))}
          />
        </Form.Item>
        {target?.fields
          .filter((field) => rule.mappings[field.fieldKey]?.source === "INPUT")
          .map((field) => (
            <DynamicField
              key={field.fieldKey}
              members={members}
              field={editableAutomationField(field)}
              value={inputs[field.fieldKey] ?? field.defaultValue}
              onChange={(value) =>
                setInputs({
                  ...inputs,
                  [field.fieldKey]: value as AutomationValue,
                })
              }
            />
          ))}
      </Form>
      {records.isError && (
        <Alert
          type="error"
          title="样例记录加载失败"
          action={<Button onClick={() => void records.refetch()}>重试</Button>}
        />
      )}
      <Button
        disabled={!recordId || !target}
        loading={busy}
        onClick={() => void run()}
      >
        预览将创建的记录
      </Button>
      {error && <Alert type="error" showIcon title={error} />}
      {result?.signature === signature && (
        <PreviewValues preview={result.value} target={target} />
      )}
    </div>
  );
}
