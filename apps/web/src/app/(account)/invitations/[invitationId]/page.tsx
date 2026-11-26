import { AccountShell } from "@/components/layout/account-shell";

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
    <AccountShell
      user={{
        displayName: user.displayName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
      }}
    >
      <InvitationDetail invitation={data} unavailable={!data} />
    </AccountShell>
  );
}
