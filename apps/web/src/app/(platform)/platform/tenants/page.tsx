import { Button } from "antd";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { TenantTable } from "@/features/tenants/tenant-table";
import styles from "@/features/tenants/tenants.module.css";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export interface TenantsPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function TenantsPage({ searchParams }: TenantsPageProps) {
  const page = parsePage((await searchParams).page);
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET(
    "/api/v1/platform/tenants",
    { params: { query: { page, limit: 20 } } },
  );
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
      {data.items.length > 0 ? (
        <TenantTable data={data} />
      ) : (
        <section className={styles.emptyState}>
          <h2>尚未开通公司</h2>
          <p className={styles.intro}>
            创建第一家公司草稿，并邀请首位公司管理员。
          </p>
        </section>
      )}
    </div>
  );
}

function parsePage(value?: string): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
