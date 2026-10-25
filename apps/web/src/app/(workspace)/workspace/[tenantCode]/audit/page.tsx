import { RouteForbidden } from "@/components/feedback/route-states";
import { CompanyAuditView } from "@/features/audit/company-audit";
import { createServerApiClient } from "@/lib/api/server-client";
import { toApiError } from "@/lib/api/api-error";
import { requireWorkspace } from "@/lib/auth/require-workspace";

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WorkspaceAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  // The API refuses employees; say so instead of showing a load failure.
  if (workspace.role !== "TENANT_ADMIN") {
    return (
      <RouteForbidden
        title="仅公司管理员可查看公司审计"
        homeHref={`/workspace/${encodeURIComponent(tenantCode)}`}
      />
    );
  }
  const search = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const pageValue = Number(first(search.page));
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const date = (value: string | undefined) =>
    value && CALENDAR_DATE.test(value) ? value : undefined;
  const actorId = first(search.actorId);
  const filters = {
    action: first(search.action) || undefined,
    resourceType: first(search.resourceType) || undefined,
    actorId: actorId && UUID.test(actorId) ? actorId : undefined,
    from: date(first(search.from)),
    to: date(first(search.to)),
  };
  const client = await createServerApiClient();
  const [result, members] = await Promise.all([
    client.GET("/api/v1/workspaces/{tenantCode}/audit", {
      params: { path: { tenantCode }, query: { page, limit: 50, ...filters } },
    }),
    client.GET("/api/v1/workspaces/{tenantCode}/members", {
      params: { path: { tenantCode }, query: { page: 1, limit: 100 } },
    }),
  ]);
  if (!result.data) {
    const error = toApiError(result.error, result.response.status);
    throw Object.assign(new Error(error.message), error);
  }
  return (
    <CompanyAuditView
      data={result.data}
      filters={filters}
      basePath={`/workspace/${tenantCode}/audit`}
      members={(members.data?.items ?? []).map((member) => ({
        userId: member.userId,
        name: member.displayName ?? member.phone ?? "未设置姓名",
      }))}
    />
  );
}
