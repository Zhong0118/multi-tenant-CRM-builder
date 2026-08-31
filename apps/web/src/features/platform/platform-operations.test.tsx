import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PlatformAuditView,
  PlatformOperationsView,
  PlatformSettingsView,
} from "./platform-operations";

describe("platform operations pages", () => {
  it("shows real audit fields and opens structured change details", () => {
    render(
      <PlatformAuditView
        data={{
          page: 1,
          limit: 20,
          total: 1,
          items: [
            {
              id: "audit-1",
              tenantId: "tenant-1",
              tenantName: "星云科技",
              actorType: "USER",
              actorId: "user-1",
              actorName: "平台管理员",
              action: "TENANT_STATUS_CHANGED",
              resourceType: "TENANT",
              resourceId: "tenant-1",
              before: { status: "DRAFT" },
              after: { status: "ACTIVE" },
              reason: "资料已确认",
              requestId: "req-1",
              ip: "203.0.113.8",
              createdAt: "2026-08-31T08:00:00.000Z",
            },
          ],
        }}
        tenants={[]}
        filters={{}}
      />,
    );

    expect(screen.getByText("星云科技")).toBeInTheDocument();
    expect(screen.getByText("公司状态变更")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getByText(/资料已确认/)).toBeInTheDocument();
    expect(screen.getByText(/DRAFT/)).toBeInTheDocument();
  });

  it("labels persisted template applications as completed operations", () => {
    render(
      <PlatformOperationsView
        data={{
          page: 1,
          limit: 20,
          total: 1,
          items: [
            {
              id: "operation-1",
              kind: "TEMPLATE_APPLICATION",
              status: "SUCCEEDED",
              templateId: "template-1",
              templateName: "标准销售流程",
              templateVersionNo: 2,
              tenantId: "tenant-1",
              tenantName: "星云科技",
              tenantCode: "nebula",
              appliedByUserId: "user-1",
              appliedByName: "平台管理员",
              objectCount: 6,
              appliedAt: "2026-08-31T08:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("标准销售流程 · V2")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("6 张业务表")).toBeInTheDocument();
  });

  it("shows action-required runtime services without exposing secrets", () => {
    render(
      <PlatformSettingsView
        status={{
          environment: "production",
          services: [
            {
              key: "sms",
              label: "短信验证码",
              status: "ACTION_REQUIRED",
              detail: "尚未接入生产短信供应商。",
            },
          ],
          policies: {
            sessionTtlDays: 30,
            sessionHistoryRetentionDays: 90,
            verificationTtlMinutes: 10,
            verificationRetentionDays: 30,
          },
        }}
      />,
    );

    expect(screen.getByText("需要配置")).toBeInTheDocument();
    expect(screen.getByText("登录历史保留 90 天")).toBeInTheDocument();
  });
});
