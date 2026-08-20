import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import {
  InvitationDetail,
  type InvitationApi,
  type PersonalInvitation,
} from "./invitation-detail";

const pendingInvitation: PersonalInvitation = {
  id: "invitation-a",
  tenantId: "tenant-a",
  tenantCode: "northwind",
  tenantName: "北辰客户服务",
  targetPhone: "+8613800138000",
  role: "EMPLOYEE",
  status: "PENDING",
  expiresAt: "2026-08-23T08:00:00.000Z",
};

function createApi(): InvitationApi {
  return {
    accept: vi.fn().mockResolvedValue({
      id: "member-a",
      tenantId: "tenant-a",
      userId: "user-a",
      role: "EMPLOYEE",
      status: "ACTIVE",
    }),
    decline: vi.fn().mockResolvedValue({ accepted: true }),
    listWorkspaces: vi.fn().mockResolvedValue([
      {
        tenantId: "tenant-a",
        tenantCode: "northwind",
        tenantName: "北辰客户服务",
        tenantStatus: "ACTIVE",
        memberId: "member-a",
        memberStatus: "ACTIVE",
        role: "EMPLOYEE",
      },
    ]),
  };
}

describe("InvitationDetail", () => {
  it.each([
    ["PENDING", false],
    ["ACCEPTED", true],
    ["DECLINED", true],
    ["REVOKED", true],
    ["EXPIRED", true],
  ] as const)(
    "enables actions only for a %s invitation",
    (status, disabled) => {
      render(
        <InvitationDetail
          invitation={{ ...pendingInvitation, status }}
          api={createApi()}
          onNavigate={vi.fn()}
        />,
      );

      expect(screen.getByRole("button", { name: "接受邀请" })).toHaveProperty(
        "disabled",
        disabled,
      );
      expect(screen.getByRole("button", { name: "拒绝邀请" })).toHaveProperty(
        "disabled",
        disabled,
      );
    },
  );

  it("hides tenant-sensitive details for an unavailable or mismatched invitation", () => {
    render(
      <InvitationDetail unavailable api={createApi()} onNavigate={vi.fn()} />,
    );

    expect(screen.getByText("邀请不可用")).toBeInTheDocument();
    expect(screen.queryByText("北辰客户服务")).not.toBeInTheDocument();
    expect(screen.queryByText("northwind")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "接受邀请" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["ACCEPTED", "该邀请已接受"],
    ["DECLINED", "你已拒绝该邀请"],
    ["REVOKED", "该邀请已由公司管理员撤销"],
    ["EXPIRED", "该邀请已过期"],
  ] as const)("shows a result panel for a %s invitation", (status, result) => {
    render(
      <InvitationDetail
        invitation={{ ...pendingInvitation, status }}
        api={createApi()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(result);
  });

  it("disables both actions while accepting and enters the sole active workspace", async () => {
    let finishAccept:
      | ((value: Awaited<ReturnType<InvitationApi["accept"]>>) => void)
      | undefined;
    const api = createApi();
    vi.mocked(api.accept).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishAccept = resolve;
        }),
    );
    const onNavigate = vi.fn();
    render(
      <InvitationDetail
        invitation={pendingInvitation}
        api={api}
        onNavigate={onNavigate}
      />,
    );

    const acceptButton = screen.getByRole("button", { name: "接受邀请" });
    const declineButton = screen.getByRole("button", { name: "拒绝邀请" });
    fireEvent.click(acceptButton);
    await waitFor(() => {
      expect(acceptButton).toBeDisabled();
      expect(declineButton).toBeDisabled();
    });

    finishAccept?.({
      id: "member-a",
      tenantId: "tenant-a",
      userId: "user-a",
      role: "EMPLOYEE",
      status: "ACTIVE",
    });

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith("/workspace/northwind"),
    );
  });
});
