import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

/**
 * `getByRole(role, { name })` computes an accessible name for every candidate
 * element, and jsdom's style resolution under Ant Design's stylesheet makes
 * each of those calls take seconds. These helpers resolve the same controls by
 * their rendered text, which is equivalent for a plain button and keeps the
 * assertion synchronous instead of racing the test timeout.
 */
function buttonByText(label: string): HTMLElement {
  const button = screen.getByText(label).closest("button");
  if (!button) throw new Error(`No button renders the text "${label}"`);
  return button;
}

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

  it("says plainly when nothing is waiting instead of a bare empty table and pager", () => {
    const api = memberApi();
    vi.mocked(api.listInvitations).mockResolvedValue({ items: [] });
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: [] }}
        api={api}
      />,
    );

    // Invitations are a tab beside the roster, not a permanent empty table.
    expect(screen.queryByText("没有待处理的邀请。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /邀请/ }));
    expect(screen.getByText("没有待处理的邀请。")).toBeInTheDocument();
    expect(document.querySelector(".ant-pagination")).toBeNull();
    expect(screen.queryByText("每页 20 条")).not.toBeInTheDocument();
  });

  it("offers pending invitation and active member actions while protecting the final admin", async () => {
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: invitations }}
        api={memberApi()}
      />,
    );

    // Every member action sits in the row's ⋯ menu.
    fireEvent.click(screen.getByRole("button", { name: "更多操作 林员工" }));
    expect(await screen.findByRole("menuitem", { name: "停用" })).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "更多操作 陈管理员" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("menuitem", { name: /停用（需保留至少一位在职管理员）/ })[0],
      ).toHaveAttribute("aria-disabled", "true"),
    );

    fireEvent.click(screen.getByRole("radio", { name: /邀请/ }));
    fireEvent.click(screen.getByRole("button", { name: "更多操作 +8613700137000" }));
    expect(await screen.findByRole("menuitem", { name: "重新发送" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "撤销邀请" })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "邀请成员" }));
    fireEvent.change(await screen.findByLabelText("成员手机号"), {
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

  it("uses current-page selection for access and excludes admins and disabled employees", () => {
    const pageMembers: TenantMember[] = [
      ...members,
      {
        ...members[1],
        id: "disabled",
        status: "DISABLED",
        displayName: "已停用员工",
      },
      { ...members[0], id: "other-admin", displayName: "其他管理员" },
    ];
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        viewerMemberId="member-admin"
        initialMemberPage={{
          ...initialMemberPage,
          items: pageMembers,
          total: 21,
        }}
        initialInvitationPage={{ items: [] }}
        api={memberApi()}
        navigate={vi.fn()}
      />,
    );
    // Bulk actions appear only once rows are selected.
    expect(screen.queryByText("设置访问权限")).not.toBeInTheDocument();
    for (const name of ["林员工", "已停用员工", "其他管理员"]) {
      const row = screen.getByText(name).closest("tr")!;
      fireEvent.click(within(row).getByRole("checkbox"));
    }
    expect(screen.getByText("已选 3 人")).toBeInTheDocument();
    // Only the active employee is eligible; admins and disabled members are left out.
    expect(buttonByText("设置访问权限")).toBeEnabled();
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "right" })
        .find((button) => !button.hasAttribute("disabled"))!,
    );
    expect(screen.queryByText("设置访问权限")).not.toBeInTheDocument();
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

  it("offers object access only for employees, who are the ones it can restrict", async () => {
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: invitations }}
        api={memberApi()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "更多操作 林员工" }));
    expect(await screen.findByRole("menuitem", { name: "访问权限" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多操作 陈管理员" }));
    // An administrator's own menu has no 访问权限: admins always hold full access.
    const adminMenu = (await screen.findByRole("menuitem", { name: /改为员工/ })).closest("ul")!;
    expect(within(adminMenu).queryByRole("menuitem", { name: "访问权限" })).toBeNull();
  });
});
