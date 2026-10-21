"use client";

import { EllipsisOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal, Select } from "antd";
import type { MenuProps } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import { MemberNameDialog } from "./member-edit-actions";
import type { TenantMember } from "./member-table";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

type Preview = {
  records: number;
  openTasks: number;
  recipients: TenantMember[];
};

type Confirm = "role" | "handoff" | "disable";

async function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

const CONFIRM_COPY: Record<Confirm, (member: TenantMember) => { title: string; body: string; ok: string; danger?: boolean }> = {
  role: (member) =>
    member.role === "EMPLOYEE"
      ? { title: "授予公司管理员权限？", body: "角色变更立即生效。管理员可以管理成员、业务表和全部数据。", ok: "设为管理员" }
      : { title: "将此管理员改为员工？", body: "角色变更立即生效，员工将按已发布的对象权限访问。", ok: "改为员工" },
  handoff: () => ({
    title: "将我的管理员身份移交给此成员？",
    body: "对方将成为管理员，你将成为员工并返回工作空间。不能移交给自己。",
    ok: "移交管理员",
  }),
  disable: () => ({
    title: "停用这位成员？",
    body: "该成员现有会话将在下一次工作空间请求时失效，可以随时恢复。",
    ok: "停用",
    danger: true,
  }),
};

/**
 * Every action on one member behind a single ⋯ (Linear, Attio, Vercel): name,
 * object access, role, admin handoff, offboarding and status. Unavailable
 * actions stay in the menu, disabled, so the reason they cannot run is visible.
 */
