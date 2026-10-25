import { Button } from "antd";
import Link from "next/link";

import { PageToolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { StatePanel } from "@/components/workbench/state-panel";
import {
  TenantSearch,
  TenantSummaryWarning,
} from "@/features/tenants/tenant-search";
import { TenantTable } from "@/features/tenants/tenant-table";
import styles from "@/features/tenants/tenants.module.css";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export interface TenantsPageProps {
  searchParams: Promise<{
    page?: string | string[];
    status?: string | string[];
    search?: string | string[];
  }>;
}

export default async function TenantsPage({ searchParams }: TenantsPageProps) {
  const params = await searchParams;
  const page = parsePage(single(params.page));
  const requestedStatus = single(params.status);
  const status = ["DRAFT", "ACTIVE", "SUSPENDED", "CLOSED"].includes(
    requestedStatus ?? "",
  )
    ? (requestedStatus as "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED")
    : undefined;
  const search = single(params.search)?.trim().slice(0, 200) || undefined;
  const filters = { status, search };
  const client = await createServerApiClient();
  const [result, summaryResult] = await Promise.all([
    client.GET("/api/v1/platform/tenants", {
      params: { query: { page, limit: 20, ...filters } },
    }),
    client.GET("/api/v1/platform/tenants/summary"),
  ]);
  const { data, error, response } = result;
  if (!data) {
    const apiError = toApiError(error, response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }

  const extra = (
    <Link href="/platform/tenants/new">
      <Button type="primary">新增公司</Button>
    </Link>
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title="公司管理"
        description="统一管理公司工作空间的开通状态与首位管理员"
        extra={extra}
      />
      <PageToolbar
        start={
          <nav aria-label="按状态查看" className={styles.summary}>
            {[
              ["全部", "", summaryResult.data?.total],
              ["草稿", "DRAFT", summaryResult.data?.draft],
              ["运行中", "ACTIVE", summaryResult.data?.active],
              ["已暂停", "SUSPENDED", summaryResult.data?.suspended],
              ["已关闭", "CLOSED", summaryResult.data?.closed],
            ].map(([label, value, count]) => (
              <Link
                key={String(label)}
                aria-current={(status ?? "") === value ? "page" : undefined}
                href={tenantsHref({ status: String(value), search })}
              >
                {label}
                {count !== undefined ? <strong>{count}</strong> : null}
              </Link>
            ))}
          </nav>
        }
        end={
          <TenantSearch
            search={search}
            status={status}
            clearHref={tenantsHref({ status })}
          />
        }
      />
      {!summaryResult.data ? <TenantSummaryWarning /> : null}
      {data.items.length > 0 ? (
        <TenantTable data={data} filters={filters} />
      ) : (
        <StatePanel
          title={
            search
              ? `没有名称或代码包含「${search}」的公司`
              : status
                ? "没有这个状态的公司"
                : data.total > 0
                  ? "这一页没有公司"
                  : "尚未开通公司"
          }
          description={
            status || search
              ? "换一个关键词，或切换到「全部」查看。"
              : data.total > 0
                ? "返回第一页查看现有公司。"
                : "创建第一家公司草稿，并邀请首位公司管理员。"
          }
          action={
            status || search || data.total > 0 ? (
              <Link href="/platform/tenants">查看全部公司</Link>
            ) : (
              extra
            )
          }
        />
      )}
    </div>
  );
}

function tenantsHref(filters: { status?: string; search?: string }) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  const query = params.toString();
  return query ? `/platform/tenants?${query}` : "/platform/tenants";
}

function parsePage(value?: string): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}
