"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Modal, Space, Typography } from "antd";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";
import { StatusTag } from "@/components/workbench/status-tag";
import {
  workflowApi as defaultWorkflowApi,
  type WorkflowApi,
} from "@/features/objects/workflow-api";
import type { RuntimeAvailableTransition } from "@/features/objects/workflow-types";

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
  /**
   * §31: the Transition awaiting confirmation. It is the transition the employee
   * actually saw, so the modal keeps rendering that static summary even if the
   * runtime query refetches behind it.
   */
  const [confirming, setConfirming] =
    useState<RuntimeAvailableTransition | null>(null);
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
  /**
   * §32: why the failing step failed, which the message alone cannot say — it
   * only names the step and the rollback. Only the messages are rendered: the
   * keys are API paths of the form `actions.<actionKey>.<fieldKey>`, so showing
   * them would disclose an Action's internal key. Duplicates are collapsed
   * because several mappings can fail for the same reason.
   */
  const failureReasons = executeError
    ? [...new Set(Object.values(executeError.fieldErrors).flat())]
    : [];

  /**
   * §31: a Transition that will run Actions is confirmed first; one that runs
   * none keeps today's single click. The confirmation is static — it repeats the
   * server's effect labels and states what will be attempted, never what will
   * succeed, because the final decision belongs to the Execute API.
   */
  function requestTransition(transition: RuntimeAvailableTransition) {
    if (transition.effects.length === 0) {
      execute.mutate(transition.key);
      return;
    }
    setConfirming(transition);
  }

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
              onClick={() => requestTransition(transition)}
            >
              {transition.label}
            </Button>
          ))}
        </Space>
      ) : null}

      <Modal
        title={confirming ? `执行“${confirming.label}”后将：` : undefined}
        open={confirming !== null}
        okText="确认执行"
        cancelText="取消"
        onCancel={() => setConfirming(null)}
        onOk={() => {
          const transitionKey = confirming?.key;
          setConfirming(null);
          if (transitionKey) execute.mutate(transitionKey);
        }}
      >
        <ul>
          {confirming?.effects.map((effect, index) => (
            <li key={`${effect.type}-${index}`}>{effect.label}</li>
          ))}
        </ul>
        <p>所有操作将同时成功或全部取消。</p>
      </Modal>

      {executeError ? (
        <Alert
          type="error"
          showIcon
          title={
            executeError.code === "RECORD_VERSION_CONFLICT"
              ? "记录已被其他人更新，请刷新后再操作。"
              : executeError.message
          }
          description={
            failureReasons.length > 0 ? (
              <ul>
                {failureReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : undefined
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
