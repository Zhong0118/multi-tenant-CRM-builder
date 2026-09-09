"use client";

import { CorrectAdminPhone } from "./correct-admin-phone";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Input, Popconfirm, Space } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";
import { ReadingPanel } from "@/components/workbench/surface";

import {
  tenantApi,
  type PlatformTenant,
  type TenantApi,
} from "./create-tenant-form";
import styles from "./tenants.module.css";

export function TenantStatusActions({
  tenant,
  api = tenantApi,
}: {
  tenant: PlatformTenant;
  api?: TenantApi;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mutation = useMutation({
    mutationFn: (status: PlatformTenant["status"]) =>
      api.changeStatus(tenant.id, {
        status,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => router.refresh(),
    onMutate: () => setError(undefined),
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });
  const renewal = useMutation({
    mutationFn: () => api.renewFirstAdminInvitation(tenant.id),
    onSuccess: () => {
      setNotice(
        "邀请已重新开放 7 天。请受邀人使用指定手机号登录个人工作台接受。",
      );
      router.refresh();
    },
    onMutate: () => {
      setError(undefined);
      setNotice(undefined);
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });
  const canRenew =
    tenant.status === "DRAFT" &&
    tenant.activeAdminCount === 0 &&
    tenant.firstAdminInvitation &&
    tenant.firstAdminInvitation.status !== "ACCEPTED";
  const canActivate = tenant.activeAdminCount > 0;
  const canRenderActivate =
    tenant.status === "DRAFT" || tenant.status === "SUSPENDED";

  return (
    <ReadingPanel ariaLabel="状态操作" className={styles.statusActions}>
      <h2>状态操作</h2>
      <p>每次变更都会记录操作者、原因和请求编号。</p>
      {!canActivate && canRenderActivate ? (
        <Alert
          type="warning"
          showIcon
          title="当前不能启用公司"
          description="需要至少 1 位有效公司管理员。请受邀人使用指定手机号登录，在个人工作台接受邀请。"
        />
      ) : null}
      {canRenew ? (
        <div className={styles.invitationRecovery}>
          <p>
            受邀手机号：{tenant.firstAdminInvitation?.targetPhone}
            。邀请失效时可重新开放 7 天，手机号和管理员角色保持不变。
          </p>
          <Popconfirm
            title="重新开放管理员邀请？"
            description="请通知受邀人登录个人工作台接受邀请。不会发送短信。"
            okText="重新邀请"
            cancelText="取消"
            onConfirm={() => renewal.mutate()}
          >
            <Button loading={renewal.isPending} disabled={mutation.isPending}>
              重新邀请管理员
            </Button>
          </Popconfirm>
          <CorrectAdminPhone tenantId={tenant.id} />
        </div>
      ) : null}
      {notice ? <Alert type="success" showIcon title={notice} /> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {tenant.status === "CLOSED" ? (
        <p>公司已关闭，不能重新启用。历史配置和操作日志仍可查阅。</p>
      ) : (
        <Input.TextArea
          aria-label="状态变更原因"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="填写状态变更原因（可选）"
          maxLength={1000}
          rows={3}
        />
      )}
      <Space wrap>
        {canRenderActivate && canActivate ? (
          <Button
            type="primary"
            loading={mutation.isPending}
            onClick={() => mutation.mutate("ACTIVE")}
          >
            启用公司
          </Button>
        ) : null}
        {tenant.status === "ACTIVE" ? (
          <Popconfirm
            title="确认暂停该公司？"
            description="成员将无法继续进入工作空间。保留配置和数据，可在此重新启用。"
            okText="确认暂停"
            cancelText="取消"
            onConfirm={() => mutation.mutate("SUSPENDED")}
          >
            <Button danger loading={mutation.isPending}>
              暂停公司
            </Button>
          </Popconfirm>
        ) : null}
        {tenant.status !== "CLOSED" ? (
          <Popconfirm
            title="确认关闭该公司？"
            description="关闭后所有成员无法进入，且不能重新启用。请确认业务已完成交接。"
            okText="确认关闭"
            cancelText="取消"
            onConfirm={() => mutation.mutate("CLOSED")}
          >
            <Button danger type="text" loading={mutation.isPending}>
              关闭公司
            </Button>
          </Popconfirm>
        ) : null}
      </Space>
    </ReadingPanel>
  );
}
