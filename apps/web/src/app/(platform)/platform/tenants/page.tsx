import Link from "next/link";

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

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>COMPANY REGISTRY</span>
          <h1>公司工作空间</h1>
          <p className={styles.intro}>
            集中开通、核验和管理每家公司的运行状态。
          </p>
        </div>
        <Link href="/platform/tenants/new" className={styles.tenantLink}>
          ＋ 开通公司
        </Link>
      </header>
      {data.items.length > 0 ? (
        <TenantTable data={data} />
      ) : (
        <section className={styles.createPanel}>
          <h2>尚未开通公司</h2>
          <p className={styles.intro}>
            创建第一家公司草稿，并邀请首位公司管理员。
          </p>
        </section>
      )}
    </main>
  );
}

function parsePage(value?: string): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
