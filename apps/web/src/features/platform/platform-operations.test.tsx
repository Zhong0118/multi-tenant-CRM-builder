import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlatformAuditView } from "./platform-audit";
import {
  PlatformOperationsView,
  PlatformSettingsView,
} from "./platform-operations";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

    const entry = screen.getByRole("button", { name: /平台管理员.*查看详情/ });
    expect(entry).toHaveTextContent("公司状态变更");
    expect(entry).toHaveTextContent("星云科技");
    expect(entry).toHaveTextContent("草稿 → 运行中");
    fireEvent.click(entry);
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("资料已确认")).toBeInTheDocument();
    const changes = within(drawer).getByRole("table");
    expect(within(changes).getByText("状态")).toBeInTheDocument();
    expect(within(changes).getByText("草稿")).toBeInTheDocument();
    expect(within(changes).getByText("运行中")).toBeInTheDocument();
    // The stored snapshot stays available, folded under 原始数据.
    expect(within(drawer).getByText("原始数据")).toBeInTheDocument();
    expect(within(drawer).getByText(/"status": "DRAFT"/)).toBeInTheDocument();
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

    expect(screen.getByText("应用「标准销售流程」v2")).toBeInTheDocument();
    expect(screen.getByText("已生成")).toBeInTheDocument();
    expect(screen.getByText("6 张业务表草稿")).toBeInTheDocument();
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
        checkedAt="2026-10-25T02:05:00.000Z"
      />,
    );

    expect(screen.getByText("只读")).toBeInTheDocument();
    expect(screen.getByText("1 项需要留意")).toBeInTheDocument();
    expect(screen.getByText(/北京时间 10:05/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("需要处理")).toBeInTheDocument();
    expect(
      screen.getByText("登录历史保留").nextElementSibling,
    ).toHaveTextContent("90 天");
  });
});
