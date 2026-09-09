import { Button } from "antd";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { StatePanel } from "@/components/workbench/state-panel";
import { TenantTable } from "@/features/tenants/tenant-table";
import styles from "@/features/tenants/tenants.module.css";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export interface TenantsPageProps {
  searchParams: Promise<{ page?: string; status?: string; search?: string }>;
}

export default async function TenantsPage({ searchParams }: TenantsPageProps) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const status = ["DRAFT", "ACTIVE", "SUSPENDED", "CLOSED"].includes(
    params.status ?? "",
  )
    ? (params.status as "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED")
    : undefined;
  const search = params.search?.trim().slice(0, 200) || undefined;
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
      <Button type="primary">+ 新增公司</Button>
    </Link>
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title="公司管理"
        description="统一管理公司工作空间的开通状态与首位管理员"
        extra={extra}
      />
      <form
        key={`${status ?? ""}:${search ?? ""}`}
        action="/platform/tenants"
        className={styles.filters}
      >
        <label>
          搜索公司
          <input
            name="search"
            defaultValue={search}
            placeholder="公司名称或工作空间代码"
            maxLength={200}
          />
        </label>
        <label>
          状态
          <select name="status" defaultValue={status ?? ""}>
            <option value="">全部状态</option>
            <option value="DRAFT">草稿</option>
            <option value="ACTIVE">运行中</option>
            <option value="SUSPENDED">已暂停</option>
            <option value="CLOSED">已关闭</option>
          </select>
        </label>
        <Button htmlType="submit">筛选</Button>
        {status || search ? (
          <Link href="/platform/tenants">清空筛选</Link>
        ) : null}
      </form>
      {summaryResult.data ? (
        <nav aria-label="公司状态汇总" className={styles.summary}>
          {[
            ["全部", "", summaryResult.data.total],
            ["草稿", "DRAFT", summaryResult.data.draft],
            ["运行中", "ACTIVE", summaryResult.data.active],
            ["已暂停", "SUSPENDED", summaryResult.data.suspended],
            ["已关闭", "CLOSED", summaryResult.data.closed],
          ].map(([label, value, count]) => (
            <Link
              key={String(label)}
              aria-current={(status ?? "") === value ? "page" : undefined}
              href={
                value
                  ? `/platform/tenants?status=${value}`
                  : "/platform/tenants"
              }
            >
              {label}
              <strong>{count}</strong>
            </Link>
          ))}
        </nav>
      ) : null}
      {data.items.length > 0 ? (
        <TenantTable data={data} filters={filters} />
      ) : (
        <StatePanel
          title={
            status || search
              ? "没有符合条件的公司"
              : data.total > 0
                ? "这一页没有公司"
                : "尚未开通公司"
          }
          description={
            status || search
              ? "尝试调整公司名称、代码或状态筛选。"
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

function parsePage(value?: string): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
