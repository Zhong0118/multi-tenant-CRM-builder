"use client";

import { Alert, Button, Modal, Popconfirm, Select, Space } from "antd";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";
import type { TenantMember } from "./member-table";

type Preview = {
  records: number;
  openTasks: number;
  recipients: TenantMember[];
};
async function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

export function MemberLifecycleActions({
  tenantCode,
  member,
  protectsFinalAdmin,
  isSelf,
  onChanged,
}: {
  tenantCode: string;
  member: TenantMember;
  protectsFinalAdmin: boolean;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [recipient, setRecipient] = useState<string>();
  async function run(work: () => Promise<unknown>) {
    setError(undefined);
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  }
  const path = { tenantCode, memberId: member.id };
  return (
    <Space wrap size={4}>
      {error && (
        <Alert
          type="error"
          title={error}
          closable
          onClose={() => setError(undefined)}
        />
      )}
      {member.status === "ACTIVE" && (
        <>
          <Popconfirm
            title={
              member.role === "EMPLOYEE"
                ? "授予公司管理员权限？"
                : "将此管理员改为员工？"
            }
            description="角色变更立即生效，员工将按已发布的对象权限访问。"
            disabled={protectsFinalAdmin}
            onConfirm={() =>
              run(async () => {
                await unwrap(
                  await browserApiClient.PATCH(
                    "/api/v1/workspaces/{tenantCode}/members/{memberId}/role",
                    {
                      params: { path },
                      body: {
                        role:
                          member.role === "EMPLOYEE"
                            ? "TENANT_ADMIN"
                            : "EMPLOYEE",
                      },
                    },
                  ),
                );
                onChanged();
                router.refresh();
              })
            }
          >
            <Button type="link" disabled={protectsFinalAdmin || busy}>
              {member.role === "EMPLOYEE" ? "设为管理员" : "改为员工"}
            </Button>
          </Popconfirm>
          {!isSelf && (
            <Popconfirm
              title="将我的管理员身份移交给此成员？"
              description="对方将成为管理员，你将成为员工并返回工作空间。不能移交给自己。"
              onConfirm={() =>
                run(async () => {
                  await unwrap(
                    await browserApiClient.POST(
                      "/api/v1/workspaces/{tenantCode}/members/admin-handoff",
                      {
                        params: { path: { tenantCode } },
                        body: { recipientMemberId: member.id },
                      },
                    ),
                  );
                  router.push(`/workspace/${tenantCode}`);
                  router.refresh();
                })
              }
            >
              <Button type="link" disabled={busy}>
                移交管理员
              </Button>
            </Popconfirm>
          )}
        </>
      )}
      <Button
        type="link"
        danger
        disabled={protectsFinalAdmin || busy}
        onClick={() =>
          run(async () => {
            const data = await unwrap(
              await browserApiClient.GET(
                "/api/v1/workspaces/{tenantCode}/members/{memberId}/offboarding",
                { params: { path } },
              ),
            );
            setRecipient(undefined);
            setPreview(data);
          })
        }
      >
        离职交接
      </Button>
      <Modal
        title={`离职交接 · ${member.displayName ?? member.phone ?? "该成员"}`}
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        confirmLoading={busy}
        okText="交接并停用"
        okButtonProps={{ disabled: !recipient }}
        onOk={() =>
          run(async () => {
            if (!recipient) return;
            await unwrap(
              await browserApiClient.POST(
                "/api/v1/workspaces/{tenantCode}/members/{memberId}/offboarding",
                { params: { path }, body: { recipientMemberId: recipient } },
              ),
            );
            setPreview(undefined);
            if (isSelf) router.push("/workspaces");
            onChanged();
            router.refresh();
          })
        }
      >
        <p>
          将转交 {preview?.records ?? 0} 条负责记录（含已删除记录）和{" "}
          {preview?.openTasks ?? 0}{" "}
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
            label: item.displayName
              ? `${item.displayName} · ${item.phone ?? ""}`
              : (item.phone ?? item.id),
          }))}
        />
        {preview?.recipients.length === 0 && (
          <Alert type="warning" title="请先将另一位在职成员设为公司管理员。" />
        )}
        {error && <Alert type="error" title={error} />}
      </Modal>
    </Space>
  );
}
