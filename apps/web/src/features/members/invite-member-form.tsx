"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Select, Typography } from "antd";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";

import { memberApi, type MemberApi } from "./member-table";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

/** 「邀请成员」: the header button and its short form in a dialog (Attio, Linear). */
export function InviteMemberForm({
  tenantCode,
  api = memberApi,
  onInvitationCreated,
}: {
  tenantCode: string;
  api?: MemberApi;
  onInvitationCreated?: () => void;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"TENANT_ADMIN" | "EMPLOYEE">("EMPLOYEE");
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);
  const validPhone = /^1[3-9]\d{9}$/.test(phone);
  const mutation = useMutation({
    mutationFn: () =>
      api.invite(tenantCode, {
        phone,
        role,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      }),
    onSuccess: async () => {
      setSent(true);
      setPhone("");
      setDisplayName("");
      onInvitationCreated?.();
      await queryClient.invalidateQueries({
        queryKey: ["workspace", tenantCode, "invitations"],
        exact: false,
      });
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  const close = () => {
    setOpen(false);
    setSent(false);
    setError(undefined);
  };

  return (
    <>
      <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => setOpen(true)}>
        邀请成员
      </Button>
      <Modal
        title="邀请成员"
        open={open}
        width={OVERLAY_SIZE.form}
        onCancel={close}
        destroyOnHidden
        footer={
          sent ? (
            <>
              <Button onClick={() => setSent(false)}>继续邀请</Button>
              <Button type="primary" onClick={close}>
                完成
              </Button>
            </>
          ) : (
            <>
              <Button onClick={close}>取消</Button>
              <Button
                type="primary"
                disabled={!validPhone}
                loading={mutation.isPending}
                onClick={() => {
                  setError(undefined);
                  mutation.mutate();
                }}
              >
                发送邀请
              </Button>
            </>
          )
        }
      >
        <p>对方用自己的手机号注册并接受邀请，不需要你设置密码。</p>
        {error ? <Alert type="error" showIcon title={error} /> : null}
        {sent ? (
          <Alert
            type="success"
            showIcon
            title="邀请已发送"
            description={
              <>
                邀请不会自动发送短信。请把注册链接发给对方，对方用受邀手机号验证并设置密码。
                <br />
                <Typography.Text copyable>
                  {typeof window === "undefined" ? "" : `${window.location.origin}/register`}
                </Typography.Text>
              </>
            }
          />
        ) : (
          <Form layout="vertical" component={false}>
            <Form.Item label="成员手机号" htmlFor="member-phone" required>
              <Input
                id="member-phone"
                value={phone}
                inputMode="tel"
                placeholder="输入 11 位手机号"
                onChange={(event) => setPhone(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="公司内姓名" htmlFor="member-name">
              <Input
                id="member-name"
                value={displayName}
                maxLength={100}
                placeholder="填写公司名册姓名"
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="职责" htmlFor="member-role">
              <Select
                id="member-role"
                aria-label="职责"
                value={role}
                onChange={setRole}
                options={[
                  { label: "普通员工", value: "EMPLOYEE" },
                  { label: "公司管理员", value: "TENANT_ADMIN" },
                ]}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </>
  );
}
