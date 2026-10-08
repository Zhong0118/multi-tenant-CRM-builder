"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Select, Typography } from "antd";
import { useState } from "react";

import { ReadingPanel } from "@/components/workbench/surface";
import { toApiError } from "@/lib/api/api-error";

import { memberApi, type MemberApi } from "./member-table";
import { BulkInviteMembers } from "./bulk-invite-members";
import styles from "./members.module.css";

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

  return (
    <ReadingPanel className={styles.invitePanel} ariaLabel="邀请新成员">
      <div className={styles.inviteCopy}>
        <h2 id="invite-heading">邀请新成员</h2>
        <p>对方使用自己的手机号账号接受邀请，无需由管理员设置密码。</p>
      </div>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {sent ? (
        <Alert
          type="success"
          showIcon
          title="邀请已发送"
          description={
            <>
              请将注册链接发给员工，邀请不会自动发送短信。员工使用受邀手机号自行验证并设置密码。
              <br />
              <Typography.Text copyable>
                {typeof window === "undefined"
                  ? ""
                  : `${window.location.origin}/register`}
              </Typography.Text>
            </>
          }
        />
      ) : null}
      <Form layout="vertical" component={false}>
        <div className={styles.inviteFields}>
          <Form.Item label="公司内姓名" htmlFor="member-name">
            <Input
              id="member-name"
              value={displayName}
              maxLength={100}
              placeholder="填写公司名册姓名"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="成员手机号" htmlFor="member-phone">
            <Input
              id="member-phone"
              value={phone}
              inputMode="tel"
              placeholder="输入 11 位手机号"
              onChange={(event) => {
                setPhone(event.target.value);
                setSent(false);
              }}
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
        </div>
      </Form>
      <BulkInviteMembers
        tenantCode={tenantCode}
        api={api}
        onChanged={() => {
          onInvitationCreated?.();
          void queryClient.invalidateQueries({
            queryKey: ["workspace", tenantCode, "invitations"],
          });
        }}
      />
    </ReadingPanel>
  );
}
