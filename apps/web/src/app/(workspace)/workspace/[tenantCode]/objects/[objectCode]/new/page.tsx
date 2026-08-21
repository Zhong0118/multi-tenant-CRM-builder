import { notFound } from "next/navigation";

import { NewRecordPanel } from "@/features/records/new-record-panel";
import { loadRuntimeObject } from "@/lib/auth/load-runtime-object";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface NewRecordPageProps {
  params: Promise<{ tenantCode: string; objectCode: string }>;
}

export default async function NewRecordPage({ params }: NewRecordPageProps) {
  const { tenantCode, objectCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  const { schema, members, isAdmin } = await loadRuntimeObject(
    tenantCode,
    objectCode,
    workspace.role,
  );

  // Creating without the action is a not-found, not a form that fails on submit.
  if (!schema.actions.canCreate) notFound();

  return (
    <NewRecordPanel
      tenantCode={tenantCode}
      schema={schema}
      members={members}
      canChooseOwner={isAdmin}
    />
  );
}
