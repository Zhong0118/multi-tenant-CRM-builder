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

describe("MemberObjectAccess", () => {
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
