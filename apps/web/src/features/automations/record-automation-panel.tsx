"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Modal, Space } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DynamicField,
  type DynamicFieldMember,
} from "@/features/records/dynamic-field";
import { automationApi, type AutomationApi } from "./automation-api";
import { automationError, PreviewValues } from "./automation-preview";
import {
  editableAutomationField,
  type AutomationExecution,
  type AutomationPreview,
  type AutomationValue,
  type RuntimeAutomation,
} from "./automation-types";
import styles from "./automations.module.css";

export interface RecordAutomationPanelProps {
  tenantCode: string;
  objectCode: string;
  recordId: string;
  recordVersion: number;
  members?: DynamicFieldMember[];
  api?: AutomationApi;
  onRecordChanged?: () => Promise<unknown>;
}
export function RecordAutomationPanel({
  tenantCode,
  objectCode,
  recordId,
  recordVersion,
  members = [],
  api = automationApi,
  onRecordChanged,
}: RecordAutomationPanelProps) {
  const client = useQueryClient();
  const queryKey = ["record-automations", tenantCode, objectCode, recordId];
  const previousVersion = useRef(recordVersion);
  useEffect(() => {
    if (previousVersion.current !== recordVersion) {
      previousVersion.current = recordVersion;
      void client.invalidateQueries({
        queryKey: ["relations", tenantCode, objectCode, recordId],
      });
    }
  }, [client, tenantCode, objectCode, recordId, recordVersion]);
  const available = useQuery({
    queryKey: [...queryKey, recordVersion],
    queryFn: () => api.runtime(tenantCode, objectCode, recordId),
  });
  const history = useQuery({
    queryKey: [...queryKey, "history", recordVersion],
    queryFn: () => api.history(tenantCode, objectCode, recordId),
  });
  const [selected, setSelected] = useState<RuntimeAutomation>();
  const [inputs, setInputs] = useState<Record<string, AutomationValue>>({});
  const [preview, setPreview] = useState<AutomationPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ requestId: string; version: number } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [completed, setCompleted] = useState<AutomationExecution>();
  const [refreshWarning, setRefreshWarning] = useState<string>();
  function choose(item: RuntimeAutomation) {
    setSelected(item);
    setInputs(
      Object.fromEntries(
        item.inputFields
          .filter((field) => field.defaultValue != null)
          .map((field) => [
            field.fieldKey,
            field.defaultValue as AutomationValue,
          ]),
      ),
    );
    setPreview(undefined);
    setError(undefined);
    attempt.current = null;
    setAttempted(false);
  }
  async function inspect() {
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(
        await api.preview(
          tenantCode,
          objectCode,
          recordId,
          selected.key,
          inputs,
        ),
      );
    } catch (error) {
      setPreview(undefined);
      setError(automationError(error));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function execute() {
    if (!selected || !preview || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    attempt.current ??= {
      requestId: crypto.randomUUID(),
      version: recordVersion,
    };
    setAttempted(true);
    try {
      const result = await api.execute(
        tenantCode,
        objectCode,
        recordId,
        selected.key,
        attempt.current.version,
        attempt.current.requestId,
        inputs,
      );
      setCompleted(result);
      setSelected(undefined);
      setRefreshWarning(undefined);
      void client.invalidateQueries({ queryKey });
      void client.invalidateQueries({ queryKey: ["relations", tenantCode] });
      void client.invalidateQueries({
        queryKey: ["workspace", tenantCode, "records"],
      });
      try {
        await onRecordChanged?.();
      } catch {
        setRefreshWarning(
          "已创建记录，但详情刷新失败，请刷新页面查看，无需重复执行",
        );
      }
    } catch (error) {
      setError(automationError(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (
    !available.data?.items.length &&
    !history.data?.items.length &&
    !completed &&
    !history.isError &&
    !available.isError
  )
    return null;
  return (
    <section className={styles.panel} aria-label="关联与自动化">
      <div className={styles.heading}>
        <h3>
          <LinkOutlined /> 关联与自动化
        </h3>
      </div>
      {available.isError && (
        <Alert
          type="error"
          title="跨表动作加载失败"
          action={
            <Button onClick={() => void available.refetch()}>重试</Button>
          }
        />
      )}
      <Space wrap>
        {available.data?.items.map((item) => (
          <Button key={item.key} onClick={() => choose(item)}>
            {item.label}
          </Button>
        ))}
      </Space>
      {completed && (
        <Alert
          type="success"
          title="已创建并关联记录"
          description={
            <Link
              href={`/workspace/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(completed.targetObjectCode)}/${encodeURIComponent(completed.targetRecordId)}`}
            >
              查看新记录 #{completed.targetRecordNo}
            </Link>
          }
        />
      )}
      {refreshWarning && <Alert type="warning" title={refreshWarning} />}
      {history.isError && (
        <Alert
          type="error"
          title="执行记录加载失败"
          action={<Button onClick={() => void history.refetch()}>重试</Button>}
        />
      )}
      {!!history.data?.items.length && (
        <details>
          <summary>执行记录（{history.data.items.length}）</summary>
          <ul className={styles.history}>
            {history.data.items.map((item) => (
              <li key={item.id}>
                <strong>{item.ruleLabel}</strong> · 已完成 ·{" "}
                <Link
                  href={`/workspace/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(item.targetObjectCode)}/${encodeURIComponent(item.targetRecordId)}`}
                >
                  记录 #{item.targetRecordNo}
                </Link>
                <time dateTime={item.executedAt}>
                  {new Date(item.executedAt).toLocaleString("zh-CN")}
                </time>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Modal
        title={selected?.label}
        open={!!selected}
        destroyOnHidden
        onCancel={() => {
          if (!busy) setSelected(undefined);
        }}
        mask={{ closable: !busy }}
        closable={!busy}
        keyboard={!busy}
        footer={
          <Space>
            <Button disabled={busy} onClick={() => setSelected(undefined)}>
              关闭
            </Button>
            {!attempted && (
              <Button
                aria-label="预览"
                disabled={busy}
                loading={busy && !preview}
                onClick={() => void inspect()}
              >
                预览
              </Button>
            )}
            {preview && (
              <Button
                type="primary"
                loading={busy}
                onClick={() => void execute()}
              >
                {attempted ? "重试本次操作" : "确认创建并关联"}
              </Button>
            )}
          </Space>
        }
      >
        <p className={styles.caption}>
          将在「{selected?.targetObjectName}」创建新记录，并与当前记录关联
        </p>
        <Form layout="vertical" disabled={busy || attempted}>
          {selected?.inputFields.map((field) => (
            <DynamicField
              key={field.fieldKey}
              field={editableAutomationField(field)}
              members={members}
              disabled={busy || attempted}
              value={inputs[field.fieldKey]}
              onChange={(value) => {
                setInputs({
                  ...inputs,
                  [field.fieldKey]: value as AutomationValue,
                });
                setPreview(undefined);
                setError(undefined);
              }}
            />
          ))}
        </Form>
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            description={
              attempted
                ? "可重试本次操作，系统会核对执行结果，避免重复创建"
                : undefined
            }
          />
        )}
        {preview && <PreviewValues preview={preview} />}
      </Modal>
    </section>
  );
}
