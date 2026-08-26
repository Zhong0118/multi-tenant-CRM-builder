import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { templateApi } from "./template-api";
import { TenantBusinessConfiguration } from "./template-application";

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
        { id: "object-1", code: "customers", name: "客户" },
        { id: "object-2", code: "opportunities", name: "跟单" },
      ],
    },
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
      { templateObjectId: "object-1", objectId: "tenant-object-1", code: "customers", name: "客户" },
      { templateObjectId: "object-2", objectId: "tenant-object-2", code: "opportunities", name: "跟单" },
    ],
  };
}

describe("TenantBusinessConfiguration", () => {
  it("shows the selected current version and resulting drafts after application", async () => {
    const api = templateApi({
      list: vi.fn().mockResolvedValue({ items: [publishedTemplate], page: 1, limit: 20, total: 1 }),
      detail: vi.fn().mockResolvedValue(publishedTemplateDetail()),
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
    expect(screen.getByText("包含 2 个业务对象")).toBeInTheDocument();
    expect(screen.getByText("客户、跟单")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));

    expect(await screen.findByText("已生成 2 个对象草稿")).toBeInTheDocument();
    expect(screen.getByText("客户（customers）")).toBeInTheDocument();
    expect(screen.getByText("跟单（opportunities）")).toBeInTheDocument();
    expect(screen.getByText("来源模板版本：销售 CRM v1")).toBeInTheDocument();
    expect(screen.getByText("请由公司管理员审核、调整并发布这些对象草稿。"))
      .toBeInTheDocument();
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
