import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { templateApi } from "./template-api";
import { TenantBusinessConfiguration } from "./template-application";
import type { BusinessTemplateVersion } from "./template-types";

function renderWithQuery(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })}
    >
      {ui}
    </QueryClientProvider>,
  );
}

const tenant = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "北辰客户服务",
  code: "northwind",
  status: "DRAFT" as const,
};

const publishedTemplate = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "销售 CRM",
  code: "sales-crm",
  description: "客户与商机模板",
  draftVersion: 2,
  status: "PUBLISHED",
  hasUnpublishedChanges: false,
  activeVersion: {
    id: "33333333-3333-4333-8333-333333333333",
    versionNo: 1,
    sourceDraftVersion: 2,
    publishedAt: "2026-08-26T08:00:00.000Z",
  },
  publishedAt: "2026-08-26T08:00:00.000Z",
  objectCount: 2,
  fieldCount: 4,
  applicationCount: 0,
  createdAt: "2026-08-26T08:00:00.000Z",
  updatedAt: "2026-08-26T08:00:00.000Z",
};

function publishedTemplateDetail() {
  return {
    ...publishedTemplate,
    configuration: {
      schemaVersion: 1,
      objects: [
        { id: "object-1", code: "customers", name: "草稿客户" },
        { id: "object-2", code: "quotes", name: "草稿报价" },
      ],
    },
  };
}

function activeVersion(): BusinessTemplateVersion {
  return activeVersionFor(publishedTemplate, "客户");
}

function activeVersionFor(
  template: { id: string; activeVersion: { id: string } },
  activeObjectName: string,
): BusinessTemplateVersion {
  return {
    id: template.activeVersion.id,
    templateId: template.id,
    versionNo: 1,
    sourceDraftVersion: 1,
    schemaVersion: 1,
    configurationChecksum: "published-checksum",
    configuration: {
      schemaVersion: 1,
      objects: [
        templateObject(
          "published-object-1",
          "customers",
          activeObjectName,
          "ACTIVE",
        ),
        templateObject(
          "published-object-2",
          "opportunities",
          "停用跟单",
          "INACTIVE",
        ),
      ],
    },
    changeSummary: [],
    publishedByUserId: "user-1",
    publishedAt: "2026-08-26T08:00:00.000Z",
  } as BusinessTemplateVersion;
}

function templateObject(
  id: string,
  code: string,
  name: string,
  status: "ACTIVE" | "INACTIVE",
) {
  return {
    id,
    code,
    name,
    description: null,
    icon: null,
    titleFieldKey: "name",
    sortOrder: 1,
    status,
    fields: [],
    defaultView: null,
    employeeAccess: null,
  };
}

function applicationResult() {
  return {
    id: "application-1",
    templateId: publishedTemplate.id,
    templateName: publishedTemplate.name,
    templateCode: publishedTemplate.code,
    templateVersionId: publishedTemplate.activeVersion.id,
    templateVersionNo: 1,
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantCode: tenant.code,
    appliedByUserId: "user-1",
    appliedAt: "2026-08-26T08:00:00.000Z",
    configurationChecksum: "checksum",
    objects: [
      { templateObjectId: "published-object-1", objectId: "tenant-object-1", code: "customers", name: "客户" },
    ],
  };
}

