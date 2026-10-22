"use client";

import { Alert, Button } from "antd";
import { toApiError } from "@/lib/api/api-error";
import { RecordPoolSettings } from "./record-pool";
import { recordPoolApi } from "./record-pool-api";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { followUpQueryKeys } from "@/features/follow-ups/follow-up-api";
import { markSourceReturnFocus, validatedReturnTo } from "./source-navigation";
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

// Closing a record navigates to the list route, which mounts a new workspace
// and a new list. The row to focus has to outlive the workspace that closed it.
let pendingListFocus: { path: string; until: number } | undefined;

/**
 * Holds the list and the deep-linked detail together. A record URL renders the
 * list behind its drawer, so closing the drawer returns to the same filters and
 * page the member arrived with.
 */
export function RecordWorkspace(props: RecordWorkspaceProps) {
  const key = `${props.tenantCode}:${props.schema.object.code}:${props.openRecord?.id ?? "list"}:${props.initialEditing ? "edit" : "view"}:${props.followUpId ?? ""}`;
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
  const [poolSettingsOpen, setPoolSettingsOpen] = useState(false);
  const poolKey = ["workspace", tenantCode, "pool-config", schema.object.code];
  const pool = useQuery({ queryKey: poolKey, queryFn: () => recordPoolApi.getConfig(tenantCode, schema.object.code), staleTime: 0 });
  // A refreshed server render carries the same record at a newer version. It
  // updates the open drawer in place, so an edit started after an earlier save
  // keeps its draft; a different record changes the session key instead.
  const [serverRecord, setServerRecord] = useState(openRecord);
  if (serverRecord !== openRecord) {
    setServerRecord(openRecord);
    // A refresh can land after close or delete, before their route change does.
    if (record) setRecord(openRecord);
  }
  const listRef = useRef<HTMLDivElement>(null);
  const listPath = `/workspace/${tenantCode}/objects/${schema.object.code}`;
  const search = recordQuerySearch(query, {
    ...DEFAULT_RECORD_QUERY,
    sort: schema.defaultView.sort.field,
    direction: schema.defaultView.sort.direction,
  });
  const returnPath = validatedReturnTo(tenantCode, returnTo) ?? `${listPath}${search ? `?${search}` : ""}`;

  useEffect(() => {
    const pending = pendingListFocus;
    if (record || !pending || pending.until < Date.now()) return;
    const link = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])
      .find((anchor) => new URL(anchor.href).pathname === pending.path && anchor.getClientRects().length > 0);
    link?.focus({ preventScroll: true });
    // The closing workspace focuses its own list too; only the list route's
    // workspace, which opened without a record, settles the request.
    if (!openRecord) pendingListFocus = undefined;
  }, [record, openRecord]);

  return (
    <>
      {pool.isError ? <Alert type="error" title="公共池设置加载失败" description={toApiError(pool.error).message} action={<Button onClick={() => pool.refetch()}>重试设置</Button>} /> : null}
      {poolSettingsOpen && pool.data && isAdmin ? <RecordPoolSettings
        tenantCode={tenantCode} objectCode={schema.object.code} config={pool.data}
        onClose={() => setPoolSettingsOpen(false)}
        onSaved={async (config) => {
          client.setQueryData(poolKey, (previous: typeof config | undefined) => ({ ...previous, ...config }));
          const recordsKey = ["workspace", tenantCode, "records", schema.object.code];
          const poolQueries = {
            queryKey: recordsKey,
            predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => {
              const cachedQuery = queryKey[4];
              return typeof cachedQuery === "object" && cachedQuery !== null &&
                (("scope" in cachedQuery && cachedQuery.scope === "pool") || ("poolStage" in cachedQuery && (cachedQuery.poolStage === "LEAD_POOL" || cachedQuery.poolStage === "CUSTOMER_POOL")));
            },
          };
          if (!config.enabled) {
            await client.cancelQueries(poolQueries);
            client.removeQueries(poolQueries);
          }
          if (!config.enabled && (query.scope || query.poolStage)) {
            const nextSearch = recordQuerySearch({ ...query, scope: undefined, poolStage: undefined, page: 1, ownerMemberId: undefined }, { ...DEFAULT_RECORD_QUERY, sort: schema.defaultView.sort.field, direction: schema.defaultView.sort.direction });
            router.replace(`${listPath}${nextSearch ? `?${nextSearch}` : ""}`);
          }
          await client.invalidateQueries({ queryKey: poolKey, exact: true }, { throwOnError: true });
          await client.invalidateQueries({
            queryKey: recordsKey,
            predicate: (cached) => config.enabled || !poolQueries.predicate(cached),
            refetchType: "all",
          }, { throwOnError: true });
          router.refresh();
        }}
      /> : null}
      <div ref={listRef}>
        <RecordList
          currentMemberId={currentMemberId}
          tenantCode={tenantCode}
          schema={schema}
          query={query}
          initialPage={initialPage}
          members={members}
          canFilterByOwner={isAdmin}
          poolConfig={pool.data}
          onPoolSettings={pool.data ? () => setPoolSettingsOpen(true) : undefined}
        />
      </div>
      {record ? (
        <RecordDetailDrawer
          tenantCode={tenantCode}
          schema={schema}
          record={record}
          members={members}
          currentMemberId={currentMemberId}
          canChooseOwner={isAdmin}
          poolConfig={pool.data}
          canDelete={isAdmin && schema.actions.canDelete}
          initialEditing={initialEditing}
          followUpId={followUpId}
          onClose={() => {
            if (!validatedReturnTo(tenantCode, returnTo)) {
              pendingListFocus = { path: `${listPath}/${encodeURIComponent(record.id)}`, until: Date.now() + 3000 };
            }
            markSourceReturnFocus(tenantCode, returnTo);
            setRecord(undefined);
            router.replace(returnPath);
          }}
          onChanged={async (next) => {
            if (next) setRecord(next);
            await Promise.all([
              client.invalidateQueries({ queryKey: ["workspace", tenantCode, "records"], refetchType: "all" }, { throwOnError: true }),
              client.invalidateQueries({ queryKey: followUpQueryKeys.root(tenantCode), refetchType: "all" }, { throwOnError: true }),
            ]);
            // Next refresh starts a server render; it does not return its completion.
            router.refresh();
            if (!next) setRecord(undefined);
            if (!next) {
              markSourceReturnFocus(tenantCode, returnTo);
              router.replace(returnPath);
            }
          }}
        />
      ) : null}
    </>
  );
}
