import type { components } from "@crm/contracts";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

export type WorkTask = components["schemas"]["WorkTaskDto"];
export type WorkTaskPage = components["schemas"]["WorkTaskPageDto"];
export type CreateWorkTask = components["schemas"]["CreateWorkTaskDto"];
export type UpdateWorkTask = components["schemas"]["UpdateWorkTaskDto"];
export type DailyReport = components["schemas"]["DailyReportDto"];
export type DailyReportView = components["schemas"]["DailyReportViewDto"];
export type DailyReportList = components["schemas"]["DailyReportListDto"];
export type SaveDailyReport = components["schemas"]["SaveDailyReportDto"];
export type WorkCounts = components["schemas"]["TeamActivityCountsDto"];

export interface WorkTaskQuery {
  scope?: "mine" | "team";
  status?: "OPEN" | "DONE" | "CANCELLED";
  assigneeMemberId?: string;
}

function data<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

export const workApi = {
  async listTasks(tenantCode: string, query: WorkTaskQuery = {}) {
    return data(
      await browserApiClient.GET("/api/v1/workspaces/{tenantCode}/work-tasks", {
        params: {
          path: { tenantCode },
          query: { ...query, page: 1, limit: 100 },
        },
      }),
    );
  },
  async createTask(tenantCode: string, body: CreateWorkTask) {
    return data(
      await browserApiClient.POST(
        "/api/v1/workspaces/{tenantCode}/work-tasks",
        {
          params: { path: { tenantCode } },
          body,
        },
      ),
    );
  },
  async updateTask(tenantCode: string, taskId: string, body: UpdateWorkTask) {
    return data(
      await browserApiClient.PATCH(
        "/api/v1/workspaces/{tenantCode}/work-tasks/{taskId}",
        { params: { path: { tenantCode, taskId } }, body },
      ),
    );
  },
  async myReport(tenantCode: string, workDate: string) {
    return data(
      await browserApiClient.GET(
        "/api/v1/workspaces/{tenantCode}/daily-reports/{workDate}/mine",
        { params: { path: { tenantCode, workDate } } },
      ),
    );
  },
  async saveReport(
    tenantCode: string,
    workDate: string,
    body: SaveDailyReport,
  ) {
    return data(
      await browserApiClient.PUT(
        "/api/v1/workspaces/{tenantCode}/daily-reports/{workDate}/mine",
        { params: { path: { tenantCode, workDate } }, body },
      ),
    );
  },
  async reportsForDate(tenantCode: string, workDate: string) {
    return data(
      await browserApiClient.GET(
        "/api/v1/workspaces/{tenantCode}/daily-reports/{workDate}",
        { params: { path: { tenantCode, workDate } } },
      ),
    );
  },
  async memberReport(tenantCode: string, workDate: string, memberId: string) {
    return data(
      await browserApiClient.GET(
        "/api/v1/workspaces/{tenantCode}/daily-reports/{workDate}/members/{memberId}",
        { params: { path: { tenantCode, workDate, memberId } } },
      ),
    );
  },
};

export type WorkApi = typeof workApi;

export const workKeys = {
  tasks: (tenantCode: string, query: WorkTaskQuery = {}) =>
    ["workspace", tenantCode, "work-tasks", query] as const,
  allTasks: (tenantCode: string) =>
    ["workspace", tenantCode, "work-tasks"] as const,
  report: (tenantCode: string, workDate: string, memberId = "mine") =>
    ["workspace", tenantCode, "daily-report", workDate, memberId] as const,
  reports: (tenantCode: string, workDate: string) =>
    ["workspace", tenantCode, "daily-reports", workDate] as const,
};
