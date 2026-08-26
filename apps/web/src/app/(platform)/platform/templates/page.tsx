import { Button } from "antd";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { TemplateList } from "@/features/templates/template-list";
import styles from "@/features/templates/templates.module.css";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export interface TemplatesPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  const page = parsePage((await searchParams).page);
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET(
    "/api/v1/platform/business-templates",
    { params: { query: { page, limit: 20 } } },
  );
  if (!data) {
    const apiError = toApiError(error, response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="业务模板"
        description="统一维护可复用的业务对象配置。"
        extra={
          <Link href="/platform/templates/new">
            <Button type="primary">新建模板</Button>
          </Link>
        }
      />
      <TemplateList data={data} />
    </div>
  );
}

function parsePage(value?: string): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
