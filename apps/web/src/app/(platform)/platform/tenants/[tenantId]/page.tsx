import { PageHeader } from "@/components/layout/page-header";
import { ReadingPanel } from "@/components/workbench/surface";
import { TenantBusinessConfiguration } from "@/features/templates/template-application";
import { TenantSetupProgress } from "@/features/tenants/tenant-setup-progress";
import { TenantStatusActions } from "@/features/tenants/tenant-status-actions";
import {
  TenantStatusTag,
  tenantStatusText,
} from "@/features/tenants/tenant-status";
import styles from "@/features/tenants/tenants.module.css";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

const invitationStatusText = {
  PENDING: "等待接受",
  ACCEPTED: "已接受",
  DECLINED: "已拒绝",
  REVOKED: "已撤销",
  EXPIRED: "已过期",
} as const;

export interface TenantDetailPageProps {
  params: Promise<{ tenantId: string }>;
}

export default async function TenantDetailPage({
  params,
}: TenantDetailPageProps) {
  const { tenantId } = await params;
  const client = await createServerApiClient();
  const [tenantResult, configurationResult] = await Promise.all([
    client.GET("/api/v1/platform/tenants/{tenantId}", {
      params: { path: { tenantId } },
    }),
    client.GET("/api/v1/platform/tenants/{tenantId}/business-configuration", {
      params: { path: { tenantId } },
    }),
  ]);
  const { data: tenant, error, response } = tenantResult;
  if (!tenant) {
    const apiError = toApiError(error, response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }
  if (!configurationResult.data) {
    const apiError = toApiError(
      configurationResult.error,
      configurationResult.response.status,
    );
    throw Object.assign(new Error(apiError.message), apiError);
  }
  const activeAdminReady = tenant.activeAdminCount > 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title={tenant.name}
        status={<TenantStatusTag status={tenant.status} />}
        description={`工作空间代码：${tenant.code}`}
      />
      <TenantSetupProgress
        tenantStatus={tenant.status}
        invitationStatus={tenant.firstAdminInvitation?.status}
        activeAdminCount={tenant.activeAdminCount}
        objectCount={configurationResult.data.objectCount}
      />
      <TenantBusinessConfiguration
        tenant={tenant}
        initialSummary={configurationResult.data}
      />
      <div className={styles.detailLayout}>
        <ReadingPanel ariaLabel="公司与管理员信息" className={styles.detailPanel}>
          <h2 className={styles.panelTitle}>基本信息</h2>
          <dl className={styles.detailLedger}>
            <div>
              <dt>名称</dt>
              <dd>{tenant.name}</dd>
            </div>
            <div>
              <dt>代码</dt>
              <dd>{tenant.code}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{tenantStatusText(tenant.status)}</dd>
            </div>
            <div>
              <dt>激活时间</dt>
              <dd>{formatDate(tenant.activatedAt)}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{formatDate(tenant.createdAt)}</dd>
            </div>
          </dl>
          <h2 className={styles.panelTitle}>首位管理员</h2>
          <dl className={styles.detailLedger}>
            <div>
              <dt>手机号</dt>
              <dd>
                {tenant.firstAdminInvitation?.targetPhone ?? "未创建邀请"}
              </dd>
            </div>
            <div>
              <dt>邀请状态</dt>
              <dd>
                {tenant.firstAdminInvitation
                  ? invitationStatusText[tenant.firstAdminInvitation.status]
                  : "未创建"}
              </dd>
            </div>
            <div>
              <dt>活跃管理员人数</dt>
              <dd>{tenant.activeAdminCount} 位</dd>
            </div>
          </dl>
        </ReadingPanel>
        <aside className={styles.detailAside}>
          <ReadingPanel ariaLabel="激活判定" className={styles.checkpoints}>
            <h2>激活判定</h2>
            <p className={styles.intro}>
              {tenant.status === "ACTIVE"
                ? "公司已启用，公司管理员可以进入工作空间。"
                : activeAdminReady
                  ? "管理员门槛已满足。启用后，公司管理员才能进入工作空间。"
                  : "首位管理员尚未接受邀请。当前不能启用公司。"}
            </p>
          </ReadingPanel>
          <TenantStatusActions tenant={tenant} />
        </aside>
      </div>
    </div>
  );
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
