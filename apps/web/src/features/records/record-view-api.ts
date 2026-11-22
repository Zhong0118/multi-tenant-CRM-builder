"use client";

import {
  parseFilterRule,
  type components,
  type FilterRule,
} from "@crm/contracts";
import { useQuery } from "@tanstack/react-query";
import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";

type Schemas = components["schemas"];
type ViewResponse = Schemas["RecordViewResponseDto"];
export type RecordViewQueryOptions = Schemas["RecordViewQueryOptionsDto"];
export type RecordView = Omit<ViewResponse, "filterRule"> & {
  filterRule?: FilterRule;
};
export type RecordViewDraft = {
  filterRule: FilterRule;
  queryOptions: RecordViewQueryOptions;
  sort: Schemas["RecordViewSortDto"];
  columnFieldKeys: string[];
  columnWidths: Record<string, number>;
};
const collection =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/record-views";
const individual = `${collection}/{viewId}` as const;

function readView(raw: ViewResponse): RecordView {
  const { filterRule, ...view } = raw;
  return view.available
    ? { ...view, filterRule: parseFilterRule(filterRule) }
    : view;
}

export const recordViewApi = {
  async list(tenantCode: string, objectCode: string) {
    const data = await dataOrThrow(
      await browserApiClient.GET(collection, {
        params: { path: { tenantCode, objectCode } },
      }),
    );
    return data.items.map(readView);
  },
  async create(
    tenantCode: string,
    objectCode: string,
    body: Schemas["CreateRecordViewDto"],
  ) {
    return readView(
      await dataOrThrow(
        await browserApiClient.POST(collection, {
          params: { path: { tenantCode, objectCode } },
          body,
        }),
      ),
    );
  },
  async update(
    tenantCode: string,
    objectCode: string,
    viewId: string,
    body: Schemas["UpdateRecordViewDto"],
  ) {
    return readView(
      await dataOrThrow(
        await browserApiClient.PATCH(individual, {
          params: { path: { tenantCode, objectCode, viewId } },
          body,
        }),
      ),
    );
  },
  async archive(
    tenantCode: string,
    objectCode: string,
    viewId: string,
    expectedRevision: number,
  ) {
    const { response, error } = await browserApiClient.DELETE(individual, {
      params: { path: { tenantCode, objectCode, viewId } },
      body: { expectedRevision },
    });
    if (!response.ok) throw toApiError(error, response.status);
  },
};

export const recordViewsKey = (
  tenantCode: string,
  objectCode: string,
  memberId?: string,
) => ["record-views", tenantCode, objectCode, memberId] as const;

export function useRecordViews(
  tenantCode: string,
  objectCode: string,
  memberId?: string,
) {
  return useQuery({
    queryKey: recordViewsKey(tenantCode, objectCode, memberId),
    enabled: !!memberId,
    queryFn: () => recordViewApi.list(tenantCode, objectCode),
  });
}
