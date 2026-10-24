import { MemberAdministration } from "@/features/members/member-administration";
import {
  type InvitationPage,
  type MemberListFilters,
  type TenantMemberPage,
} from "@/features/members/member-table";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface MembersPageProps {
  params: Promise<{ tenantCode: string }>;
  searchParams: Promise<{
    page?: string | string[];
    limit?: string | string[];
    q?: string | string[];
    role?: string | string[];
    status?: string | string[];
  }>;
}

export default async function MembersPage({
  params,
  searchParams,
}: MembersPageProps) {
  const { tenantCode } = await params;
  const query = await searchParams;
  const page = parsePage(query.page);
  const limit =
    typeof query.limit === "string" &&
    [20, 50, 100].includes(Number(query.limit))
      ? Number(query.limit)
      : 20;
  const search = typeof query.q === "string" ? query.q.trim() : "";
  const initialFilters: MemberListFilters = {
    ...(search ? { q: search } : {}),
    ...(query.role === "TENANT_ADMIN" || query.role === "EMPLOYEE"
      ? { role: query.role }
      : {}),
    ...(query.status === "ACTIVE" || query.status === "DISABLED"
      ? { status: query.status }
      : {}),
  };
  const workspace = await requireWorkspace(tenantCode);
  let memberPage: TenantMemberPage = {
    items: [],
    page,
    limit,
    total: 0,
    activeAdminCount: 0,
  };
  let invitationPage: InvitationPage = { items: [] };

  if (workspace.role === "TENANT_ADMIN") {
    const client = await createServerApiClient();
    const [memberResult, invitationResult] = await Promise.all([
      client.GET("/api/v1/workspaces/{tenantCode}/members", {
        params: {
          path: { tenantCode },
          query: { page, limit, ...initialFilters },
        },
      }),
      client.GET("/api/v1/workspaces/{tenantCode}/invitations", {
        params: { path: { tenantCode }, query: {} },
      }),
    ]);
    if (!memberResult.data) throwApiResult(memberResult);
    if (!invitationResult.data) throwApiResult(invitationResult);
    memberPage = memberResult.data;
    invitationPage = invitationResult.data;
  }

  return (
    <MemberAdministration
      key={page}
      tenantCode={tenantCode}
      viewerRole={workspace.role}
      viewerMemberId={workspace.memberId}
      initialMemberPage={memberPage}
      initialFilters={initialFilters}
      initialInvitationPage={invitationPage}
    />
  );
}

function parsePage(value?: string | string[]): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function throwApiResult(result: {
  error?: unknown;
  response: Response;
}): never {
  const apiError = toApiError(result.error, result.response.status);
  throw Object.assign(new Error(apiError.message), apiError);
}
