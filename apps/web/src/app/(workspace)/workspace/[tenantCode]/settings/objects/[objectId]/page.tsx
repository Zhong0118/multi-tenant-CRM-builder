import { notFound } from "next/navigation";

import { Page } from "@/components/layout/page";

import { ObjectDesigner } from "@/features/objects/object-designer";
import type { ObjectDraft } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface ObjectDesignerPageProps {
  params: Promise<{ tenantCode: string; objectId: string }>;
  searchParams?: Promise<{ section?: string }>;
}

export default async function ObjectDesignerPage({
  params,
  searchParams,
}: ObjectDesignerPageProps) {
  const { tenantCode, objectId } = await params;
  const section = (await searchParams)?.section;
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
    <Page width="editor">
      <ObjectDesigner
        tenantCode={tenantCode}
        initialDraft={result.data as ObjectDraft}
        initialSection={section === "automations" ? "automations" : undefined}
      />
    </Page>
  );
}
