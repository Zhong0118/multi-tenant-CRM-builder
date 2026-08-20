import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { InviteMemberForm } from "./invite-member-form";
import {
  MemberTable,
  type MemberApi,
  type TenantInvitation,
  type TenantMember,
} from "./member-table";

const members: TenantMember[] = [
  {
    id: "member-admin",
    userId: "user-admin",
    tenantId: "tenant-a",
    displayName: "陈管理员",
    phone: "+8613800138000",
    role: "TENANT_ADMIN",
    status: "ACTIVE",
  },
  {
    id: "member-employee",
    userId: "user-employee",
    tenantId: "tenant-a",
    displayName: "林员工",
    phone: "+8613900139000",
    role: "EMPLOYEE",
    status: "ACTIVE",
  },
];

const invitations: TenantInvitation[] = [
  {
    id: "invite-a",
    targetPhone: "+8613700137000",
    targetUserId: null,
    role: "EMPLOYEE",
    status: "PENDING",
    expiresAt: "2026-08-28T00:00:00.000Z",
    createdAt: "2026-08-21T00:00:00.000Z",
  },
];

function memberApi(): MemberApi {
  return {
    listMembers: vi.fn().mockResolvedValue({
      items: members,
      page: 1,
      limit: 20,
      total: 2,
      activeAdminCount: 1,
    }),
    listInvitations: vi.fn().mockResolvedValue({ items: invitations }),
    invite: vi.fn().mockResolvedValue({ id: "invite-b", status: "PENDING" }),
    resend: vi.fn().mockResolvedValue({
      accepted: true,
      expiresAt: "2026-08-28T00:00:00.000Z",
    }),
    revoke: vi.fn().mockResolvedValue({ accepted: true }),
    changeMemberStatus: vi.fn().mockResolvedValue({
      ...members[1],
      status: "DISABLED",
    }),
  };
}

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

const initialMemberPage = {
  items: members,
  page: 1,
  limit: 20,
  total: 2,
  activeAdminCount: 1,
};

describe("MemberTable", () => {
  it("shows a no-access result to employees", () => {
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="EMPLOYEE"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: invitations }}
        api={memberApi()}
      />,
    );

    expect(screen.getByText("仅公司管理员可管理成员")).toBeInTheDocument();
    expect(screen.queryByText("陈管理员")).not.toBeInTheDocument();
  });

  it("offers pending invitation and active member actions while protecting the final admin", () => {
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: invitations }}
        api={memberApi()}
      />,
    );

    expect(screen.getByRole("button", { name: "重新发送" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "撤销邀请" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "停用 林员工" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "停用 陈管理员" }),
    ).toBeDisabled();
  });

  it("invites a member by phone and role", async () => {
    const api = memberApi();
    const onInvitationCreated = vi.fn();
    const { client } = renderWithQuery(
      <InviteMemberForm
        tenantCode="northwind"
        api={api}
        onInvitationCreated={onInvitationCreated}
      />,
    );
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.change(screen.getByLabelText("成员手机号"), {
      target: { value: "13700137000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送邀请" }));

    await waitFor(() =>
      expect(api.invite).toHaveBeenCalledWith("northwind", {
        phone: "13700137000",
        role: "EMPLOYEE",
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["workspace", "northwind", "invitations"],
      exact: false,
    });
    expect(onInvitationCreated).toHaveBeenCalledOnce();
  });

  it("writes member pagination to the page URL", () => {
    const navigate = vi.fn();
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialMemberPage={{ ...initialMemberPage, total: 21 }}
        initialInvitationPage={{ items: invitations }}
        api={memberApi()}
        navigate={navigate}
      />,
    );

    const next = screen
      .getAllByRole("button", { name: "right" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(next).toBeTruthy();
    fireEvent.click(next!);
    expect(navigate).toHaveBeenCalledWith(
      "/workspace/northwind/members?page=2",
    );
  });
});
