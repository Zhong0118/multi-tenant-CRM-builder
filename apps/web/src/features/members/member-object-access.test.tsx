import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  MemberObjectAccess,
  type MemberAccessApi,
  type MemberObjectAccessInput,
  type MemberObjectAccessRow,
} from "./member-object-access";

function row(
  overrides: Partial<MemberObjectAccessRow> = {},
): MemberObjectAccessRow {
  return {
    objectId: "object-customers",
    objectCode: "customers",
    objectName: "客户资料",
    mode: "INHERIT",
    inherited: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: "OWN",
      updateScope: "OWN",
    },
    override: null,
    effective: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: "OWN",
      updateScope: "OWN",
    },
    ...overrides,
  } as MemberObjectAccessRow;
}

function accessApi(overrides: Partial<MemberAccessApi> = {}): MemberAccessApi {
  return {
    list: vi.fn().mockResolvedValue([row()]),
    set: vi.fn().mockResolvedValue(row()),
    ...overrides,
  };
}

function renderAccess(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function panel(objectName: string) {
  return screen.getByRole("group", { name: objectName });
}

function deferredSave() {
  let resolve!: (value: MemberObjectAccessRow) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<MemberObjectAccessRow>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function expectEditorsLocked(scope: HTMLElement) {
  for (const label of ["可以新建记录", "可以查看记录", "可以修改记录", "查看范围", "修改范围"]) {
    expect(within(scope).getByLabelText(label)).toBeDisabled();
  }
  for (const radio of within(scope).getAllByRole("radio")) {
    expect(radio).toBeDisabled();
  }
  expect(within(scope).getByRole("button", { name: /保存覆盖/ })).toBeDisabled();
}

describe("MemberObjectAccess", () => {
  it("keeps saved mode and server effective access distinct from an unsaved override", async () => {
    const effective = {
      ...row().effective,
      canCreate: false,
      canUpdate: false,
      readScope: "ALL" as const,
      updateScope: "NONE" as const,
    };
    const api = accessApi({
      set: vi
        .fn()
        .mockResolvedValue(
          row({ mode: "OVERRIDE", override: row().inherited, effective }),
        ),
    });
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row({ effective })]}
        api={api}
      />,
    );
    const scope = panel("客户资料");
    expect(within(scope).getByText("已生效：跟随员工默认")).toBeInTheDocument();
    expect(
      within(scope).getByText(
        "当前有效权限：查看 · 查看全部记录 · 修改无权访问",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(scope).getByRole("radio", { name: "成员覆盖" }));
    expect(within(scope).getByText("已生效：跟随员工默认")).toBeInTheDocument();
    expect(
      within(scope).getByText("正在编辑成员覆盖；保存后立即生效，无需发布。"),
    ).toBeInTheDocument();
    expect(api.set).not.toHaveBeenCalled();
    fireEvent.click(within(scope).getByRole("button", { name: "保存覆盖" }));
    expect(
      await within(scope).findByText("已生效：成员覆盖"),
    ).toBeInTheDocument();
    expect(
      within(scope).getByText(
        "当前有效权限：查看 · 查看全部记录 · 修改无权访问",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("保存已立即生效，无需重新发布对象。"),
    ).toBeInTheDocument();
  });

  it("retains saved override and local input if restoring defaults fails", async () => {
    const api = accessApi({
      set: vi
        .fn()
        .mockRejectedValue({
          code: "SERVICE_UNAVAILABLE",
          message: "保存失败",
          fieldErrors: {},
          status: 503,
          requestId: "req_save",
        }),
    });
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row({ mode: "OVERRIDE", override: row().inherited })]}
        api={api}
      />,
    );
    fireEvent.click(within(panel("客户资料")).getByLabelText("可以新建记录"));
    fireEvent.click(
      within(panel("客户资料")).getByRole("radio", { name: "使用员工默认" }),
    );
    await screen.findByText(/保存失败/);
    expect(
      within(panel("客户资料")).getByText("已生效：成员覆盖"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(panel("客户资料")).getByRole("radio", { name: "成员覆盖" }),
    );
    expect(
      within(panel("客户资料")).getByLabelText("可以新建记录"),
    ).not.toBeChecked();
  });

  it("locks editors during delayed success and displays the server effective projection", async () => {
    const save = deferredSave();
    const api = accessApi({ set: vi.fn(() => save.promise) });
    renderAccess(
      <MemberObjectAccess tenantCode="northwind" memberId="member-lin" memberName="林员工" initialRows={[row()]} api={api} />,
    );
    const scope = panel("客户资料");
    fireEvent.click(within(scope).getByRole("radio", { name: "成员覆盖" }));
    fireEvent.click(within(scope).getByRole("button", { name: "保存覆盖" }));
    await waitFor(() => expect(within(scope).getByRole("radio", { name: "使用员工默认" })).toBeDisabled());
    expect(api.set).toHaveBeenCalledWith("northwind", "member-lin", "object-customers", {
      mode: "OVERRIDE", canCreate: true, canRead: true, canUpdate: true, readScope: "OWN", updateScope: "OWN",
    });
    fireEvent.click(within(scope).getByLabelText("可以新建记录"));
    expect(within(scope).getByLabelText("可以新建记录")).toBeChecked();
    expectEditorsLocked(scope);
    expect(within(scope).getByText("已生效：跟随员工默认")).toBeInTheDocument();
    save.resolve(row({
      mode: "OVERRIDE", override: row().inherited,
      effective: { ...row().effective, canCreate: false, canUpdate: false, readScope: "ALL", updateScope: "NONE" },
    }));
    await screen.findByText("客户资料的成员覆盖已保存");
    await waitFor(() => expect(within(scope).getByLabelText("可以新建记录")).toBeEnabled());
    expect(within(scope).getByLabelText("可以新建记录")).toBeChecked();
    expect(within(scope).getByText("当前有效权限：查看 · 查看全部记录 · 修改无权访问")).toBeInTheDocument();
    expect(within(scope).getByText("已生效：成员覆盖")).toBeInTheDocument();
  });

  it("unlocks after delayed failure without losing draft or changing saved access", async () => {
    const save = deferredSave();
    const api = accessApi({ set: vi.fn(() => save.promise) });
    renderAccess(
      <MemberObjectAccess tenantCode="northwind" memberId="member-lin" memberName="林员工" initialRows={[row()]} api={api} />,
    );
    const scope = panel("客户资料");
    fireEvent.click(within(scope).getByRole("radio", { name: "成员覆盖" }));
    fireEvent.click(within(scope).getByLabelText("可以新建记录"));
    fireEvent.click(within(scope).getByRole("button", { name: "保存覆盖" }));
    await waitFor(() => expect(within(scope).getByRole("radio", { name: "使用员工默认" })).toBeDisabled());
    expectEditorsLocked(scope);
    fireEvent.click(within(scope).getByLabelText("可以新建记录"));
    save.reject({ code: "SERVICE_UNAVAILABLE", message: "保存失败", fieldErrors: {}, status: 503, requestId: "req_delayed" });
    await screen.findByText("保存失败（请求编号：req_delayed）");
    await waitFor(() => expect(within(scope).getByLabelText("可以新建记录")).toBeEnabled());
    expect(within(scope).getByLabelText("可以新建记录")).not.toBeChecked();
    expect(within(scope).getByText("已生效：跟随员工默认")).toBeInTheDocument();
    expect(within(scope).getByText("当前有效权限：新建 / 查看 / 修改 · 查看仅本人负责 · 修改仅本人负责")).toBeInTheDocument();
    expect(screen.queryByText("客户资料的成员覆盖已保存")).not.toBeInTheDocument();
  });

  it.each(["success", "failure"] as const)("locks modes during delayed default restoration: %s", async (outcome) => {
    const save = deferredSave();
    const api = accessApi({ set: vi.fn(() => save.promise) });
    renderAccess(
      <MemberObjectAccess tenantCode="northwind" memberId="member-lin" memberName="林员工" initialRows={[row({ mode: "OVERRIDE", override: row().inherited })]} api={api} />,
    );
    const scope = panel("客户资料");
    fireEvent.click(within(scope).getByLabelText("可以新建记录"));
    fireEvent.click(within(scope).getByRole("radio", { name: "使用员工默认" }));
    await waitFor(() => expect(within(scope).getByRole("radio", { name: "成员覆盖" })).toBeDisabled());
    expect(api.set).toHaveBeenCalledWith("northwind", "member-lin", "object-customers", { mode: "INHERIT" });
    fireEvent.click(within(scope).getByRole("radio", { name: "成员覆盖" }));
    expect(within(scope).queryByLabelText("可以新建记录")).not.toBeInTheDocument();
    expect(within(scope).getByText("已生效：成员覆盖")).toBeInTheDocument();
    if (outcome === "success") {
      save.resolve(row({ effective: { ...row().effective, canCreate: false } }));
      await screen.findByText("客户资料已恢复为员工默认权限");
      expect(within(scope).getByText("已生效：跟随员工默认")).toBeInTheDocument();
      expect(within(scope).getByText("当前有效权限：查看 / 修改 · 查看仅本人负责 · 修改仅本人负责")).toBeInTheDocument();
    } else {
      save.reject({ code: "SERVICE_UNAVAILABLE", message: "恢复失败", fieldErrors: {}, status: 503, requestId: "req_restore" });
      await screen.findByText(/恢复失败/);
      expect(within(scope).getByText("已生效：成员覆盖")).toBeInTheDocument();
    }
    await waitFor(() => expect(within(scope).getByRole("radio", { name: "成员覆盖" })).toBeEnabled());
    fireEvent.click(within(scope).getByRole("radio", { name: "成员覆盖" }));
    expect(within(scope).getByLabelText("可以新建记录")).not.toBeChecked();
  });

  it("locks other panels so a second save cannot replace the pending mutation observer", async () => {
    const save = deferredSave();
    const api = accessApi({ set: vi.fn(() => save.promise) });
    renderAccess(
      <MemberObjectAccess tenantCode="northwind" memberId="member-lin" memberName="林员工" initialRows={[row(), row({ objectId: "object-leads", objectName: "获客", objectCode: "leads" })]} api={api} />,
    );
    const first = panel("客户资料");
    const second = panel("获客");
    for (const scope of [first, second]) {
      fireEvent.click(within(scope).getByRole("radio", { name: "成员覆盖" }));
    }
    fireEvent.click(within(first).getByRole("button", { name: "保存覆盖" }));
    await waitFor(() => expect(within(first).getByRole("radio", { name: "使用员工默认" })).toBeDisabled());
    fireEvent.click(within(second).getByRole("button", { name: /保存覆盖/ }));
    await waitFor(() => expect(within(second).getByRole("radio", { name: "使用员工默认" })).toBeDisabled());
    expectEditorsLocked(first);
    expectEditorsLocked(second);
    expect(api.set).toHaveBeenCalledTimes(1);
    save.resolve(row({ mode: "OVERRIDE", override: row().inherited }));
    await screen.findByText("客户资料的成员覆盖已保存");
    await waitFor(() => expect(within(second).getByLabelText("可以新建记录")).toBeEnabled());
  });

  it("lists every published object with the employee default it inherits", () => {
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[
          row(),
          row({
            objectId: "object-leads",
            objectCode: "leads",
            objectName: "获客",
            inherited: {
              canCreate: false,
              canRead: true,
              canUpdate: false,
              canDelete: false,
              readScope: "ALL",
              updateScope: "NONE",
            },
          }),
        ]}
        api={accessApi()}
      />,
    );

    expect(panel("客户资料")).toHaveTextContent("customers");
    expect(panel("客户资料")).toHaveTextContent("仅本人负责");
    expect(panel("获客")).toHaveTextContent("全部记录");
  });

  it("says a member override applies without republishing", () => {
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={accessApi()}
      />,
    );

    expect(
      screen.getByText(
        /成员覆盖保存后立即生效.*员工默认权限需要在对象设计器中发布后生效/,
      ),
    ).toBeInTheDocument();
  });

  it("offers no action or scope controls while the object is inherited", () => {
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={accessApi()}
      />,
    );

    const scope = panel("客户资料");
    expect(
      within(scope).queryByLabelText("可以新建记录"),
    ).not.toBeInTheDocument();
    expect(within(scope).queryByLabelText("查看范围")).not.toBeInTheDocument();
  });

  it("reveals the complete policy form when an override is chosen", () => {
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={accessApi()}
      />,
    );

    fireEvent.click(
      within(panel("客户资料")).getByRole("radio", { name: "成员覆盖" }),
    );

    const scope = panel("客户资料");
    expect(within(scope).getByLabelText("可以新建记录")).toBeInTheDocument();
    expect(within(scope).getByLabelText("可以查看记录")).toBeInTheDocument();
    expect(within(scope).getByLabelText("可以修改记录")).toBeInTheDocument();
    expect(within(scope).getByLabelText("查看范围")).toBeInTheDocument();
    expect(within(scope).getByLabelText("修改范围")).toBeInTheDocument();
  });

  it("replaces the whole policy rather than sending only what changed", async () => {
    const api = accessApi();
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={api}
      />,
    );

    const scope = () => panel("客户资料");
    fireEvent.click(within(scope()).getByRole("radio", { name: "成员覆盖" }));
    fireEvent.click(within(scope()).getByLabelText("可以新建记录"));
    fireEvent.click(within(scope()).getByRole("button", { name: "保存覆盖" }));

    await waitFor(() => expect(api.set).toHaveBeenCalledTimes(1));
    expect(api.set).toHaveBeenCalledWith(
      "northwind",
      "member-lin",
      "object-customers",
      {
        mode: "OVERRIDE",
        canCreate: false,
        canRead: true,
        canUpdate: true,
        readScope: "OWN",
        updateScope: "OWN",
      },
    );
  });

  it("deletes the override when the object returns to the employee default", async () => {
    const api = accessApi();
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[
          row({
            mode: "OVERRIDE",
            override: {
              canCreate: false,
              canRead: true,
              canUpdate: false,
              canDelete: false,
              readScope: "NONE",
              updateScope: "NONE",
            },
          }),
        ]}
        api={api}
      />,
    );

    fireEvent.click(
      within(panel("客户资料")).getByRole("radio", { name: "使用员工默认" }),
    );

    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith(
        "northwind",
        "member-lin",
        "object-customers",
        { mode: "INHERIT" },
      ),
    );
  });

  it("names the object and the mode each save applied", async () => {
    const api = accessApi({
      set: vi.fn(
        async (
          _tenantCode: string,
          _memberId: string,
          objectId: string,
          input: MemberObjectAccessInput,
        ) =>
          row({
            objectId,
            mode: input.mode,
            override:
              input.mode === "OVERRIDE"
                ? {
                    canCreate: true,
                    canRead: true,
                    canUpdate: true,
                    canDelete: false,
                    readScope: "OWN",
                    updateScope: "OWN",
                  }
                : null,
          }),
      ),
    });
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={api}
      />,
    );

    fireEvent.click(
      within(panel("客户资料")).getByRole("radio", { name: "成员覆盖" }),
    );
    fireEvent.click(
      within(panel("客户资料")).getByRole("button", { name: "保存覆盖" }),
    );
    expect(
      await screen.findByText("客户资料的成员覆盖已保存"),
    ).toBeInTheDocument();

    // Returning to the default collapses the panel, so this notice is the only
    // thing left telling the administrator the change landed.
    fireEvent.click(
      within(panel("客户资料")).getByRole("radio", { name: "使用员工默认" }),
    );
    expect(
      await screen.findByText("客户资料已恢复为员工默认权限"),
    ).toBeInTheDocument();
  });

  it("explains an empty list instead of showing a bare page", () => {
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[]}
        api={accessApi()}
      />,
    );

    expect(
      screen.getByText("公司还没有已发布的业务对象。"),
    ).toBeInTheDocument();
  });
});
