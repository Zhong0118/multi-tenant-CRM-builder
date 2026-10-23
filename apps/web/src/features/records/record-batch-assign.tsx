"use client";

import {
  Alert,
  Button,
  Drawer,
  Progress,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import type { RecordSummary } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import type { DynamicFieldMember } from "./dynamic-field";
import { recordPoolApi, type RecordPoolApi } from "./record-pool-api";
import styles from "./records.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { memberSelectOptions } from "@/components/identity/member-identity";

export const MAX_OWNER_ASSIGNMENT_RECORDS = 1000;

type AssignmentRow = {
  record: RecordSummary;
  status: "pending" | "success" | "error";
  error?: string;
};

export function RecordBatchAssignDrawer({
  tenantCode,
  objectCode,
  records,
  members,
  onClose,
  onChanged,
  api = recordPoolApi,
}: {
  tenantCode: string;
  objectCode: string;
  records: RecordSummary[];
  members: DynamicFieldMember[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  api?: RecordPoolApi;
}) {
  const [rows, setRows] = useState<AssignmentRow[]>(() =>
    records.map((record) => ({ record, status: "pending" })),
  );
  const [owner, setOwner] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [warning, setWarning] = useState<string>();
  const running = useRef(false);
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);
  const exceedsLimit = rows.length > MAX_OWNER_ASSIGNMENT_RECORDS;
  const succeeded = rows.filter((row) => row.status === "success").length;
  const failed = rows.filter((row) => row.status === "error").length;

  async function assign() {
    if (!owner || running.current || exceedsLimit) return;
    running.current = true;
    setBusy(true);
    setStarted(true);
    setWarning(undefined);
    const next = rows.map((row) => ({ ...row }));
    try {
      for (const row of next) {
        if (stopped.current) break;
        if (row.status === "success") continue;
        try {
          await api.changeOwnership(tenantCode, objectCode, row.record.id, {
            action: "ASSIGN",
            ownerMemberId: owner,
            version: row.record.version,
          });
          row.status = "success";
          row.error = undefined;
        } catch (caught) {
          const error = toApiError(caught);
          row.status = "error";
          row.error =
            error.status === 409
              ? "记录已变更，请关闭并刷新列表后重新选择"
              : error.message;
        }
        if (!stopped.current) setRows(next.map((item) => ({ ...item })));
      }
      try {
        await onChanged();
      } catch {
        if (!stopped.current)
          setWarning("分配结果已保留，列表刷新失败，请重新载入");
      }
    } finally {
      running.current = false;
      if (!stopped.current) setBusy(false);
    }
  }

  return (
    <Drawer
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            关闭
          </Button>
          <Button
            type="primary"
            loading={busy}
            aria-label={started ? "重试失败项" : "确认分配"}
            disabled={
              busy || !owner || exceedsLimit || succeeded === rows.length
            }
            onClick={() => void assign()}
          >
            {started ? "重试失败项" : "确认分配"}
          </Button>
        </>
      }
      size={OVERLAY_SIZE.narrow}
      open
      title={`批量分配 ${records.length} 条记录`}
      onClose={() => {
        if (!running.current) onClose();
      }}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      destroyOnHidden
    >
      <Space orientation="vertical" className={styles.poolSettings}>
        <Typography.Paragraph>
          选中的记录将统一归该成员负责，公共池记录会移出公共池，并从本次分配起按业务表设置重新计算回收期限。公共池关闭时暂停回收
        </Typography.Paragraph>
        {exceedsLimit ? (
          <Alert
            type="warning"
            title={`批量分配负责人每次最多 ${MAX_OWNER_ASSIGNMENT_RECORDS} 条，请减少勾选`}
          />
        ) : null}
        <Select
          aria-label="批量分配负责人"
          placeholder="选择负责人"
          showSearch
          optionFilterProp="searchText"
          value={owner}
          disabled={busy || started}
          onChange={setOwner}
          options={memberSelectOptions(members)}
        />
        {started ? (
          <>
            <Progress
              percent={Math.round(((succeeded + failed) / rows.length) * 100)}
            />
            <Alert
              type={failed ? "warning" : "success"}
              showIcon
              title={`成功 ${succeeded} 条，失败 ${failed} 条，未处理 ${rows.length - succeeded - failed} 条`}
            />
            {failed > 0 ? (
              <ul className={styles.batchErrors}>
                {rows
                  .filter((row) => row.status === "error")
                  .map((row) => (
                    <li key={row.record.id}>
                      {row.record.title}：{row.error}
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {warning ? <Alert type="warning" title={warning} /> : null}
      </Space>
    </Drawer>
  );
}
