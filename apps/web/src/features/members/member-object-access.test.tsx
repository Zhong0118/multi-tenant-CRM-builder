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
import { memberBatchAccessApi } from "./bulk-member-access";

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
    fields: [],
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
  const promise = new Promise<MemberObjectAccessRow>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return { promise, resolve, reject };
}

function expectEditorsLocked(scope: HTMLElement) {
  for (const label of [
    "可以新建记录",
    "可以查看记录",
    "可以修改记录",
    "查看范围",
    "修改范围",
  ]) {
    expect(within(scope).getByLabelText(label)).toBeDisabled();
  }
  expect(
    within(scope).getByRole("button", { name: /保存例外/ }),
  ).toBeDisabled();
}

function expand(objectName: string) {
  fireEvent.click(
    within(panel(objectName)).getByRole("button", {
      name: new RegExp(objectName),
    }),
  );
}

function startException(objectName: string) {
  expand(objectName);
  fireEvent.click(
    within(panel(objectName)).getByRole("button", {
      name: /设置表例外|修改表例外/,
    }),
  );
}

function confirmDialog() {
  const dialog = document.querySelector<HTMLElement>(".ant-modal");
  if (!dialog) throw new Error("No confirmation dialog is open");
  return dialog;
}

function fieldRow(scope: HTMLElement, label: string) {
  const table = within(scope).getByRole("table", { name: "列权限对照" });
  const header = within(table).getByText(label);
  const row = header.closest("tr");
  if (!row) throw new Error(`No column row for ${label}`);
  return row;
}

