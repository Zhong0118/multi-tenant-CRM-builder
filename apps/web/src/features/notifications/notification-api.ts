"use client";

import type { components } from "@crm/contracts";

import { relationRequest } from "@/lib/api/relation-request";

export type NotificationItem = components["schemas"]["NotificationItemDto"];
export type NotificationKind = NotificationItem["kind"];
export type NotificationPage = components["schemas"]["NotificationPageDto"];
type NotificationOk = components["schemas"]["NotificationOkDto"];
type NotificationTarget = components["schemas"]["NotificationTargetDto"];
export interface NotificationsApi {
  list(tenantCode: string, query: { page: number; limit: number; unreadOnly: boolean }): Promise<NotificationPage>;
  read(tenantCode: string, id: string): Promise<NotificationOk>;
  readAll(tenantCode: string, before: string, snapshot: string): Promise<NotificationOk>;
  target(tenantCode: string, id: string): Promise<NotificationTarget>;
}
const base = (tenant: string) => `/api/v1/workspaces/${encodeURIComponent(tenant)}/notifications`;
export const notificationsApi: NotificationsApi = {
  list: (tenant, query) => relationRequest(`${base(tenant)}?${new URLSearchParams({ page: String(query.page), limit: String(query.limit), unreadOnly: String(query.unreadOnly) })}`),
  read: (tenant, id) => relationRequest(`${base(tenant)}/${encodeURIComponent(id)}/read`, "PATCH"),
  readAll: (tenant, before, snapshot) => relationRequest(`${base(tenant)}/read-all`, "POST", { before, snapshot }),
  target: (tenant, id) => relationRequest(`${base(tenant)}/${encodeURIComponent(id)}/target`),
};
