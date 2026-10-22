import { MyWork } from "@/features/work/my-work";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export default async function WorkPage({
  params,
}: {
  params: Promise<{ tenantCode: string }>;
}) {
  const { tenantCode } = await params;
  await requireWorkspace(tenantCode);
  return <MyWork tenantCode={tenantCode} />;
}
