"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  RecordPage,
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

import type { DynamicFieldMember } from "./dynamic-field";
import { RecordDetailDrawer } from "./record-detail-drawer";
import { RecordList } from "./record-list";
import type { RecordQuery } from "./record-query-state";

export interface RecordWorkspaceProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  query: RecordQuery;
  initialPage: RecordPage;
  members: DynamicFieldMember[];
  isAdmin: boolean;
  openRecord?: RecordSummary;
  initialEditing?: boolean;
}

/**
 * Holds the list and the deep-linked detail together. A record URL renders the
 * list behind its drawer, so closing the drawer returns to the same filters and
 * page the member arrived with.
 */
export function RecordWorkspace({
  tenantCode,
  schema,
  query,
  initialPage,
  members,
  isAdmin,
  openRecord,
  initialEditing = false,
}: RecordWorkspaceProps) {
  const router = useRouter();
  const [record, setRecord] = useState(openRecord);
  const listPath = `/workspace/${tenantCode}/objects/${schema.object.code}`;

  return (
    <>
      <RecordList
        tenantCode={tenantCode}
        schema={schema}
        query={query}
        initialPage={initialPage}
        members={members}
        canFilterByOwner={isAdmin}
      />
      {record ? (
        <RecordDetailDrawer
          tenantCode={tenantCode}
          schema={schema}
          record={record}
          members={members}
          canChooseOwner={isAdmin}
          canDelete={isAdmin && schema.actions.canDelete}
          initialEditing={initialEditing}
          onClose={() => {
            setRecord(undefined);
            router.back();
          }}
          onChanged={(next) => {
            setRecord(next ?? undefined);
            router.refresh();
            if (!next) router.replace(listPath);
          }}
        />
      ) : null}
    </>
  );
}
