import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MemberObjectAccess,
  type MemberObjectAccessRow,
} from "@/features/members/member-object-access";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface MemberAccessPageProps {
  params: Promise<{ tenantCode: string; memberId: string }>;
}

export default async function MemberAccessPage({
  params,
}: MemberAccessPageProps) {
  const { tenantCode, memberId } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  const client = await createServerApiClient();
  const [accessResult, memberResult] = await Promise.all([
    client.GET(
      "/api/v1/workspaces/{tenantCode}/members/{memberId}/object-access",
      { params: { path: { tenantCode, memberId } } },
    ),
    client.GET("/api/v1/workspaces/{tenantCode}/members", {
      params: { path: { tenantCode }, query: { page: 1, limit: 100 } },
    }),
  ]);

  // The API only exposes access for an active employee, so anything else —
  // an administrator, a disabled member, another tenant — is a not-found.
  if (!accessResult.data) {
    if (accessResult.response.status < 500) notFound();
    const apiError = toApiError(
      accessResult.error,
      accessResult.response.status,
    );
    throw Object.assign(new Error(apiError.message), apiError);
  }

  const member = memberResult.data?.items.find(
    (candidate) => candidate.id === memberId,
  );
  const memberName = member?.displayName ?? "该成员";

  return (
    <Page width="settings">
      <PageHeader
        breadcrumb={<Link href={`/workspace/${tenantCode}/members`}>成员</Link>}
        title={`${memberName}的访问权限`}
        description="按业务表设置这位员工能做什么、能看到哪些记录，以及每个字段可编辑、只读还是隐藏。"
      />
      <MemberObjectAccess
        tenantCode={tenantCode}
        memberId={memberId}
        memberName={memberName}
        initialRows={accessResult.data as MemberObjectAccessRow[]}
      />
    </Page>
  );
}
