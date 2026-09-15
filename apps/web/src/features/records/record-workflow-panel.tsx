"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Space, Typography } from "antd";

import { toApiError } from "@/lib/api/api-error";
import { StatusTag } from "@/components/workbench/status-tag";
import {
  workflowApi as defaultWorkflowApi,
  type WorkflowApi,
} from "@/features/objects/workflow-api";
import type { RuntimeWorkflow } from "@/features/objects/workflow-types";

import styles from "./records.module.css";

export interface RecordWorkflowPanelProps {
  tenantCode: string;
  objectCode: string;
  recordId: string;
  recordVersion: number;
  onRecordChanged?: () => void;
  api?: WorkflowApi;
}

export function RecordWorkflowPanel({
  tenantCode,
  objectCode,
  recordId,
  recordVersion,
  onRecordChanged,
  api = defaultWorkflowApi,
}: RecordWorkflowPanelProps) {
  const queryClient = useQueryClient();
  const runtimeKey = [
    "workspace",
    tenantCode,
    "record-workflow",
    objectCode,
    recordId,
  ];
  const historyKey = [...runtimeKey, "history"];
  const runtime = useQuery({
    queryKey: runtimeKey,
    queryFn: () => api.getRuntime(tenantCode, objectCode, recordId),
  });
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => api.history(tenantCode, objectCode, recordId),
  });

  const execute = useMutation({
    mutationFn: (transitionKey: string) =>
      api.executeTransition(
        tenantCode,
        objectCode,
        recordId,
        transitionKey,
        runtime.data?.recordVersion ?? recordVersion,
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(runtimeKey, next);
      void queryClient.invalidateQueries({ queryKey: historyKey });
      onRecordChanged?.();
    },
  });

  if (runtime.isError) {
    const apiError = toApiError(runtime.error);
    if (apiError.code === "WORKFLOW_NOT_PUBLISHED") return null;
    return <Alert type="error" showIcon title={apiError.message} />;
  }
  if (runtime.isPending || !runtime.data) return null;

  const view = runtime.data;
  const executeError = execute.error ? toApiError(execute.error) : undefined;

  return (
    <section className={styles.detailMeta}>
      <Typography.Text strong>流程状态</Typography.Text>
      <div>
        {view.currentState ? (
          <StatusTag tone={view.currentState.isTerminal ? "success" : "warning"}>
            {view.currentState.label}
          </StatusTag>
        ) : (
          <Typography.Text type="secondary">未进入流程</Typography.Text>
        )}
      </div>

      {view.availableTransitions.length > 0 ? (
        <Space wrap>
          {view.availableTransitions.map((transition) => (
            <Button
              key={transition.key}
              loading={
                execute.isPending && execute.variables === transition.key
              }
              onClick={() => execute.mutate(transition.key)}
            >
              {transition.label}
            </Button>
          ))}
        </Space>
      ) : null}

      {executeError ? (
        <Alert
          type="error"
          showIcon
          title={
            executeError.code === "RECORD_VERSION_CONFLICT"
              ? "记录已被其他人更新，请刷新后再操作。"
              : executeError.message
          }
        />
      ) : null}

      <Typography.Text strong>流程历史</Typography.Text>
      {history.data?.items.length ? (
        <ol className={styles.detailFields}>
          {history.data.items.map((item) => (
            <li key={item.id} className={styles.detailField}>
              <dt>
                {item.actorDisplayName ?? "成员"} · {item.transitionLabel}
              </dt>
              <dd>
                {item.fromStateLabel ?? "未进入流程"} → {item.toStateLabel}
                <div>
                  <Typography.Text type="secondary">
                    {formatDateTime(item.createdAt)}
                  </Typography.Text>
                </div>
              </dd>
            </li>
          ))}
        </ol>
      ) : (
        <Empty description="还没有流程历史" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </section>
  );
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
