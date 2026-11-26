import { AccountShell } from "@/components/layout/account-shell";
import type { PersonalInvitation } from "@/features/invitations/invitation-api";
import { InvitationList } from "@/features/invitations/invitation-list";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";

/**
 * After registering, a person belongs to no company yet: one short panel with
 * where they are, the number to give the company admin, and any invitation
 * as soon as it arrives.
 */
export default async function WaitingPage() {
  const user = await requireUser("/waiting");
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET("/api/v1/me/invitations");
  const initialError = data ? null : toApiError(error, response.status).message;

  return (
    <AccountShell
      user={{
        displayName: user.displayName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
      }}
    >
      <InvitationList
        phone={user.phone}
        initialInvitations={(data ?? []) as PersonalInvitation[]}
        initialError={initialError}
      />
    </AccountShell>
  );
}
