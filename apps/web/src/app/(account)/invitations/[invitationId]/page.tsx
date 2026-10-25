import Link from "next/link";

import { AccountShell } from "@/components/layout/account-shell";
import { PageHeader } from "@/components/layout/page-header";

import { InvitationDetail } from "@/features/invitations/invitation-detail";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";

export interface InvitationPageProps {
  params: Promise<{ invitationId: string }>;
}

export default async function InvitationPage({ params }: InvitationPageProps) {
  const { invitationId } = await params;
  const user = await requireUser(
    `/invitations/${encodeURIComponent(invitationId)}`,
  );
  const client = await createServerApiClient();
  const { data, response } = await client.GET(
    "/api/v1/me/invitations/{invitationId}",
    { params: { path: { invitationId } } },
  );

  if (!data && response.status >= 500) {
    throw new Error("邀请详情暂时不可用。");
  }

  return (
    <AccountShell platformAdmin={user.isPlatformAdmin}>
      <PageHeader
        breadcrumb={<Link href="/waiting">我的邀请</Link>}
        title="确认公司邀请"
        description="接受前请核对公司、角色和有效期。"
      />
      <InvitationDetail invitation={data} unavailable={!data} />
    </AccountShell>
  );
}
