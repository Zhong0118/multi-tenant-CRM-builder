"use client";

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
  const canActivate = tenant.activeAdminCount > 0;
  const canRenderActivate =
    tenant.status === "DRAFT" || tenant.status === "SUSPENDED";

  return (
    <ReadingPanel ariaLabel="状态操作" className={styles.statusActions}>
      <h2>状态操作</h2>
      <p>每次变更都会记录操作者、原因和请求编号。</p>
      {!canActivate && tenant.status === "DRAFT" ? (
        <Alert type="warning" showIcon title="至少需要 1 位活跃公司管理员" />
      ) : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <Input.TextArea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="填写状态变更原因（可选）"
        maxLength={1000}
        rows={3}
      />
      <Space wrap>
        {canRenderActivate ? (
          <Button
            type="primary"
            disabled={!canActivate}
            loading={mutation.isPending}
            onClick={() => mutation.mutate("ACTIVE")}
          >
            激活公司
          </Button>
        ) : null}
        {tenant.status === "ACTIVE" ? (
          <Popconfirm
            title="确认暂停该公司？"
            description="成员将无法继续进入工作空间。"
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
            description="关闭是高风险操作，请先确认业务已完成交接。"
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
