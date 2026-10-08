"use client";

import { Alert, Button, Input, Modal, Select, Space, Table } from "antd";
import { useRef, useState } from "react";
import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";
import { runMemberBatch, type MemberBatchRow } from "./member-batch";
import type { TenantMember } from "./member-table";

type BatchAction = "EMPLOYEE" | "TENANT_ADMIN" | "ACTIVE" | "DISABLED";
const actions: { label: string; value: BatchAction }[] = [
  { label: "设为员工", value: "EMPLOYEE" },
  { label: "设为公司管理员", value: "TENANT_ADMIN" },
  { label: "恢复使用", value: "ACTIVE" },
  { label: "停用成员", value: "DISABLED" },
];
async function checked(result: { error?: unknown; response: Response }) {
  if (!result.response.ok)
    throw toApiError(result.error, result.response.status);
}
export const memberEditApi = {
  async name(tenantCode: string, memberId: string, displayName: string) {
    await checked(
      await browserApiClient.PATCH(
        "/api/v1/workspaces/{tenantCode}/members/{memberId}/name",
        { params: { path: { tenantCode, memberId } }, body: { displayName } },
      ),
    );
  },
  async action(tenantCode: string, memberId: string, action: BatchAction) {
    const params = { path: { tenantCode, memberId } };
    await checked(
      action === "EMPLOYEE" || action === "TENANT_ADMIN"
        ? await browserApiClient.PATCH(
            "/api/v1/workspaces/{tenantCode}/members/{memberId}/role",
            { params, body: { role: action } },
          )
        : await browserApiClient.PATCH(
            "/api/v1/workspaces/{tenantCode}/members/{memberId}",
            { params, body: { status: action } },
          ),
    );
  },
};

export function MemberNameEditor({
  tenantCode,
  member,
  onChanged,
  api = memberEditApi,
}: {
  tenantCode: string;
  member: TenantMember;
  onChanged: () => void;
  api?: typeof memberEditApi;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function save() {
    if (running.current || !name.trim()) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api.name(tenantCode, member.id, name.trim());
      setOpen(false);
      onChanged();
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        type="link"
        aria-label={`修改姓名 ${member.displayName ?? "该成员"}`}
        onClick={() => {
          setName(member.displayName ?? "");
          setError(undefined);
          setOpen(true);
        }}
      >
        修改姓名
      </Button>
      <Modal
        title="修改公司内姓名"
        open={open}
        onCancel={() => {
          if (!running.current) setOpen(false);
        }}
        onOk={() => void save()}
        okText="保存"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ disabled: !name.trim() }}
        cancelButtonProps={{ disabled: busy }}
        closable={!busy}
        mask={{ closable: !busy }}
        keyboard={!busy}
      >
        <p>仅更新本公司名册及业务记录中的姓名。</p>
        <Input
          aria-label="公司内姓名"
          maxLength={100}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <Alert type="error" title={error} />}
      </Modal>
    </>
  );
}

export function BulkMemberActions({
  tenantCode,
  selected,
  onChanged,
  api = memberEditApi,
}: {
  tenantCode: string;
  selected: TenantMember[];
  onChanged: () => void;
  api?: typeof memberEditApi;
}) {
  const [rows, setRows] = useState<MemberBatchRow<TenantMember>[]>([]);
  const [action, setAction] = useState<BatchAction>("EMPLOYEE");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const submitted = rows.some((row) => row.status !== "pending");
  async function submit() {
    if (running.current || !rows.length) return;
    running.current = true;
    setBusy(true);
    try {
      await runMemberBatch(
        rows,
        (member) => api.action(tenantCode, member.id, action),
        setRows,
      );
      onChanged();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={!selected.length}
        onClick={() => {
          setRows(selected.map((item) => ({ item, status: "pending" })));
          setAction("EMPLOYEE");
          setOpen(true);
        }}
      >
        批量管理{selected.length ? `（${selected.length}）` : ""}
      </Button>
      <Modal
        title={`批量管理 ${rows.length} 位成员`}
        open={open}
        width={680}
        onCancel={() => {
          if (!running.current) setOpen(false);
        }}
        closable={!busy}
        mask={{ closable: !busy }}
        keyboard={!busy}
        footer={
          <Space wrap>
            <Button disabled={busy} onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button
              type="primary"
              danger={action === "DISABLED"}
              loading={busy}
              disabled={rows.every((row) => row.status === "success")}
              onClick={() => void submit()}
            >
              {submitted ? "重试失败行" : "确认执行"}
            </Button>
          </Space>
        }
      >
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Select
            aria-label="批量操作"
            value={action}
            options={actions}
            disabled={busy || submitted}
            onChange={setAction}
            style={{ width: 210 }}
          />
          <p>
            {action === "DISABLED"
              ? "停用立即生效。有待交接记录或待办的成员须先完成离职交接，失败原因会逐人列出。"
              : "变更仅作用于当前公司。角色权限立即生效，系统会保护最后一位可用管理员。"}
          </p>
          <Table
            rowKey={(row) => row.item.id}
            size="small"
            pagination={false}
            dataSource={rows}
            scroll={{ x: 450 }}
            columns={[
              {
                title: "姓名",
                render: (_, row) => row.item.displayName ?? "未设置姓名",
              },
              { title: "手机号", render: (_, row) => row.item.phone },
              {
                title: "结果",
                render: (_, row) =>
                  row.error || (row.status === "success" ? "已完成" : "待执行"),
              },
            ]}
          />
          {submitted && (
            <span>
              成功 {rows.filter((row) => row.status === "success").length} 人 ·
              失败 {rows.filter((row) => row.status === "error").length} 人
            </span>
          )}
        </Space>
      </Modal>
    </>
  );
}
