"use client";

import type { components } from "@crm/contracts";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { StatePanel } from "@/components/workbench/state-panel";
import { DataPanel } from "@/components/workbench/surface";

import styles from "./platform-overview.module.css";
import { tenantNextStep } from "./tenant-next-step";
import { TenantStatusTag } from "./tenant-status";

type PlatformTenantSummary = components["schemas"]["PlatformTenantSummaryDto"];
type PlatformTenantPage =
  components["schemas"]["PlatformTenantPageResponseDto"];

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
        <StatePanel
          title="还没有公司"
          description="创建第一家公司草稿，并邀请首位公司管理员。"
          action={
            <Link href="/platform/tenants/new">
              <Button type="primary">新增公司</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className={styles.kpis}>
            <Kpi
              label="公司总数"
              value={summary.total}
              hint="平台内全部工作空间"
            />
            <Kpi
              label="运行中"
              value={summary.active}
              hint="已激活，成员可进入"
              tone="success"
            />
            <Kpi
              label="草稿"
              value={summary.draft}
              hint="尚未激活"
              tone="warning"
            />
            <Kpi
              label="已暂停/已关闭"
              value={summary.suspended + summary.closed}
              hint={`${summary.suspended} 暂停 · ${summary.closed} 关闭`}
              tone="danger"
            />
          </div>
          <section className={styles.actions} aria-label="平台待办">
            <div>
              <h2>待处理事项</h2>
              <p>
                按公司当前状态继续开通或处理暂停；业务表发布由公司管理员完成。
              </p>
            </div>
            <Link href="/platform/tenants?status=DRAFT">
              <strong>{summary.draft} 家草稿公司</strong>
              <span>核对管理员邀请与启用条件 →</span>
            </Link>
            <Link href="/platform/tenants?status=SUSPENDED">
              <strong>{summary.suspended} 家暂停公司</strong>
              <span>查看公司日志与暂停原因 →</span>
            </Link>
            <Link href="/platform/audit">
              <strong>近期平台变更</strong>
              <span>查看操作者、原因与变更详情 →</span>
            </Link>
          </section>
          <RecentTenants tenants={tenants} />
        </>
      )}
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <article
      className={`${styles.kpi} ${tone ? styles[`kpi${capitalize(tone)}`] : ""}`}
    >
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue} data-numeric>
        {value}
      </div>
      <div className={styles.kpiHint}>{hint}</div>
    </article>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function RecentTenants({ tenants }: { tenants: PlatformTenantPage }) {
  const router = useRouter();
  const rows = tenants.items.slice(0, 8);

  return (
    <DataPanel ariaLabel="最近开通的公司" className={styles.section}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>最近开通的公司</h2>
          <p>按创建时间排列，最多显示 8 家</p>
        </div>
        <Link href="/platform/tenants">查看全部</Link>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>名称</th>
              <th>工作空间代码</th>
              <th>状态</th>
              <th>活跃管理员</th>
              <th>下一步</th>
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
                <td>
                  <TenantStatusTag status={tenant.status} />
                </td>
                <td data-numeric>{tenant.activeAdminCount}</td>
                <td className={styles.nextStep}>{tenantNextStep(tenant)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DataPanel>
  );
}
