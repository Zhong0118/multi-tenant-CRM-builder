import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CreateTenantForm, type TenantApi } from "./create-tenant-form";
import { TenantStatusActions } from "./tenant-status-actions";
import { TenantTable } from "./tenant-table";

function renderWithQuery(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  );
}

function tenantApi(): TenantApi {
  return {
    create: vi.fn().mockResolvedValue({
      id: "tenant-a",
      name: "北辰客户服务",
      code: "northwind",
      status: "DRAFT",
      activeAdminCount: 0,
      firstAdminInvitation: {
        id: "invite-a",
        targetPhone: "+8613800138000",
        role: "TENANT_ADMIN",
        status: "PENDING",
        expiresAt: "2026-08-28T00:00:00.000Z",
      },
    }),
    changeStatus: vi.fn(),
    renewFirstAdminInvitation: vi.fn(),
    countNameConflicts: vi.fn().mockResolvedValue({
      name: "北辰客户服务",
      count: 0,
    }),
  };
}

describe("CreateTenantForm", () => {
  it("creates a draft company and shows the first-admin invitation state", async () => {
    const api = tenantApi();
    renderWithQuery(<CreateTenantForm api={api} />);

    fireEvent.change(screen.getByLabelText("公司名称"), {
      target: { value: "北辰客户服务" },
    });
    fireEvent.change(screen.getByLabelText("工作空间代码"), {
      target: { value: "northwind" },
    });
    fireEvent.change(screen.getByLabelText("首位管理员手机号"), {
      target: { value: "13800138000" },
    });
    // The initialization is an explicit choice: nothing is submitted without it.
    fireEvent.click(screen.getByRole("button", { name: "创建公司" }));
    expect(
      await screen.findByText("请选择从模板开始还是空白开始。"),
    ).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "空白开始" }));
    fireEvent.click(screen.getByRole("button", { name: "创建公司" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        name: "北辰客户服务",
        code: "northwind",
        firstAdminPhone: "13800138000",
        initialization: "BLANK",
      }),
    );
    expect(screen.getByText(/是空白公司/)).toBeInTheDocument();
    expect(await screen.findByText("公司草稿已创建")).toBeInTheDocument();
    expect(screen.getByText("等待管理员接受邀请")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看开通详情" })).toHaveAttribute(
      "href",
      "/platform/tenants/tenant-a",
    );
    expect(screen.queryByLabelText(/密码/)).not.toBeInTheDocument();
  });

  it.each(["Northwind", "north wind", "north_wind"])(
    "rejects invalid workspace code %s before calling the API",
    async (code) => {
      const api = tenantApi();
      renderWithQuery(<CreateTenantForm api={api} />);
      fireEvent.change(screen.getByLabelText("公司名称"), {
        target: { value: "北辰客户服务" },
      });
      fireEvent.change(screen.getByLabelText("工作空间代码"), {
        target: { value: code },
      });
      fireEvent.change(screen.getByLabelText("首位管理员手机号"), {
        target: { value: "13800138000" },
      });
      fireEvent.click(screen.getByRole("button", { name: "创建公司" }));

      expect(await screen.findByText(/仅支持小写字母/)).toBeInTheDocument();
      expect(api.create).not.toHaveBeenCalled();
    },
  );

  it("warns when the company name already exists but still creates the draft", async () => {
    const api = tenantApi();
    vi.mocked(api.countNameConflicts).mockResolvedValue({
      name: "北辰客户服务",
      count: 2,
    });
    renderWithQuery(<CreateTenantForm api={api} />);

    fireEvent.change(screen.getByLabelText("公司名称"), {
      target: { value: "北辰客户服务" },
    });
    fireEvent.blur(screen.getByLabelText("公司名称"));

    expect(
      await screen.findByText("已有 2 家公司使用相同名称，仍可继续创建。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/工作空间代码全局唯一/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("工作空间代码"), {
      target: { value: "northwind-west" },
    });
    fireEvent.change(screen.getByLabelText("首位管理员手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "空白开始" }));
    fireEvent.click(screen.getByRole("button", { name: "创建公司" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        name: "北辰客户服务",
        code: "northwind-west",
        firstAdminPhone: "13800138000",
        initialization: "BLANK",
      }),
    );
  });

  it("initializes from the current version of a chosen published template", async () => {
    const api = tenantApi();
    vi.mocked(api.create).mockResolvedValue({
      id: "tenant-b",
      name: "南星贸易",
      code: "nanxing",
      status: "DRAFT",
      activeAdminCount: 0,
      initialization: {
        templateName: "标准 CRM",
        templateVersionNo: 3,
        objectCount: 4,
      },
    });
    const templates = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            id: "template-1",
            name: "标准 CRM",
            activeVersion: { id: "version-3", versionNo: 3 },
          },
        ],
        page: 1,
        limit: 100,
        total: 1,
      }),
    };
    renderWithQuery(
      <CreateTenantForm api={api} templates={templates as never} />,
    );
    fireEvent.change(screen.getByLabelText("公司名称"), {
      target: { value: "南星贸易" },
    });
    fireEvent.change(screen.getByLabelText("工作空间代码"), {
      target: { value: "nanxing" },
    });
    fireEvent.change(screen.getByLabelText("首位管理员手机号"), {
      target: { value: "13800138001" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "从模板开始" }));
    fireEvent.mouseDown(await screen.findByLabelText("模板"));
    fireEvent.click(await screen.findByTitle("标准 CRM · v3"));
    fireEvent.click(screen.getByRole("button", { name: "创建公司" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        name: "南星贸易",
        code: "nanxing",
        firstAdminPhone: "13800138001",
        initialization: "TEMPLATE",
        templateId: "template-1",
        templateVersionId: "version-3",
      }),
    );
    expect(
      await screen.findByText(/复制 4 张业务表，全部是未发布的草稿/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /首位管理员接受邀请后，由平台启用公司，再由公司管理员在「业务表」中检查并发布/,
      ),
    ).toBeInTheDocument();
  });
});

