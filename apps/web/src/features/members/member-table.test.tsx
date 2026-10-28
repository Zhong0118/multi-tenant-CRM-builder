import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { InviteMemberForm } from "./invite-member-form";
import {
  formatPhone,
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
  it("combines group filtering with search and resets pagination and selection", async () => {
    const api = memberApi();
    const navigate = vi.fn();
    vi.mocked(api.listMembers).mockResolvedValue({
      ...initialMemberPage,
      items: [members[1]],
      total: 1,
    });
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        viewerMemberId="member-admin"
        initialFilters={{ q: "林", role: "EMPLOYEE", status: "ACTIVE" }}
        initialMemberPage={{
          ...initialMemberPage,
          page: 2,
          total: 40,
          items: [
            {
              ...members[1],
              groupId: "group-a",
              groupName: "销售一组",
              isGroupLeader: true,
            },
          ],
        }}
        initialInvitationPage={{ items: [] }}
        groups={[
          {
            id: "group-a",
            name: "销售一组",
            version: 1,
            leaderMemberId: members[1].id,
            memberIds: [members[1].id],
          },
        ]}
        api={api}
        navigate={navigate}
      />,
    );
    expect(screen.getByText("组长")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("选择 林员工"));
    expect(screen.getByText("已选 1 人")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText("小组筛选"));
    fireEvent.click(
      screen.getByText("销售一组", {
        selector: ".ant-select-item-option-content",
      }),
    );
    await waitFor(() =>
      expect(api.listMembers).toHaveBeenCalledWith("northwind", 1, 20, {
        q: "林",
        role: "EMPLOYEE",
        status: "ACTIVE",
        groupId: "group-a",
      }),
    );
    expect(screen.queryByText("已选 1 人")).not.toBeInTheDocument();
    expect(navigate).toHaveBeenLastCalledWith(
      "/workspace/northwind/members?page=1&q=%E6%9E%97&role=EMPLOYEE&status=ACTIVE&groupId=group-a",
    );
  });

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
    expect(
      await screen.findByRole("menuitem", { name: "停用" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "更多操作 陈管理员" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("menuitem", {
          name: /停用（需保留至少一位在职管理员）/,
        })[0],
      ).toHaveAttribute("aria-disabled", "true"),
    );

    fireEvent.click(screen.getByRole("radio", { name: /邀请/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "更多操作 +8613700137000" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "重新发送" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "撤销邀请" }),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole("menuitem", { name: "访问权限" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多操作 陈管理员" }));
    // An administrator's own menu has no 访问权限: admins always hold full access.
    const adminMenu = (
      await screen.findByRole("menuitem", { name: /改为员工/ })
    ).closest("ul")!;
    expect(
      within(adminMenu).queryByRole("menuitem", { name: "访问权限" }),
    ).toBeNull();
  });

  it("shows the employee a way back to the workspace", () => {
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="EMPLOYEE"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: [] }}
        api={memberApi()}
      />,
    );
    expect(screen.getByText("返回工作台").closest("a")).toHaveAttribute(
      "href",
      "/workspace/northwind",
    );
  });

  it("links employees to their access page and says administrators have every table", () => {
    // A desktop-width window, so the md-only 访问权限 column is rendered.
    const narrow = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...narrow(query),
      matches: true,
    })) as typeof window.matchMedia;
    try {
      renderWithQuery(
        <MemberTable
          tenantCode="northwind"
          viewerRole="TENANT_ADMIN"
          viewerMemberId="member-admin"
          initialMemberPage={initialMemberPage}
          initialInvitationPage={{ items: [] }}
          api={memberApi()}
        />,
      );
      const employee = screen.getByText("林员工").closest("tr")!;
      expect(
        within(employee).getByText("查看和设置").closest("a"),
      ).toHaveAttribute(
        "href",
        "/workspace/northwind/members/member-employee/access",
      );
      const admin = screen.getByText("陈管理员").closest("tr")!;
      expect(within(admin).getByText("全部业务表")).toBeInTheDocument();
      // Phones read as numbers, and the viewer is marked.
      expect(within(employee).getByText(/139 0013 9000/)).toBeInTheDocument();
      expect(within(admin).getByText("（我）")).toBeInTheDocument();
      // Checkboxes are named after the member, in Chinese.
      expect(within(employee).getByRole("checkbox")).toHaveAttribute(
        "aria-label",
        "选择 林员工",
      );
      expect(within(admin).getByRole("checkbox")).toHaveAttribute(
        "aria-label",
        "不能选择自己",
      );
    } finally {
      window.matchMedia = narrow;
    }
  });

  it("searches the whole roster, not just the page on screen", async () => {
    const api = memberApi();
    const beyondPage: TenantMember = {
      ...members[1],
      id: "member-far",
      displayName: "远页员工",
      phone: "+8613600136000",
    };
    vi.mocked(api.listMembers).mockImplementation(
      async (_tenant, page, limit = 20, filters = {}) => ({
        items: filters.q === "136 0013" ? [beyondPage] : [],
        page,
        limit,
        total: filters.q === "136 0013" ? 1 : 0,
        activeAdminCount: 1,
      }),
    );
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialMemberPage={{ ...initialMemberPage, total: 3 }}
        initialInvitationPage={{ items: [] }}
        api={api}
      />,
    );
    expect(screen.queryByText("远页员工")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索成员"), {
      target: { value: "136 0013" },
    });
    expect(await screen.findByText("远页员工")).toBeInTheDocument();
    expect(screen.queryByText("林员工")).not.toBeInTheDocument();
    expect(screen.getByText("找到 1 位成员")).toBeInTheDocument();
    expect(api.listMembers).toHaveBeenCalledWith("northwind", 1, 20, {
      q: "136 0013",
    });

    fireEvent.change(screen.getByLabelText("搜索成员"), {
      target: { value: "没有这个人" },
    });
    expect(await screen.findByText("没有符合条件的成员")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("清除筛选")[0].closest("button")!);
    expect(await screen.findByText("林员工")).toBeInTheDocument();
  });

  it("keeps a failed roster load on screen with a retry", async () => {
    const api = memberApi();
    vi.mocked(api.listMembers).mockRejectedValue({
      code: "SERVICE_UNAVAILABLE",
      message: "服务暂时不可用",
      fieldErrors: {},
      status: 503,
      requestId: "req_roster",
    });
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: [] }}
        api={api}
      />,
    );
    fireEvent.change(screen.getByLabelText("搜索成员"), {
      target: { value: "林" },
    });
    expect(
      await screen.findByText("成员名单读取失败：服务暂时不可用"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^重\s?试$/).closest("button")).toBeEnabled();
    expect(screen.queryByText(/0 位在职管理员/)).not.toBeInTheDocument();
    expect(screen.queryByText("找到 0 位成员")).not.toBeInTheDocument();
    expect(screen.queryByText("没有符合条件的成员")).not.toBeInTheDocument();
    vi.mocked(api.listMembers).mockResolvedValue({
      ...initialMemberPage,
      items: [members[1]],
      total: 1,
    });
    fireEvent.click(screen.getByText(/^重\s?试$/).closest("button")!);
    expect(await screen.findByText("林员工")).toBeInTheDocument();
  });

  it("keeps search in the URL and paginates all server results", async () => {
    const api = memberApi();
    const navigate = vi.fn();
    vi.mocked(api.listMembers).mockImplementation(
      async (_tenant, page, limit = 20) => ({
        items: [{ ...members[1], displayName: `筛选结果${page}` }],
        page,
        limit,
        total: 5001,
        activeAdminCount: 1,
      }),
    );
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        viewerMemberId="member-admin"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: [] }}
        api={api}
        navigate={navigate}
      />,
    );
    fireEvent.change(screen.getByLabelText("搜索成员"), {
      target: { value: "林" },
    });
    expect(await screen.findByText("筛选结果1")).toBeInTheDocument();
    expect(screen.getByText("找到 5001 位成员")).toBeInTheDocument();
    fireEvent.click(
      screen
        .getByText("筛选结果1")
        .closest("tr")!
        .querySelector('input[type="checkbox"]')!,
    );
    expect(screen.getByText("已选 1 人")).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "right" })
        .find((b) => !b.hasAttribute("disabled"))!,
    );
    expect(await screen.findByText("筛选结果2")).toBeInTheDocument();
    expect(screen.queryByText("已选 1 人")).not.toBeInTheDocument();
    expect(api.listMembers).toHaveBeenLastCalledWith("northwind", 2, 20, {
      q: "林",
    });
    expect(navigate).toHaveBeenLastCalledWith(
      "/workspace/northwind/members?page=2&q=%E6%9E%97",
    );
  });

  it("hydrates a filtered page with its saved criteria", () => {
    const api = memberApi();
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialFilters={{ q: "林", role: "EMPLOYEE", status: "ACTIVE" }}
        initialMemberPage={{
          ...initialMemberPage,
          items: [members[1]],
          total: 1,
          limit: 50,
        }}
        initialInvitationPage={{ items: [] }}
        api={api}
      />,
    );
    expect(screen.getByLabelText("搜索成员")).toHaveValue("林");
    expect(screen.queryByText("陈管理员")).not.toBeInTheDocument();
    expect(screen.getByText("找到 1 位成员")).toBeInTheDocument();
    expect(api.listMembers).not.toHaveBeenCalled();
  });

  it("moves to a valid page when refreshing removes its last matching member", async () => {
    const api = memberApi();
    vi.mocked(api.listMembers).mockImplementation(
      async (_tenant, page, limit = 20) => ({
        items: page === 2 ? [] : [members[1]],
        page,
        limit,
        total: 20,
        activeAdminCount: 1,
      }),
    );
    const { client } = renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialFilters={{ status: "ACTIVE" }}
        initialMemberPage={{
          ...initialMemberPage,
          page: 2,
          items: [members[1]],
          total: 21,
        }}
        initialInvitationPage={{ items: [] }}
        api={api}
      />,
    );
    await client.invalidateQueries({
      queryKey: ["workspace", "northwind", "members"],
    });
    await waitFor(() =>
      expect(api.listMembers).toHaveBeenCalledWith("northwind", 1, 20, {
        status: "ACTIVE",
      }),
    );
    expect(await screen.findByText("林员工")).toBeInTheDocument();
    expect(screen.queryByText("没有符合条件的成员")).not.toBeInTheDocument();
  });

  it("queries combined role and status filters on the server", async () => {
    const api = memberApi();
    vi.mocked(api.listMembers).mockImplementation(
      async (_tenant, page, limit = 20, filters = {}) => ({
        items: members.filter(
          (m) =>
            (!filters.role || m.role === filters.role) &&
            (!filters.status || m.status === filters.status),
        ),
        page,
        limit,
        total: filters.status === "DISABLED" ? 0 : 1,
        activeAdminCount: 1,
      }),
    );
    renderWithQuery(
      <MemberTable
        tenantCode="northwind"
        viewerRole="TENANT_ADMIN"
        initialMemberPage={initialMemberPage}
        initialInvitationPage={{ items: [] }}
        api={api}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText("角色"));
    const roleOptions = document.querySelector(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
    )!;
    fireEvent.click(
      within(roleOptions as HTMLElement).getByText("员工", { exact: true }),
    );
    await waitFor(() =>
      expect(api.listMembers).toHaveBeenCalledWith("northwind", 1, 20, {
        role: "EMPLOYEE",
      }),
    );
    fireEvent.mouseDown(screen.getByLabelText("状态"));
    fireEvent.click(await screen.findByText("已停用", { exact: true }));
    await waitFor(() =>
      expect(api.listMembers).toHaveBeenLastCalledWith("northwind", 1, 20, {
        role: "EMPLOYEE",
        status: "DISABLED",
      }),
    );
    expect(await screen.findByText("没有符合条件的成员")).toBeInTheDocument();
  });

  it("confirms a successful status change", async () => {
    const api = memberApi();
    const disabled = { ...members[1], status: "DISABLED" as const };
    renderWithQuery(
      <App>
        <MemberTable
          tenantCode="northwind"
          viewerRole="TENANT_ADMIN"
          initialMemberPage={{
            ...initialMemberPage,
            items: [members[0], disabled],
          }}
          initialInvitationPage={{ items: [] }}
          api={api}
        />
      </App>,
    );
    fireEvent.click(screen.getByRole("button", { name: "更多操作 林员工" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "恢复使用" }));
    await waitFor(() =>
      expect(api.changeMemberStatus).toHaveBeenCalledWith(
        "northwind",
        "member-employee",
        "ACTIVE",
      ),
    );
    expect(await screen.findByText("林员工已恢复使用")).toBeInTheDocument();
  });
});

describe("member roster helpers", () => {
  it("formats mainland numbers and leaves others alone", () => {
    expect(formatPhone("+8618800001001")).toBe("188 0000 1001");
    expect(formatPhone("+85291234567")).toBe("+85291234567");
    expect(formatPhone(undefined)).toBeUndefined();
  });
});
