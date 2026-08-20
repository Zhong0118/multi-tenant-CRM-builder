import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { WorkspaceList, type WorkspaceView } from "./workspace-list";

const workspaces: WorkspaceView[] = [
  {
    tenantId: "tenant-active",
    tenantCode: "northwind",
    tenantName: "北辰客户服务",
    tenantStatus: "ACTIVE",
    memberId: "member-active",
    memberStatus: "ACTIVE",
    role: "TENANT_ADMIN",
    lastAccessedAt: "2026-08-20T08:00:00.000Z",
  },
  {
    tenantId: "tenant-suspended",
    tenantCode: "suspended",
    tenantName: "暂停服务公司",
    tenantStatus: "SUSPENDED",
    memberId: "member-suspended",
    memberStatus: "ACTIVE",
    role: "EMPLOYEE",
  },
  {
    tenantId: "tenant-disabled",
    tenantCode: "disabled",
    tenantName: "成员停用公司",
    tenantStatus: "ACTIVE",
    memberId: "member-disabled",
    memberStatus: "DISABLED",
    role: "EMPLOYEE",
  },
];

describe("WorkspaceList", () => {
  it("links active workspaces and keeps inactive entries visible with reasons", () => {
    render(<WorkspaceList workspaces={workspaces} onNavigate={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: /进入北辰客户服务/ }),
    ).toHaveAttribute("href", "/workspace/northwind");
    expect(screen.getByText("公司工作区已暂停")).toBeInTheDocument();
    expect(screen.getByText("你的成员资格已停用")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /进入暂停服务公司/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /进入成员停用公司/ }),
    ).not.toBeInTheDocument();
  });

  it("automatically enters the only active workspace", async () => {
    const onNavigate = vi.fn();
    render(<WorkspaceList workspaces={workspaces} onNavigate={onNavigate} />);

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith("/workspace/northwind"),
    );
  });
});
