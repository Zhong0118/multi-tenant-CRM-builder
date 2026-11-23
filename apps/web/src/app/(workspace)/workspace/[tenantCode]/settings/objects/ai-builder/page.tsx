import { notFound } from "next/navigation";
import { TableBuilder } from "@/features/table-builder/table-builder";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { createServerApiClient } from "@/lib/api/server-client";
import { toApiError } from "@/lib/api/api-error";

interface Props {
  params: Promise<{ tenantCode: string }>;
  searchParams: Promise<{ objectId?: string | string[] }>;
}

export default async function BuilderPage({ params, searchParams }: Props) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();
  const { objectId } = await searchParams;
  const scopedKey = [tenantCode, workspace.memberId, objectId].join("/");
  if (objectId === undefined)
    return <TableBuilder key={scopedKey} tenantCode={tenantCode} />;
  if (typeof objectId !== "string" || !objectId) notFound();
  const client = await createServerApiClient();
  const res = await client.GET(
    "/api/v1/workspaces/{tenantCode}/object-definitions/{objectId}",
    {
      params: { path: { tenantCode, objectId } },
    },
  );
  if (!res.data) {
    if (res.response.status < 500) notFound();
    const e = toApiError(res.error, res.response.status);
    throw Object.assign(new Error(e.message), e);
  }
  if (res.data.object.status === "ARCHIVED") notFound();
  return (
    <TableBuilder key={scopedKey} tenantCode={tenantCode} draft={res.data} />
  );
}