describe("MemberObjectAccess", () => {
  it("compares each column with the employee default and opens the shared editor for one employee", async () => {
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[
          row({
            fields: [
              {
                fieldId: "amount",
                fieldKey: "amount",
                label: "金额",
                isSystem: false,
                inherited: "HIDDEN",
                effective: "EDIT",
                override: "EDIT",
              },
              {
                fieldId: "created",
                fieldKey: "createdAt",
                label: "创建时间",
                isSystem: true,
                inherited: "READ_ONLY",
                effective: "READ_ONLY",
                override: null,
              },
            ],
          }),
        ]}
        api={accessApi()}
      />,
    );
    const scope = panel("客户资料");
    // The collapsed row already says a column differs from the default.
    expect(within(scope).getByText("1 列例外")).toBeInTheDocument();
    expand("客户资料");
    expect(fieldRow(scope, "金额")).toHaveTextContent(/金额成员例外隐藏可编辑/);
    expect(fieldRow(scope, "创建时间")).toHaveTextContent(/系统列/);
    fireEvent.click(within(scope).getByRole("button", { name: "设置列权限" }));
    expect(
      await screen.findByText(/将应用到 1 位有效员工/),
    ).toBeInTheDocument();
  });

  it("saves one employee through the shared editor and refreshes the columns", async () => {
    const fields: MemberObjectAccessRow["fields"] = [
      {
        fieldId: "amount",
        fieldKey: "amount",
        label: "金额",
        isSystem: false,
        inherited: "HIDDEN",
        effective: "HIDDEN",
        override: null,
      },
    ];
    const api = accessApi({
      list: vi.fn().mockResolvedValue([
        row({
          fields: [{ ...fields[0], effective: "EDIT", override: "EDIT" }],
        }),
      ]),
    });
    const batchSave = vi
      .spyOn(memberBatchAccessApi, "set")
      .mockResolvedValue({ updated: 1 });
    try {
      renderAccess(
        <MemberObjectAccess
          tenantCode="northwind"
          memberId="member-lin"
          memberName="林员工"
          initialRows={[row({ fields })]}
          api={api}
        />,
      );
      expand("客户资料");
      fireEvent.click(
        within(panel("客户资料")).getByRole("button", { name: "设置列权限" }),
      );
      fireEvent.mouseDown(await screen.findByLabelText("金额权限"));
      fireEvent.click(
        await screen.findByText("可编辑", {
          selector: ".ant-select-item-option-content",
        }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: /保存并应用到 1 人/ }),
      );
      await waitFor(() =>
        expect(batchSave).toHaveBeenCalledWith(
          "northwind",
          "object-customers",
          {
            memberIds: ["member-lin"],
            fields: [{ fieldId: "amount", access: "EDIT" }],
          },
        ),
      );
      expect(
        await screen.findByText("客户资料的列权限已保存，立即生效"),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(
          within(panel("客户资料")).getByText("1 列例外"),
        ).toBeInTheDocument(),
      );
    } finally {
      batchSave.mockRestore();
    }
  });

  it("keeps the saved source and the server's effective access apart from an unsaved exception", async () => {
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
        initialRows={[row()]}
        api={api}
      />,
    );
    const scope = panel("客户资料");
    expect(within(scope).getByText("跟随员工默认")).toBeInTheDocument();
    startException("客户资料");
    fireEvent.click(within(scope).getByLabelText("可以新建记录"));
    // Editing changes nothing until it is saved.
    expect(within(scope).getByText("跟随员工默认")).toBeInTheDocument();
    expect(
      within(scope).getByText("成员例外 · 保存后立即生效"),
    ).toBeInTheDocument();
    expect(api.set).not.toHaveBeenCalled();
    fireEvent.click(within(scope).getByRole("button", { name: "保存例外" }));
    expect(
      await screen.findByText("客户资料的成员例外已保存，立即生效"),
    ).toBeInTheDocument();
    expect(within(scope).getByText("成员例外")).toBeInTheDocument();
    // The summary shows what the server says applies, not the draft.
    const summary = within(scope).getByLabelText("当前生效");
    expect(summary).toHaveTextContent("新建不可以");
    expect(summary).toHaveTextContent("查看全部记录");
    expect(summary).toHaveTextContent("修改不可以");
  });

  it("keeps the exception when restoring the default fails", async () => {
    const api = accessApi({
      set: vi.fn().mockRejectedValue({
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
        initialRows={[
          row({
            mode: "OVERRIDE",
            override: { ...row().inherited, canCreate: false },
          }),
        ]}
        api={api}
      />,
    );
    expand("客户资料");
    const scope = panel("客户资料");
    fireEvent.click(
      within(scope).getByRole("button", { name: "恢复为员工默认" }),
    );
    fireEvent.click(
      within(confirmDialog()).getByRole("button", { name: "恢复为员工默认" }),
    );
    expect(
      await screen.findByText("保存失败（请求编号：req_save）"),
    ).toBeInTheDocument();
    expect(within(scope).getByText("成员例外")).toBeInTheDocument();
    fireEvent.click(within(scope).getByRole("button", { name: "修改表例外" }));
    expect(within(scope).getByLabelText("可以新建记录")).not.toBeChecked();
  });

  it("asks before restoring the default and says what the member will get", async () => {
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
    expand("客户资料");
    fireEvent.click(
      within(panel("客户资料")).getByRole("button", { name: "恢复为员工默认" }),
    );
    expect(confirmDialog()).toHaveTextContent(
      "立即改为员工默认：可以新建，查看仅本人负责，修改仅本人负责",
    );
    expect(api.set).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirmDialog()).getByRole("button", { name: "恢复为员工默认" }),
    );
    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith(
        "northwind",
        "member-lin",
        "object-customers",
        { mode: "INHERIT" },
      ),
    );
    expect(
      await screen.findByText("客户资料已恢复为员工默认权限，立即生效"),
    ).toBeInTheDocument();
  });

  it("locks the editor during a slow save and then shows the server's effective access", async () => {
    const save = deferredSave();
    const api = accessApi({ set: vi.fn(() => save.promise) });
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={api}
      />,
    );
    const scope = panel("客户资料");
    startException("客户资料");
    fireEvent.click(within(scope).getByRole("button", { name: "保存例外" }));
    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith(
        "northwind",
        "member-lin",
        "object-customers",
        {
          mode: "OVERRIDE",
          canCreate: true,
          canRead: true,
          canUpdate: true,
          readScope: "OWN",
          updateScope: "OWN",
        },
      ),
    );
    await waitFor(() => expectEditorsLocked(scope));
    expect(within(scope).getByText("跟随员工默认")).toBeInTheDocument();
    save.resolve(
      row({
        mode: "OVERRIDE",
        override: row().inherited,
        effective: {
          ...row().effective,
          canCreate: false,
          canUpdate: false,
          readScope: "ALL",
          updateScope: "NONE",
        },
      }),
    );
    await screen.findByText("客户资料的成员例外已保存，立即生效");
    expect(within(scope).getByText("成员例外")).toBeInTheDocument();
    expect(within(scope).getByLabelText("当前生效")).toHaveTextContent(
      "查看全部记录",
    );
    // The editor closes; the next edit starts from what is stored.
    expect(
      within(scope).queryByLabelText("可以新建记录"),
    ).not.toBeInTheDocument();
  });

  it("unlocks after a slow failure without losing the draft or changing saved access", async () => {
    const save = deferredSave();
    const api = accessApi({ set: vi.fn(() => save.promise) });
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={api}
      />,
    );
    const scope = panel("客户资料");
    startException("客户资料");
    fireEvent.click(within(scope).getByLabelText("可以新建记录"));
    fireEvent.click(within(scope).getByRole("button", { name: "保存例外" }));
    await waitFor(() => expectEditorsLocked(scope));
    save.reject({
      code: "SERVICE_UNAVAILABLE",
      message: "保存失败",
      fieldErrors: {},
      status: 503,
      requestId: "req_delayed",
    });
    await screen.findByText("保存失败（请求编号：req_delayed）");
    await waitFor(() =>
      expect(within(scope).getByLabelText("可以新建记录")).toBeEnabled(),
    );
    expect(within(scope).getByLabelText("可以新建记录")).not.toBeChecked();
    expect(within(scope).getByText("跟随员工默认")).toBeInTheDocument();
    expect(within(scope).getByLabelText("当前生效")).toHaveTextContent(
      "新建可以",
    );
  });

  it("locks other tables so a second save cannot replace the pending one", async () => {
    const save = deferredSave();
    const api = accessApi({ set: vi.fn(() => save.promise) });
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[
          row(),
          row({
            objectId: "object-leads",
            objectName: "获客",
            objectCode: "leads",
          }),
        ]}
        api={api}
      />,
    );
    startException("客户资料");
    startException("获客");
    fireEvent.click(
      within(panel("客户资料")).getByRole("button", { name: "保存例外" }),
    );
    await waitFor(() => expectEditorsLocked(panel("获客")));
    fireEvent.click(
      within(panel("获客")).getByRole("button", { name: /保存例外/ }),
    );
    expect(api.set).toHaveBeenCalledTimes(1);
    save.resolve(row({ mode: "OVERRIDE", override: row().inherited }));
    await screen.findByText("客户资料的成员例外已保存，立即生效");
    await waitFor(() =>
      expect(
        within(panel("获客")).getByLabelText("可以新建记录"),
      ).toBeEnabled(),
    );
  });

  it("lists every published table with what the member can do there", () => {
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
            effective: {
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
    expect(panel("获客")).toHaveTextContent("修改不可以");
  });

  it("explains where defaults and exceptions come from and when each applies", () => {
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={accessApi()}
      />,
    );

    const sources = screen.getByLabelText("权限来源");
    expect(sources).toHaveTextContent(
      /员工默认.*发布后生效.*修改后要发布业务表/,
    );
    expect(sources).toHaveTextContent(/成员例外.*保存即生效.*只对林员工生效/);
    expect(
      within(sources).getByRole("link", { name: "去业务表" }),
    ).toHaveAttribute("href", "/workspace/northwind/settings/objects");
  });

  it("offers no policy controls until an exception is started", () => {
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
    expand("客户资料");
    expect(
      within(scope).queryByLabelText("可以新建记录"),
    ).not.toBeInTheDocument();
    expect(
      within(scope).queryByRole("button", { name: "恢复为员工默认" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(scope).getByRole("button", { name: "设置表例外" }));
    for (const label of [
      "可以新建记录",
      "可以查看记录",
      "可以修改记录",
      "查看范围",
      "修改范围",
    ]) {
      expect(within(scope).getByLabelText(label)).toBeInTheDocument();
    }
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

    startException("客户资料");
    fireEvent.click(within(panel("客户资料")).getByLabelText("可以新建记录"));
    fireEvent.click(
      within(panel("客户资料")).getByRole("button", { name: "保存例外" }),
    );

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

  it("filters to the tables with exceptions", () => {
    renderAccess(
      <MemberObjectAccess
        tenantCode="northwind"
        memberId="member-lin"
        memberName="林员工"
        initialRows={[row()]}
        api={accessApi()}
      />,
    );

    fireEvent.click(screen.getByText("有例外 0"));
    expect(screen.queryByRole("group", { name: "客户资料" })).toBeNull();
    expect(
      screen.getByText("林员工在所有业务表上都跟随员工默认权限。"),
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

    expect(screen.getByText("公司还没有已发布的业务表。")).toBeInTheDocument();
  });
});
