"use client";

import type { components } from "@crm/contracts";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { StatePanel } from "@/components/workbench/state-panel";
import { DataPanel } from "@/components/workbench/surface";

import { actionLabel } from "@/features/platform/audit-labels";

import styles from "./platform-overview.module.css";
import { tenantNextStep } from "./tenant-next-step";
import { TenantStatusTag } from "./tenant-status";

type PlatformTenantSummary = components["schemas"]["PlatformTenantSummaryDto"];
type PlatformTenantPage =
  components["schemas"]["PlatformTenantPageResponseDto"];
type AuditItem = components["schemas"]["PlatformAuditItemDto"];

export function PlatformOverview({
  summary,
  tenants,
  latestChange,
}: {
  summary: PlatformTenantSummary;
  tenants: PlatformTenantPage;
  /** The newest audit entry; null when there is none, "unavailable" when it could not be read. */
  latestChange?: AuditItem | null | "unavailable";
}) {
  const stopped = summary.suspended + summary.closed;
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
              tone={summary.active ? "success" : undefined}
            />
            <Kpi
              label="草稿"
              value={summary.draft}
              hint="尚未激活"
              tone={summary.draft ? "warning" : undefined}
            />
            <Kpi
              label="已暂停/已关闭"
              value={stopped}
              hint={`${summary.suspended} 暂停 · ${summary.closed} 关闭`}
              tone={stopped ? "danger" : undefined}
            />
          </div>
          <section className={styles.actions} aria-label="平台待办">
            <div>
              <h2>待处理事项</h2>
              <p>
                按公司当前状态继续开通或处理暂停；业务表发布由公司管理员完成。
              </p>
            </div>
            <ActionItem
              href="/platform/tenants?status=DRAFT"
              count={summary.draft}
              title={`${summary.draft} 家草稿公司`}
              hint="核对管理员邀请与启用条件"
              none="没有待开通的草稿公司"
            />
            <ActionItem
              href="/platform/tenants?status=SUSPENDED"
              count={summary.suspended}
              title={`${summary.suspended} 家暂停公司`}
              hint="查看公司日志与暂停原因"
              none="没有暂停的公司"
            />
            <Link href="/platform/audit">
              <strong>最近一次变更</strong>
              <span>{latestChangeText(latestChange)} →</span>
            </Link>
          </section>
          <RecentTenants tenants={tenants} />
        </>
      )}
    </>
  );
}

function ActionItem({
  href,
  count,
  title,
  hint,
  none,
}: {
  href: string;
  count: number;
  title: string;
  hint: string;
  none: string;
}) {
  if (!count)
    return (
      <div className={styles.quiet}>
        <strong>{none}</strong>
      </div>
    );
  return (
    <Link href={href}>
      <strong>{title}</strong>
      <span>{hint} →</span>
    </Link>
  );
}

function latestChangeText(
  change: AuditItem | null | "unavailable" | undefined,
) {
  if (change === "unavailable") return "暂时无法读取，去日志中心查看";
  if (!change) return "还没有日志";
  const who =
    change.actorName ??
    (change.actorType === "SYSTEM" ? "系统" : "已删除的账号");
  const where = change.tenantName ? `${change.tenantName} · ` : "";
  return `${where}${who} ${actionLabel(change.action)}，${formatWhen(change.createdAt)}`;
}

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
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
              <th>公司</th>
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
                  <code className={styles.code}>{tenant.code}</code>
                </td>
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