describe("TenantBusinessConfiguration", () => {
  it("previews and applies only active objects from the selected immutable version", async () => {
    const api = templateApi({
      list: vi.fn().mockResolvedValue({ items: [publishedTemplate], page: 1, limit: 20, total: 1 }),
      detail: vi.fn().mockResolvedValue(publishedTemplateDetail()),
      listVersions: vi.fn().mockResolvedValue([activeVersion()]),
      apply: vi.fn().mockResolvedValue(applicationResult()),
    });
    renderWithQuery(
      <TenantBusinessConfiguration
        tenant={tenant}
        initialSummary={{ objectCount: 0, canApplyTemplate: true, blockingReason: null, application: null }}
        api={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "应用业务模板" }));

    expect(await screen.findByText("将创建对象草稿，不会直接上线")).toBeInTheDocument();
    expect(screen.getByText("当前版本：v1")).toBeInTheDocument();
    expect(screen.getByText("包含 1 个业务对象")).toBeInTheDocument();
    expect(screen.getByText("客户")).toBeInTheDocument();
    expect(screen.queryByText("草稿客户")).not.toBeInTheDocument();
    expect(screen.queryByText("草稿报价")).not.toBeInTheDocument();
    expect(screen.queryByText("停用跟单")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));

    expect(await screen.findByText("已生成 1 个对象草稿")).toBeInTheDocument();
    expect(screen.getByText("客户（customers）")).toBeInTheDocument();
    expect(screen.getByText("来源模板版本：销售 CRM v1")).toBeInTheDocument();
    expect(screen.getByText("请由公司管理员审核、调整并发布这些对象草稿。"))
      .toBeInTheDocument();
    expect(api.apply).toHaveBeenCalledWith(publishedTemplate.id, {
      tenantId: tenant.id,
      templateVersionId: publishedTemplate.activeVersion.id,
    });
  });

  it("shows a retryable API error when the selected version cannot load", async () => {
    const api = templateApi({
      list: vi.fn().mockResolvedValue({ items: [publishedTemplate], page: 1, limit: 20, total: 1 }),
      listVersions: vi
        .fn()
        .mockRejectedValueOnce({
          code: "INTERNAL_ERROR",
          message: "模板版本暂时不可用。",
          fieldErrors: {},
          requestId: "req_version_load",
          status: 503,
        })
        .mockResolvedValueOnce([activeVersion()]),
    });
    renderWithQuery(
      <TenantBusinessConfiguration
        tenant={tenant}
        initialSummary={{ objectCount: 0, canApplyTemplate: true, blockingReason: null, application: null }}
        api={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "应用业务模板" }));

    expect(await screen.findByText("加载模板版本失败")).toBeInTheDocument();
    expect(screen.getByText("模板版本暂时不可用。（请求编号：req_version_load）"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));

    expect(await screen.findByText("客户")).toBeInTheDocument();
  });

  it("keeps the modal open and selection locked while application is pending", async () => {
    const pending = deferred<ReturnType<typeof applicationResult>>();
    const api = templateApi({
      list: vi.fn().mockResolvedValue({ items: [publishedTemplate], page: 1, limit: 20, total: 1 }),
      listVersions: vi.fn().mockResolvedValue([activeVersion()]),
      apply: vi.fn(() => pending.promise),
    });
    renderWithQuery(
      <TenantBusinessConfiguration
        tenant={tenant}
        initialSummary={{ objectCount: 0, canApplyTemplate: true, blockingReason: null, application: null }}
        api={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "应用业务模板" }));
    await screen.findByText("将创建对象草稿，不会直接上线");
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认应用" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: /取\s*消/ })).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();

    pending.resolve(applicationResult());

    expect(await screen.findByText("已生成 1 个对象草稿")).toBeInTheDocument();
  });

  it("clears the failed application message when switching to another template", async () => {
    const renewalTemplate = {
      ...publishedTemplate,
      id: "44444444-4444-4444-8444-444444444444",
      name: "续费 CRM",
      code: "renewal-crm",
      activeVersion: {
        ...publishedTemplate.activeVersion,
        id: "55555555-5555-4555-8555-555555555555",
      },
    };
    const api = templateApi({
      list: vi.fn().mockResolvedValue({
        items: [publishedTemplate, renewalTemplate],
        page: 1,
        limit: 20,
        total: 2,
      }),
      listVersions: vi.fn().mockImplementation((templateId: string) =>
        Promise.resolve([
          templateId === renewalTemplate.id
            ? activeVersionFor(renewalTemplate, "续费客户")
            : activeVersion(),
        ]),
      ),
      apply: vi.fn().mockRejectedValue({
        code: "TEMPLATE_APPLICATION_NOT_ALLOWED",
        message: "模板 A 无法应用。",
        fieldErrors: {},
        requestId: "req_template_a",
        status: 409,
      }),
    });
    renderWithQuery(
      <TenantBusinessConfiguration
        tenant={tenant}
        initialSummary={{ objectCount: 0, canApplyTemplate: true, blockingReason: null, application: null }}
        api={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "应用业务模板" }));
    await screen.findByText("将创建对象草稿，不会直接上线");
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    expect(await screen.findByText(/req_template_a/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("combobox"));
    const renewalOption = await waitFor(() => {
      const option = document.querySelector<HTMLElement>(
        '.ant-select-item-option[title="续费 CRM · v1"]',
      );
      expect(option).not.toBeNull();
      return option;
    });
    fireEvent.click(renewalOption);

    await waitFor(() =>
      expect(screen.queryByText(/req_template_a/)).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("续费客户")).toBeInTheDocument();
  });

  it("does not offer template application when the company already has objects", () => {
    renderWithQuery(
      <TenantBusinessConfiguration
        tenant={tenant}
        initialSummary={{
          objectCount: 1,
          canApplyTemplate: false,
          blockingReason: "TARGET_NOT_EMPTY",
          application: null,
        }}
        api={templateApi()}
      />,
    );

    expect(screen.queryByRole("button", { name: "应用业务模板" })).not.toBeInTheDocument();
    expect(screen.getByText("公司已有业务对象，不能使用初始化模板。"))
      .toBeInTheDocument();
  });

  it("explains that a non-draft company cannot apply an initialization template", () => {
    renderWithQuery(
      <TenantBusinessConfiguration
        tenant={{ ...tenant, status: "ACTIVE" }}
        initialSummary={{
          objectCount: 0,
          canApplyTemplate: false,
          blockingReason: "TENANT_NOT_DRAFT",
          application: null,
        }}
        api={templateApi()}
      />,
    );

    expect(screen.getByText("只有草稿状态的公司可以使用初始化模板。"))
      .toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
