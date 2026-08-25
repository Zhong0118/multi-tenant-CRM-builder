"use client";

import type { components } from "@crm/contracts";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";

import styles from "./platform-overview.module.css";

type PlatformTenantSummary = components["schemas"]["PlatformTenantSummaryDto"];
type PlatformTenantPage =
  components["schemas"]["PlatformTenantPageResponseDto"];

const statusText = {
  DRAFT: "草稿",
  ACTIVE: "运行中",
  SUSPENDED: "已暂停",
  CLOSED: "已关闭",
} as const;

export function PlatformOverview({
  summary,
  tenants,
}: {
  summary: PlatformTenantSummary;
  tenants: PlatformTenantPage;
}) {
  return (
    <>
      <PageHeader
        title="平台总览"
        description="多公司工作空间的开通与运行状态"
        extra={
          <Link href="/platform/tenants/new">
            <Button type="primary">新增公司</Button>
          </Link>
        }
      />
      {summary.total === 0 ? (
        <p className={styles.empty}>
          创建第一家公司草稿，并邀请首位公司管理员。
        </p>
      ) : (
        <>
          <div className={styles.kpis}>
            <Kpi label="公司总数" value={summary.total} />
            <Kpi label="运行中" value={summary.active} />
            <Kpi label="草稿" value={summary.draft} />
            <Kpi
              label="已暂停/已关闭"
              value={summary.suspended + summary.closed}
            />
          </div>
          <RecentTenants tenants={tenants} />
        </>
      )}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <article className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue} data-numeric>
        {value}
      </div>
    </article>
  );
}

function RecentTenants({ tenants }: { tenants: PlatformTenantPage }) {
  const router = useRouter();
  const rows = tenants.items.slice(0, 8);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <h2>公司</h2>
        <Link href="/platform/tenants">查看全部</Link>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>名称</th>
            <th>工作空间代码</th>
            <th>状态</th>
            <th>活跃管理员</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tenant) => (
            <tr
              key={tenant.id}
              onClick={() => router.push(`/platform/tenants/${tenant.id}`)}
            >
              <td>
                <Link
                  href={`/platform/tenants/${tenant.id}`}
                  className={styles.nameLink}
                  onClick={(event) => event.stopPropagation()}
                >
                  {tenant.name}
                </Link>
              </td>
              <td className={styles.code}>{tenant.code}</td>
              <td>{statusText[tenant.status]}</td>
              <td data-numeric>{tenant.activeAdminCount}</td>
              <td>{formatDate(tenant.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
