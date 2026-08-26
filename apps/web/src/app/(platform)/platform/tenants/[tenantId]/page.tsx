import { PageHeader } from "@/components/layout/page-header";
import { TenantBusinessConfiguration } from "@/features/templates/template-application";
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
  const invitationAccepted = tenant.firstAdminInvitation?.status === "ACCEPTED";
  const activeAdminReady = tenant.activeAdminCount > 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <span className={styles.titleRow}>
            {tenant.name}
            <TenantStatusTag status={tenant.status} />
          </span>
        }
        description={`工作空间代码：${tenant.code}`}
      />
      <div className={styles.detailLayout}>
        <section className={styles.detailPanel}>
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
          <div className={styles.gate} aria-label="激活门槛">
            <Gate ready title="公司草稿已建立" />
            <Gate ready={invitationAccepted} title="首位管理员已接受邀请" />
            <Gate ready={activeAdminReady} title="至少一位管理员处于活跃状态" />
          </div>
          <TenantBusinessConfiguration
            tenant={tenant}
            initialSummary={configurationResult.data}
          />
        </section>
        <aside>
          <section className={styles.checkpoints}>
            <h2>激活判定</h2>
            <p className={styles.intro}>
              {activeAdminReady
                ? "管理员门槛已满足，可以执行激活。"
                : "等待首位管理员接受邀请后，平台管理员方可激活。"}
            </p>
          </section>
          <TenantStatusActions tenant={tenant} />
        </aside>
      </div>
    </div>
  );
}

function Gate({ ready, title }: { ready: boolean; title: string }) {
  return (
    <div className={`${styles.gateItem} ${ready ? styles.gateReady : ""}`}>
      <span className={styles.gateMark}>{ready ? "✓" : "·"}</span>
      <div>
        <strong>{title}</strong>
        <p className={styles.intro}>{ready ? "已满足" : "待完成"}</p>
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
