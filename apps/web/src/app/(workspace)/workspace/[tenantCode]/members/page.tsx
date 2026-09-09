import { MemberAdministration } from "@/features/members/member-administration";
import {
  type InvitationPage,
  type TenantMemberPage,
} from "@/features/members/member-table";
import styles from "@/features/members/members.module.css";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface MembersPageProps {
  params: Promise<{ tenantCode: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function MembersPage({
  params,
  searchParams,
}: MembersPageProps) {
  const { tenantCode } = await params;
  const page = parsePage((await searchParams).page);
  const workspace = await requireWorkspace(tenantCode);
  let memberPage: TenantMemberPage = {
    items: [],
    page,
    limit: 20,
    total: 0,
    activeAdminCount: 0,
  };
  let invitationPage: InvitationPage = { items: [] };

  if (workspace.role === "TENANT_ADMIN") {
    const client = await createServerApiClient();
    const [memberResult, invitationResult] = await Promise.all([
      client.GET("/api/v1/workspaces/{tenantCode}/members", {
        params: { path: { tenantCode }, query: { page, limit: 20 } },
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
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>PEOPLE & ACCESS</span>
        <h1>成员管理</h1>
        <p>邀请本公司员工，并控制现有成员的工作空间访问权限。</p>
      </header>
      <MemberAdministration
        key={page}
        tenantCode={tenantCode}
        viewerRole={workspace.role}
        viewerMemberId={workspace.memberId}
        initialMemberPage={memberPage}
        initialInvitationPage={invitationPage}
      />
    </main>
  );
}

function parsePage(value?: string): number {
  if (!value || !/^\d+$/.test(value)) return 1;
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
