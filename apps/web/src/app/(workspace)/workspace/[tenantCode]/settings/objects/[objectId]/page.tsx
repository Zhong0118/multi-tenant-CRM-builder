import Link from "next/link";
import { notFound } from "next/navigation";

import { ObjectDesigner } from "@/features/objects/object-designer";
import type { ObjectDraft } from "@/features/objects/object-types";
import styles from "@/features/objects/objects.module.css";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface ObjectDesignerPageProps {
  params: Promise<{ tenantCode: string; objectId: string }>;
}

export default async function ObjectDesignerPage({
  params,
}: ObjectDesignerPageProps) {
  const { tenantCode, objectId } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  const client = await createServerApiClient();
  const result = await client.GET(
    "/api/v1/workspaces/{tenantCode}/object-definitions/{objectId}",
    { params: { path: { tenantCode, objectId } } },
  );
  if (!result.data) {
    // A cross-tenant or unknown object is a not-found, never a hint that it
    // exists somewhere else.
    if (result.response.status < 500) notFound();
    const apiError = toApiError(result.error, result.response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }

  return (
    <main className={styles.page}>
      <Link href={`/workspace/${tenantCode}/settings/objects`}>
        返回业务表列表
      </Link>
      <ObjectDesigner
        tenantCode={tenantCode}
        initialDraft={result.data as ObjectDraft}
      />
    </main>
  );
}
