"use client";

import { Alert, Button, Drawer, Progress, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import type { RecordSummary } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import type { RecordApi } from "./record-api";
import styles from "./records.module.css";

export const MAX_DELETE_RECORDS = 1000;
type DeleteRow = {
  record: RecordSummary;
  status: "pending" | "success" | "error";
  error?: string;
};

export function RecordBatchDeleteDrawer({
  tenantCode,
  objectCode,
  records,
  api,
  onClose,
  onChanged,
}: {
  tenantCode: string;
  objectCode: string;
  records: RecordSummary[];
  api: Pick<RecordApi, "remove">;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<DeleteRow[]>(() =>
    records.map((record) => ({ record, status: "pending" })),
  );
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const running = useRef(false);
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);
  const succeeded = rows.filter((row) => row.status === "success").length;
  const failed = rows.filter((row) => row.status === "error").length;
  const exceedsLimit = rows.length > MAX_DELETE_RECORDS;

  async function refresh() {
    try {
      await onChanged();
      if (!stopped.current) setRefreshFailed(false);
    } catch {
      if (!stopped.current) setRefreshFailed(true);
    }
  }

  async function remove() {
    if (
      running.current ||
      exceedsLimit ||
      !rows.length ||
      succeeded === rows.length
    )
      return;
    running.current = true;
    setBusy(true);
    setStarted(true);
    const next = rows.map((row) => ({ ...row }));
    const pending = next.filter((row) => row.status !== "success");
    let cursor = 0;
    async function worker() {
      while (!stopped.current && cursor < pending.length) {
        const row = pending[cursor++];
        try {
          await api.remove(
            tenantCode,
            objectCode,
            row.record.id,
            row.record.version,
          );
          row.status = "success";
          row.error = undefined;
        } catch (caught) {
          const error = toApiError(caught);
          row.status = "error";
          row.error =
            error.status === 409
              ? "记录已变更，请关闭并刷新列表后重新选择"
              : error.status === 404
                ? "记录不存在或当前不可访问，请刷新列表核对"
                : error.message;
        }
        if (!stopped.current) setRows(next.map((item) => ({ ...item })));
      }
    }
    try {
      // Reuse versioned soft deletion, including permission checks and audit.
      await Promise.all(
        Array.from({ length: Math.min(4, pending.length) }, worker),
      );
      if (!stopped.current) await refresh();
    } finally {
      running.current = false;
      if (!stopped.current) setBusy(false);
    }
  }

  async function retryRefresh() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await refresh();
    } finally {
      running.current = false;
      if (!stopped.current) setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title={`批量删除 ${records.length} 条记录`}
      size={OVERLAY_SIZE.narrow}
      onClose={() => {
        if (!running.current) onClose();
      }}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      destroyOnHidden
      footer={
        <>
          <Button aria-label="关闭" disabled={busy} onClick={onClose}>
            关闭
          </Button>
          <Button
            danger
            type="primary"
            loading={busy}
            aria-label={started ? "重试失败项" : `确认删除 ${records.length} 条`}
            disabled={
              busy || exceedsLimit || !rows.length || succeeded === rows.length
            }
            onClick={() => void remove()}
          >
            {started ? "重试失败项" : `确认删除 ${records.length} 条`}
          </Button>
        </>
      }
    >
      <Space orientation="vertical" className={styles.poolSettings}>
        <Alert
          type="warning"
          showIcon
          title={`将删除当前勾选的 ${records.length} 条记录`}
        />
        <Typography.Paragraph>
          删除后记录将从业务表中隐藏，请核对勾选范围后确认。每条记录独立处理，失败项会保留并说明原因。
        </Typography.Paragraph>
        {exceedsLimit && (
          <Alert
            type="error"
            title={`每次最多删除 ${MAX_DELETE_RECORDS} 条，请减少勾选`}
          />
        )}
        {started && (
          <>
            <Progress
              percent={Math.round(((succeeded + failed) / rows.length) * 100)}
            />
            <Alert
              type={failed ? "warning" : busy ? "info" : "success"}
              showIcon
              title={`成功删除 ${succeeded} 条，失败 ${failed} 条，未处理 ${rows.length - succeeded - failed} 条`}
            />
            {failed > 0 && (
              <ul className={styles.batchErrors}>
                {rows
                  .filter((row) => row.status === "error")
                  .map((row) => (
                    <li key={row.record.id}>
                      {row.record.title}：{row.error}
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
        {refreshFailed && (
          <Alert
            type="warning"
            title="删除结果已保留，列表刷新失败"
            action={
              <Button disabled={busy} onClick={() => void retryRefresh()}>
                重试刷新列表
              </Button>
            }
          />
        )}
      </Space>
    </Drawer>
  );
}
