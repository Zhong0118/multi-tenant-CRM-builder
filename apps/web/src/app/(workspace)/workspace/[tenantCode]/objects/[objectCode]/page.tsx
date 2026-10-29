import { renderRuntimeObjectPage } from "@/features/objects/runtime-object-state";
import { SORTABLE_FIELD_TYPES } from "@/features/objects/object-types";
import { queryFields } from "@/features/records/record-access";
import { RecordWorkspace } from "@/features/records/record-workspace";
import {
  parseRecordQuery,
  restrictRecordQuery,
} from "@/features/records/record-query-state";
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
  return renderRuntimeObjectPage(tenantCode, async () => {
    const { schema, members, isAdmin } = await loadRuntimeObject(
      tenantCode,
      objectCode,
      workspace.role,
    );
    const parsedQuery = parseRecordQuery(
      await searchParams,
      schema.defaultView.sort,
      queryFields(schema)
        .filter((field) =>
          (SORTABLE_FIELD_TYPES as readonly string[]).includes(field.type),
        )
        .map((field) => field.fieldKey),
    );
    const query = restrictRecordQuery(parsedQuery, schema);
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
  });
}
