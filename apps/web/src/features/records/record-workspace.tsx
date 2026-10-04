"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { followUpQueryKeys } from "@/features/follow-ups/follow-up-api";
import { validatedReturnTo } from "./source-navigation";
import { useEffect, useRef, useState } from "react";

import type {
  RecordPage,
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

import type { DynamicFieldMember } from "./dynamic-field";
import { RecordDetailDrawer } from "./record-detail-drawer";
import { RecordList } from "./record-list";
import { DEFAULT_RECORD_QUERY, recordQuerySearch, type RecordQuery } from "./record-query-state";

export interface RecordWorkspaceProps {
  tenantCode: string;
  currentMemberId?: string;
  schema: RuntimeObjectSchema;
  query: RecordQuery;
  initialPage: RecordPage;
  members: DynamicFieldMember[];
  isAdmin: boolean;
  openRecord?: RecordSummary;
  initialEditing?: boolean;
  followUpId?: string;
  returnTo?: string;
}

/**
 * Holds the list and the deep-linked detail together. A record URL renders the
 * list behind its drawer, so closing the drawer returns to the same filters and
 * page the member arrived with.
 */
export function RecordWorkspace(props: RecordWorkspaceProps) {
  const key = `${props.tenantCode}:${props.schema.object.code}:${props.openRecord?.id ?? "list"}:${props.openRecord?.version ?? ""}:${props.initialEditing ? "edit" : "view"}:${props.followUpId ?? ""}`;
  return <RecordWorkspaceSession key={key} {...props} />;
}

function RecordWorkspaceSession({
  tenantCode,
  currentMemberId,
  schema,
  query,
  initialPage,
  members,
  isAdmin,
  openRecord,
  initialEditing = false,
  followUpId,
  returnTo,
}: RecordWorkspaceProps) {
  const router = useRouter();
  const client = useQueryClient();
  const [record, setRecord] = useState(openRecord);
  const listRef = useRef<HTMLDivElement>(null);
  const focusRecordId = useRef<string | undefined>(undefined);
  const listPath = `/workspace/${tenantCode}/objects/${schema.object.code}`;
  const search = recordQuerySearch(query, {
    ...DEFAULT_RECORD_QUERY,
    sort: schema.defaultView.sort.field,
    direction: schema.defaultView.sort.direction,
  });
  const returnPath = validatedReturnTo(tenantCode, returnTo) ?? `${listPath}${search ? `?${search}` : ""}`;

  useEffect(() => {
    if (record || !focusRecordId.current) return;
    const path = `${listPath}/${encodeURIComponent(focusRecordId.current)}`;
    const link = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])
      .find((anchor) => new URL(anchor.href).pathname === path && anchor.getClientRects().length > 0);
    link?.focus({ preventScroll: true });
    focusRecordId.current = undefined;
  }, [record, listPath]);

  return (
    <>
      <div ref={listRef}>
        <RecordList
          currentMemberId={currentMemberId}
          tenantCode={tenantCode}
          schema={schema}
          query={query}
          initialPage={initialPage}
          members={members}
          canFilterByOwner={isAdmin}
        />
      </div>
      {record ? (
        <RecordDetailDrawer
          tenantCode={tenantCode}
          schema={schema}
          record={record}
          members={members}
          canChooseOwner={isAdmin}
          canDelete={isAdmin && schema.actions.canDelete}
          initialEditing={initialEditing}
          followUpId={followUpId}
          onClose={() => {
            if (!validatedReturnTo(tenantCode, returnTo)) focusRecordId.current = record.id;
            setRecord(undefined);
            router.replace(returnPath);
          }}
          onChanged={async (next) => {
            setRecord(next ?? undefined);
            await Promise.all([
              client.invalidateQueries({ queryKey: ["workspace", tenantCode, "records"] }),
              client.invalidateQueries({ queryKey: followUpQueryKeys.root(tenantCode) }),
            ]);
            router.refresh();
            if (!next) router.replace(returnPath);
          }}
        />
      ) : null}
    </>
  );
}
