import { notFound } from "next/navigation";
import Link from "next/link";

import { CreateObjectForm } from "@/features/objects/create-object-form";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface NewObjectPageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function NewObjectPage({ params }: NewObjectPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  return (
    <Page width="settings">
      <PageHeader
        breadcrumb={<Link href={`/workspace/${tenantCode}/settings/objects`}>业务表</Link>}
        title="新建业务表"
        description="填写名称和代码，也可以从 Excel / CSV 生成字段。创建后是草稿，发布前员工看不到。"
      />
      <CreateObjectForm tenantCode={tenantCode} />
    </Page>
  );
}
