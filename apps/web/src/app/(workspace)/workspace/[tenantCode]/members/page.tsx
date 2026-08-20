import { InviteMemberForm } from "@/features/members/invite-member-form";
import {
  MemberTable,
  type InvitationPage,
  type TenantMemberPage,
} from "@/features/members/member-table";
import styles from "@/features/members/members.module.css";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface MembersPageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function MembersPage({ params }: MembersPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  let memberPage: TenantMemberPage = {
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    activeAdminCount: 0,
  };
  let invitationPage: InvitationPage = { items: [] };

  if (workspace.role === "TENANT_ADMIN") {
    const client = await createServerApiClient();
    const [memberResult, invitationResult] = await Promise.all([
      client.GET("/api/v1/workspaces/{tenantCode}/members", {
        params: { path: { tenantCode }, query: { page: 1, limit: 20 } },
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
      {workspace.role === "TENANT_ADMIN" ? (
        <InviteMemberForm tenantCode={tenantCode} />
      ) : null}
      <MemberTable
        tenantCode={tenantCode}
        viewerRole={workspace.role}
        initialMemberPage={memberPage}
        initialInvitationPage={invitationPage}
      />
    </main>
  );
}

function throwApiResult(result: {
  error?: unknown;
  response: Response;
}): never {
  const apiError = toApiError(result.error, result.response.status);
  throw Object.assign(new Error(apiError.message), apiError);
}
