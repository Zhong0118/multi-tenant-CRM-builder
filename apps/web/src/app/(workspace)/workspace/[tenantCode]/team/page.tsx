import { notFound } from "next/navigation";

import { TeamActivity } from "@/features/team-activity/team-activity";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function TeamActivityPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();
  return <TeamActivity tenantCode={tenantCode} memberId={workspace.memberId} />;
}
