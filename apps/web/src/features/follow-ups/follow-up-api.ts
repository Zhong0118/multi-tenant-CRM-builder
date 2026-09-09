"use client";
import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";
export interface FollowUp {
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
const PATH = "/api/v1/workspaces/{tenantCode}/follow-ups" as const;
export const followUpApi = {
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
  async create(
    tenantCode: string,
    input: {
      objectCode: string;
      recordId: string;
      title: string;
      dueAt: string;
    },
  ) {
    return dataOrThrow(
      await browserApiClient.POST(PATH, {
        params: { path: { tenantCode } },
        body: input,
      }),
    );
  },
  async update(
    tenantCode: string,
    id: string,
    input: { version: number; status?: "DONE" | "CANCELLED"; dueAt?: string },
  ) {
    return dataOrThrow(
      await browserApiClient.PATCH(`${PATH}/{id}`, {
        params: { path: { tenantCode, id } },
        body: input,
      }),
    );
  },
};
