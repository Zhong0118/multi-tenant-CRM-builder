"use client";
import type { components } from "@crm/contracts";
import { relationRequest } from "@/lib/api/relation-request";
import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";
export interface FollowUp {
  assigneeMemberId?: string;
  assigneeName?: string;
  id: string;
  recordId: string;
  recordTitle: string;
  objectCode: string;
  objectName: string;
  title: string;
  dueAt: string;
  status: string;
  version: number;
  overdue: boolean;
  canManage: boolean;
}
export interface FollowUpPage {
  items: FollowUp[];
  total: number;
  page: number;
  limit: number;
  openCount: number;
  overdueCount: number;
}
export type FollowUpStatus = "OPEN" | "OVERDUE" | "DONE" | "CANCELLED";

type Schemas = components["schemas"];
export type FollowUpWorkbench = Schemas["FollowUpWorkbenchResponseDto"];
export type FollowUpWorkbenchItem = Schemas["FollowUpWorkbenchItemDto"];

/**
 * One key prefix for everything a follow-up mutation has to refresh. The full
 * Follow-up page and the personal Workbench both hang off it, so completing an
 * item on the home page cannot leave the list page showing a stale item.
 */
export const followUpQueryKeys = {
  root: (tenantCode: string) =>
    ["workspace", tenantCode, "follow-ups"] as const,
  workbench: (tenantCode: string) =>
    ["workspace", tenantCode, "follow-ups", "workbench"] as const,
};

const PATH = "/api/v1/workspaces/{tenantCode}/follow-ups" as const;
const WORKBENCH_PATH =
  "/api/v1/workspaces/{tenantCode}/follow-ups/workbench" as const;
export const followUpApi = {
  async recipients(
    tenantCode: string,
    id: string,
  ): Promise<Array<{ id: string; displayName: string }>> {
    return relationRequest(
      `/api/v1/workspaces/${encodeURIComponent(tenantCode)}/follow-ups/${encodeURIComponent(id)}/recipients`,
    );
  },
  async list(
    tenantCode: string,
    query: {
      status?: FollowUpStatus;
      recordId?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<FollowUpPage> {
    return dataOrThrow(
      await browserApiClient.GET(PATH, {
        params: { path: { tenantCode }, query },
      }),
    );
  },
  /**
   * The personal Workbench. It sends no actor parameter — the server derives
   * tenant, member and role — so "my follow-ups" can never become "someone
   * else's follow-ups" from the browser.
   */
  async workbench(tenantCode: string): Promise<FollowUpWorkbench> {
    return dataOrThrow(
      await browserApiClient.GET(WORKBENCH_PATH, {
        params: { path: { tenantCode } },
      }),
    );
  },
  async create(
    tenantCode: string,
    input: {
      objectCode: string;
      recordId: string;
      title: string;
      dueAt: string;
    },
  ) {    return dataOrThrow(
      await browserApiClient.POST(PATH, {
        params: { path: { tenantCode } },
        body: input,
      }),
    );
  },
  async update(
    tenantCode: string,
    id: string,
    input: {
      version: number;
      assigneeMemberId?: string;
      status?: "DONE" | "CANCELLED";
      dueAt?: string;
    },
  ) {
    return dataOrThrow(
      await browserApiClient.PATCH(`${PATH}/{id}`, {
        params: { path: { tenantCode, id } },
        body: input,
      }),
    );
  },
};
