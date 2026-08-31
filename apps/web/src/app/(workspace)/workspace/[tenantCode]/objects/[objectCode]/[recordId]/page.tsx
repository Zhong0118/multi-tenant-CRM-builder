import { RecordWorkspace } from "@/features/records/record-workspace";
import { parseRecordQuery } from "@/features/records/record-query-state";
import {
  loadRecord,
  loadRecordPage,
  loadRuntimeObject,
} from "@/lib/auth/load-runtime-object";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface RecordDetailPageProps {
  params: Promise<{
    tenantCode: string;
    objectCode: string;
    recordId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * A record deep link renders the list behind the detail drawer, so closing it
 * lands back on the same filters and page instead of an empty list.
 */
export default async function RecordDetailPage({
  params,
  searchParams,
}: RecordDetailPageProps) {
  const { tenantCode, objectCode, recordId } = await params;
  const workspace = await requireWorkspace(tenantCode);
  const { schema, members, isAdmin } = await loadRuntimeObject(
    tenantCode,
    objectCode,
    workspace.role,
  );
  const rawSearchParams = await searchParams;
  const query = parseRecordQuery(rawSearchParams, schema.defaultView.sort);
  const initialEditing = rawSearchParams.mode === "edit";
  const [initialPage, record] = await Promise.all([
    loadRecordPage(tenantCode, objectCode, query),
    loadRecord(tenantCode, objectCode, recordId),
  ]);

  return (
    <RecordWorkspace
      tenantCode={tenantCode}
      schema={schema}
      query={query}
      initialPage={initialPage}
      members={members}
      isAdmin={isAdmin}
      openRecord={record}
      initialEditing={initialEditing}
    />
  );
}
