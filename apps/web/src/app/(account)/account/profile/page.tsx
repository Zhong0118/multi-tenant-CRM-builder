import { AccountShell } from "@/components/layout/account-shell";
import { PageHeader } from "@/components/layout/page-header";
import { AccountProfile } from "@/features/profile/account-profile";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";

export default async function AccountProfilePage() {
  const user = await requireUser("/account/profile");
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET("/api/v1/me/memberships");
  if (!data) {
    const failure = toApiError(error, response.status);
    throw Object.assign(new Error(failure.message), failure);
  }
  return (
    <AccountShell
      current="profile"
      user={{
        displayName: user.displayName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
      }}
    >
      <PageHeader title="个人资料" />
      <AccountProfile
        name={user.displayName}
        avatarUrl={user.avatarUrl}
        memberships={data}
      />
    </AccountShell>
  );
}