describe("TenantStatusActions", () => {
  it("disables activation until an active administrator exists", () => {
    renderWithQuery(
      <TenantStatusActions
        tenant={{
          id: "tenant-a",
          name: "北辰客户服务",
          code: "northwind",
          status: "DRAFT",
          activeAdminCount: 0,
        }}
        api={tenantApi()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "启用公司" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("当前不能启用公司")).toBeInTheDocument();
  });

  it("does not offer reactivation for a closed company", () => {
    renderWithQuery(
      <TenantStatusActions
        tenant={{
          id: "tenant-a",
          name: "北辰客户服务",
          code: "northwind",
          status: "CLOSED",
          activeAdminCount: 1,
        }}
        api={tenantApi()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "启用公司" }),
    ).not.toBeInTheDocument();
  });
});

describe("TenantTable", () => {
  it("writes server pagination to the page URL", () => {
    const navigate = vi.fn();
    render(
      <TenantTable
        navigate={navigate}
        data={{
          items: [
            {
              id: "tenant-a",
              name: "北辰客户服务",
              code: "northwind",
              status: "DRAFT",
              activeAdminCount: 0,
            },
          ],
          page: 1,
          limit: 20,
          total: 21,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "right" }));
    expect(navigate).toHaveBeenCalledWith("/platform/tenants?page=2");
  });

  it("links the company name to the tenant detail page", () => {
    render(
      <TenantTable
        data={{
          items: [
            {
              id: "tenant-a",
              name: "北辰客户服务",
              code: "northwind",
              status: "ACTIVE",
              activeAdminCount: 1,
              createdAt: "2026-08-21T00:00:00.000Z",
            },
          ],
          page: 1,
          limit: 20,
          total: 1,
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "北辰客户服务" })).toHaveAttribute(
      "href",
      "/platform/tenants/tenant-a",
    );
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.queryByText("行业")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "公司列表" })).toHaveAttribute(
      "data-surface",
      "data",
    );
  });
});

it("keeps server filters while moving to the next company page", () => {
  const navigate = vi.fn();
  render(
    <TenantTable
      navigate={navigate}
      filters={{ status: "DRAFT", search: "north" }}
      data={{
        items: [
          {
            id: "a",
            name: "North",
            code: "north",
            status: "DRAFT",
            activeAdminCount: 1,
          },
        ],
        page: 1,
        limit: 20,
        total: 21,
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "right" }));
  expect(navigate).toHaveBeenCalledWith(
    "/platform/tenants?status=DRAFT&search=north&page=2",
  );
});

it("only renews the first admin invitation after confirmation", async () => {
  const api = {
    ...tenantApi(),
    renewFirstAdminInvitation: vi.fn().mockResolvedValue({}),
  };
  renderWithQuery(
    <TenantStatusActions
      api={api}
      tenant={{
        id: "a",
        name: "Recovery",
        code: "recovery",
        status: "DRAFT",
        activeAdminCount: 0,
        firstAdminInvitation: {
          id: "i",
          targetPhone: "+8613800138000",
          role: "TENANT_ADMIN",
          status: "EXPIRED",
          expiresAt: "2026-01-01",
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新邀请管理员" }));
  expect(api.renewFirstAdminInvitation).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "重新邀请" }));
  await waitFor(() =>
    expect(api.renewFirstAdminInvitation).toHaveBeenCalledWith("a"),
  );
});

it("keeps a closed company read-only with no reactivation or reason form", () => {
  renderWithQuery(
    <TenantStatusActions
      api={tenantApi()}
      tenant={{
        id: "a",
        name: "Closed",
        code: "closed",
        status: "CLOSED",
        activeAdminCount: 1,
      }}
    />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText(/公司已关闭，不能重新启用/)).toBeInTheDocument();
});
