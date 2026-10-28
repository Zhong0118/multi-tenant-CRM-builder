import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberGroups } from "./member-groups";
import type {
  MemberGroupsApi,
  MemberGroupsResponse,
} from "./member-groups-api";

const data: MemberGroupsResponse = {
  items: [
    {
      id: "group-a",
      name: "销售一组",
      version: 3,
      leaderMemberId: "lin",
      memberIds: ["lin", "zhao"],
    },
  ],
  members: [
    {
      id: "lin",
      displayName: "林员工",
      status: "ACTIVE",
      role: "EMPLOYEE",
      groupId: "group-a",
    },
    {
      id: "zhao",
      displayName: "赵员工",
      status: "ACTIVE",
      role: "EMPLOYEE",
      groupId: "group-a",
    },
    {
      id: "chen",
      displayName: "陈员工",
      status: "ACTIVE",
      role: "EMPLOYEE",
      groupId: null,
    },
    {
      id: "admin",
      displayName: "管理员",
      status: "ACTIVE",
      role: "TENANT_ADMIN",
      groupId: null,
    },
  ],
};

function setup(overrides: Partial<MemberGroupsApi> = {}) {
  const api: MemberGroupsApi = {
    list: vi.fn().mockResolvedValue(data),
    create: vi.fn().mockResolvedValue(data.items[0]),
    update: vi.fn().mockResolvedValue(data.items[0]),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemberGroups tenantCode="northwind" api={api} />
    </QueryClientProvider>,
  );
  return { api, client };
}

function clickText(text: string) {
  fireEvent.click(
    screen
      .getByText((content) => content.replace(/\s/g, "") === text)
      .closest("button")!,
  );
}

describe("MemberGroups", () => {
  it("saves an edited group with its version and keeps the drawer locked during the request", async () => {
    let resolve!: (value: MemberGroupsResponse["items"][number]) => void;
    const pending = new Promise<MemberGroupsResponse["items"][number]>(
      (done) => {
        resolve = done;
      },
    );
    const { api } = setup({ update: vi.fn(() => pending) });
    await screen.findByText("销售一组");
    clickText("编辑");
    fireEvent.change(screen.getByLabelText("小组名称"), {
      target: { value: "销售新组" },
    });
    clickText("保存小组");
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("northwind", "group-a", {
        name: "销售新组",
        memberIds: ["lin", "zhao"],
        leaderMemberId: "lin",
        expectedVersion: 3,
      }),
    );
    expect(screen.getByLabelText("小组名称")).toBeDisabled();
    resolve({ ...data.items[0], name: "销售新组", version: 4 });
    expect(await screen.findByText("小组已保存，立即生效")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByLabelText("小组名称")).not.toBeInTheDocument(),
    );
  });

  it("retains the draft and conflict explanation when a save fails", async () => {
    setup({
      update: vi.fn().mockRejectedValue({
        code: "CONFLICT",
        message: "请先更换原小组组长",
        requestId: "req_group",
        status: 409,
        fieldErrors: {},
      }),
    });
    await screen.findByText("销售一组");
    clickText("编辑");
    fireEvent.change(screen.getByLabelText("小组名称"), {
      target: { value: "保留我的输入" },
    });
    clickText("保存小组");
    expect(await screen.findByText(/请先更换原小组组长/)).toBeInTheDocument();
    expect(screen.getByLabelText("小组名称")).toHaveValue("保留我的输入");
    expect(screen.getByLabelText("小组名称")).toBeEnabled();
  });

  it("limits the leader choices to selected active employees", async () => {
    const { api } = setup();
    await screen.findByText("销售一组");
    clickText("新建小组");
    fireEvent.change(screen.getByLabelText("小组名称"), {
      target: { value: "新销售组" },
    });
    fireEvent.mouseDown(screen.getByLabelText("小组成员"));
    fireEvent.click(
      await screen.findByText("陈员工", {
        selector: ".ant-select-item-option-content",
      }),
    );
    fireEvent.mouseDown(screen.getByLabelText("组长"));
    const options = document.querySelectorAll(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
    );
    const leaderOptions = options[options.length - 1] as HTMLElement;
    expect(
      await within(leaderOptions).findByText("陈员工", {
        selector: ".ant-select-item-option-content",
      }),
    ).toBeInTheDocument();
    expect(
      within(leaderOptions).queryByText("林员工", {
        selector: ".ant-select-item-option-content",
      }),
    ).not.toBeInTheDocument();
    expect(within(leaderOptions).queryByText("管理员")).not.toBeInTheDocument();
    fireEvent.click(
      within(leaderOptions).getByText("陈员工", {
        selector: ".ant-select-item-option-content",
      }),
    );
    clickText("保存小组");
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("northwind", {
        name: "新销售组",
        memberIds: ["chen"],
        leaderMemberId: "chen",
      }),
    );
  });

  it("creates a group with selected members and no leader", async () => {
    const { api } = setup();
    await screen.findByText("销售一组");
    clickText("新建小组");
    fireEvent.change(screen.getByLabelText("小组名称"), {
      target: { value: "待指定组长" },
    });
    fireEvent.mouseDown(screen.getByLabelText("小组成员"));
    fireEvent.click(
      await screen.findByText("陈员工", {
        selector: ".ant-select-item-option-content",
      }),
    );
    clickText("保存小组");
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("northwind", {
        name: "待指定组长",
        memberIds: ["chen"],
        leaderMemberId: null,
      }),
    );
    expect(await screen.findByText("小组已保存，立即生效")).toBeInTheDocument();
  });

  it("clears the existing leader while preserving group members", async () => {
    const { api } = setup();
    await screen.findByText("销售一组");
    clickText("编辑");
    const select = screen.getByLabelText("组长").closest(".ant-select")!;
    fireEvent.click(select.querySelector(".ant-select-clear")!);
    clickText("保存小组");
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("northwind", "group-a", {
        name: "销售一组",
        memberIds: ["lin", "zhao"],
        leaderMemberId: null,
        expectedVersion: 3,
      }),
    );
    expect(await screen.findByText("小组已保存，立即生效")).toBeInTheDocument();
  });

  it("confirms disbanding with preservation of members and business records", async () => {
    const { api } = setup();
    await screen.findByText("销售一组");
    clickText("解散");
    expect(screen.getByText(/成员账号和业务记录.*保留/)).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();
    clickText("确认解散");
    await waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith("northwind", "group-a", 3),
    );
    expect(
      await screen.findByText("小组已解散，成员和业务记录已保留"),
    ).toBeInTheDocument();
  });

  it("allows clearing a disabled leader while keeping disabled members", async () => {
    const { api } = setup({
      list: vi.fn().mockResolvedValue({
        ...data,
        members: data.members.map((member) => ({
          ...member,
          status: "DISABLED",
        })),
      }),
    });
    await screen.findByText("销售一组");
    clickText("编辑");
    expect(
      screen.getByLabelText("组长").closest(".ant-select"),
    ).toHaveTextContent("林员工（已停用）");
    clickText("保存小组");
    expect(
      await screen.findByText("请选择在职员工担任组长"),
    ).toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
    const select = screen.getByLabelText("组长").closest(".ant-select")!;
    fireEvent.click(select.querySelector(".ant-select-clear")!);
    clickText("保存小组");
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("northwind", "group-a", {
        name: "销售一组",
        memberIds: ["lin", "zhao"],
        leaderMemberId: null,
        expectedVersion: 3,
      }),
    );
  });
});
