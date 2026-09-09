import { SORTABLE_FIELD_TYPES } from "@/features/objects/object-types";
import { RecordWorkspace } from "@/features/records/record-workspace";
import { parseRecordQuery } from "@/features/records/record-query-state";
import {
  loadRecordPage,
  loadRuntimeObject,
} from "@/lib/auth/load-runtime-object";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface ObjectRecordsPageProps {
  params: Promise<{ tenantCode: string; objectCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ObjectRecordsPage({
  params,
  searchParams,
}: ObjectRecordsPageProps) {
  const { tenantCode, objectCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  const { schema, members, isAdmin } = await loadRuntimeObject(
    tenantCode,
    objectCode,
    workspace.role,
  );
  const query = parseRecordQuery(
    await searchParams,
    schema.defaultView.sort,
    schema.fields
      .filter((field) =>
        (SORTABLE_FIELD_TYPES as readonly string[]).includes(field.type),
      )
      .map((field) => field.fieldKey),
  );
  const initialPage = await loadRecordPage(tenantCode, objectCode, query);

  return (
    <RecordWorkspace
      currentMemberId={workspace.memberId}
      tenantCode={tenantCode}
      schema={schema}
      query={query}
      initialPage={initialPage}
      members={members}
      isAdmin={isAdmin}
    />
  );
}
