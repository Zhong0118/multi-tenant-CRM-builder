import Link from "next/link";

import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import styles from "@/features/tenants/tenants.module.css";

const statusText = {
  DRAFT: "草稿",
  ACTIVE: "运行中",
  SUSPENDED: "已暂停",
  CLOSED: "已关闭",
} as const;

export default async function TenantsPage() {
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET(
    "/api/v1/platform/tenants",
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
      {data.length > 0 ? (
        <table className={styles.registry}>
          <thead>
            <tr>
              <th>公司</th>
              <th>工作空间代码</th>
              <th>状态</th>
              <th>活跃管理员</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {data.map((tenant) => (
              <tr key={tenant.id}>
                <td>
                  <Link
                    href={`/platform/tenants/${tenant.id}`}
                    className={styles.tenantLink}
                  >
                    {tenant.name}
                  </Link>
                </td>
                <td>{tenant.code}</td>
                <td>{statusText[tenant.status]}</td>
                <td>{tenant.activeAdminCount}</td>
                <td>{formatDate(tenant.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
