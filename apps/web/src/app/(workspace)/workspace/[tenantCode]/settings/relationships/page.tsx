import { notFound } from "next/navigation";

import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { RelationshipOverview } from "@/features/automations/relationship-overview";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function RelationshipsPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();
  return (
    <Page width="editor">
      <PageHeader
        title="关系与自动化"
        description="业务表之间怎样关联，以及一条记录怎样在另一张表里创建记录。"
      />
      <RelationshipOverview tenantCode={tenantCode} />
    </Page>
  );
}
