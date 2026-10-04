import { FollowUpList } from "@/features/follow-ups/follow-up-list";
import { requireWorkspace } from "@/lib/auth/require-workspace";
export default async function FollowUpsPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  await requireWorkspace(tenantCode);
  return <FollowUpList tenantCode={tenantCode} />;
}