export function MemberRowMenu({
  tenantCode,
  member,
  isSelf,
  protectsFinalAdmin,
  onStatusChange,
  onChanged,
}: {
  tenantCode: string;
  member: TenantMember;
  isSelf: boolean;
  protectsFinalAdmin: boolean;
  onStatusChange: (status: "ACTIVE" | "DISABLED") => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [nameOpen, setNameOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>();
  const [preview, setPreview] = useState<Preview>();
  const [recipient, setRecipient] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = member.displayName ?? "该成员";
  const path = { tenantCode, memberId: member.id };
  const active = member.status === "ACTIVE";

  async function run(work: () => Promise<unknown>) {
    setError(undefined);
    setBusy(true);
    try {
      await work();
      return true;
    } catch (caught) {
      setError(toApiError(caught).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction() {
    if (confirm === "disable") {
      setConfirm(undefined);
      onStatusChange("DISABLED");
      return;
    }
    const done = await run(async () => {
      if (confirm === "role") {
        await unwrap(
          await browserApiClient.PATCH("/api/v1/workspaces/{tenantCode}/members/{memberId}/role", {
            params: { path },
            body: { role: member.role === "EMPLOYEE" ? "TENANT_ADMIN" : "EMPLOYEE" },
          }),
        );
        onChanged();
        router.refresh();
      } else if (confirm === "handoff") {
        await unwrap(
          await browserApiClient.POST("/api/v1/workspaces/{tenantCode}/members/admin-handoff", {
            params: { path: { tenantCode } },
            body: { recipientMemberId: member.id },
          }),
        );
        router.push(`/workspace/${tenantCode}`);
        router.refresh();
      }
    });
    if (done) setConfirm(undefined);
  }

  const finalAdminReason = protectsFinalAdmin ? "（需保留至少一位在职管理员）" : "";
  const items: MenuProps["items"] = [
    { key: "name", label: "修改姓名", onClick: () => setNameOpen(true) },
    ...(member.role === "EMPLOYEE" && active
      ? [{ key: "access", label: "访问权限", onClick: () => router.push(`/workspace/${tenantCode}/members/${member.id}/access`) }]
      : []),
    ...(active
      ? [
          { type: "divider" as const },
          {
            key: "role",
            label: `${member.role === "EMPLOYEE" ? "设为管理员" : "改为员工"}${finalAdminReason}`,
            disabled: protectsFinalAdmin,
            onClick: () => setConfirm("role"),
          },
          ...(!isSelf ? [{ key: "handoff", label: "移交管理员", onClick: () => setConfirm("handoff") }] : []),
        ]
      : []),
    { type: "divider" as const },
    {
      key: "offboard",
      label: `离职交接${finalAdminReason}`,
      danger: true,
      disabled: protectsFinalAdmin,
      onClick: () =>
        void run(async () => {
          const data = await unwrap(
            await browserApiClient.GET("/api/v1/workspaces/{tenantCode}/members/{memberId}/offboarding", { params: { path } }),
          );
          setRecipient(undefined);
          setPreview(data);
        }),
    },
    active
      ? { key: "disable", label: `停用${finalAdminReason}`, danger: true, disabled: protectsFinalAdmin, onClick: () => setConfirm("disable") }
      : { key: "restore", label: "恢复使用", onClick: () => onStatusChange("ACTIVE") },
  ];

  const copy = confirm ? CONFIRM_COPY[confirm](member) : undefined;

  return (
    <>
      <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items }}>
        <Button type="text" size="small" aria-label={`更多操作 ${name}`} icon={<EllipsisOutlined aria-hidden />} loading={busy && !confirm && !preview} />
      </Dropdown>
      {error && !confirm && !preview ? (
        <Alert type="error" title={error} closable onClose={() => setError(undefined)} />
      ) : null}
      {nameOpen ? (
        <MemberNameDialog tenantCode={tenantCode} member={member} onClose={() => setNameOpen(false)} onChanged={onChanged} />
      ) : null}
      <Modal
        open={Boolean(copy)}
        title={copy?.title}
        okText={copy?.ok}
        cancelText="取消"
        width={OVERLAY_SIZE.confirm}
        confirmLoading={busy}
        okButtonProps={{ danger: copy?.danger }}
        onCancel={() => {
          setConfirm(undefined);
          setError(undefined);
        }}
        onOk={() => void confirmAction()}
      >
        <p>{copy?.body}</p>
        {error ? <Alert type="error" title={error} /> : null}
      </Modal>
      <Modal
        title={`离职交接 · ${member.displayName ?? member.phone ?? "该成员"}`}
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        confirmLoading={busy}
        okText="交接并停用"
        okButtonProps={{ danger: true, disabled: !recipient }}
        cancelText="取消"
        width={OVERLAY_SIZE.form}
        onOk={() =>
          void run(async () => {
            if (!recipient) return;
            await unwrap(
              await browserApiClient.POST("/api/v1/workspaces/{tenantCode}/members/{memberId}/offboarding", {
                params: { path },
                body: { recipientMemberId: recipient },
              }),
            );
            setPreview(undefined);
            if (isSelf) router.push("/workspaces");
            onChanged();
            router.refresh();
          })
        }
      >
        <p>
          将转交 {preview?.records ?? 0} 条负责记录（含已删除记录）和 {preview?.openTasks ?? 0}{" "}
          项未完成待办，然后停用此成员。实际数量以提交时为准，已完成待办保留原负责人。
        </p>
        <p>
          为确保所有业务表的数据可继续处理，接收人须为另一位在职公司管理员。归档或已删除记录的待办也会保留并交接；需恢复记录后处理。
        </p>
        <Select
          style={{ width: "100%" }}
          aria-label="交接接收人"
          placeholder="选择在职公司管理员"
          value={recipient}
          onChange={setRecipient}
          options={preview?.recipients.map((item) => ({
            value: item.id,
            label: item.displayName ? `${item.displayName} · ${item.phone ?? ""}` : (item.phone ?? item.id),
          }))}
        />
        {preview?.recipients.length === 0 ? <Alert type="warning" title="请先将另一位在职成员设为公司管理员。" /> : null}
        {error && preview ? <Alert type="error" title={error} /> : null}
      </Modal>
    </>
  );
}
