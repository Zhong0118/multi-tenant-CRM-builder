import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { templateApi, type TemplateApi } from "./template-api";
import {
  addField,
  emptyTemplateDraft,
  toTemplateConfiguration,
} from "./template-draft";
import { TemplateEditor } from "./template-editor";
import type {
  BusinessTemplateDetail,
  BusinessTemplateVersion,
  SaveTemplateDraftInput,
  TemplatePublicationAnalysis,
} from "./template-types";

function detail(
  overrides: Partial<BusinessTemplateDetail> = {},
): BusinessTemplateDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "sales_crm",
    name: "销售 CRM",
    description: "客户与商机模板",
    draftVersion: 3,
    status: "CHANGED",
    hasUnpublishedChanges: true,
    activeVersion: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      versionNo: 1,
      sourceDraftVersion: 2,
      publishedAt: "2026-08-20T08:00:00.000Z",
    },
    publishedAt: "2026-08-20T08:00:00.000Z",
    objectCount: 1,
    fieldCount: 1,
    applicationCount: 0,
    createdAt: "2026-08-20T07:00:00.000Z",
    updatedAt: "2026-08-21T08:00:00.000Z",
    configuration: {
      schemaVersion: 1,
      objects: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          code: "customers",
          name: "客户",
          description: "销售团队维护的客户资料",
          icon: null,
          titleFieldKey: "name",
          sortOrder: 1,
          status: "ACTIVE",
          publishedCode: "customers",
          fields: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              fieldKey: "name",
              label: "客户名称",
              type: "TEXT",
              required: true,
              defaultValue: null,
              validation: {},
              config: { help: "填写客户工商名称" },
              sortOrder: 1,
              isSystem: false,
              status: "ACTIVE",
              publishedFieldKey: "name",
              publishedType: "TEXT",
            },
          ],
          defaultView: {
            code: "default",
            name: "客户列表",
            columnFieldKeys: ["name"],
            sort: { field: "updatedAt", direction: "desc" },
          },
          employeeAccess: {
            canCreate: true,
            canRead: true,
            canUpdate: true,
            canDelete: false,
            readScope: "ALL",
            updateScope: "OWN",
            fields: { name: "READ_ONLY" },
          },
        },
      ],
    },
    ...overrides,
  } as BusinessTemplateDetail;
}

function version(versionNo = 1): BusinessTemplateVersion {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${versionNo}`,
    templateId: "11111111-1111-4111-8111-111111111111",
    versionNo,
    sourceDraftVersion: versionNo + 1,
    schemaVersion: 1,
    configurationChecksum: `checksum-${versionNo}`,
    configuration: detail().configuration,
    changeSummary: [],
    publishedByUserId: "44444444-4444-4444-8444-444444444444",
    publishedAt: `2026-08-2${versionNo}T08:00:00.000Z`,
  } as BusinessTemplateVersion;
}

function analysis(
  overrides: Partial<TemplatePublicationAnalysis> = {},
): TemplatePublicationAnalysis {
  return {
    blocking: [],
    warnings: [],
    changes: [
      {
        entity: "OBJECT",
        kind: "UPDATED",
        objectId: "22222222-2222-4222-8222-222222222222",
      },
    ],
    objectCount: 1,
    fieldCount: 1,
    ...overrides,
  };
}

function editorApi(overrides: Partial<TemplateApi> = {}): TemplateApi {
  return templateApi({
    list: vi.fn(),
    create: vi.fn(),
    detail: vi.fn().mockResolvedValue(detail()),
    saveDraft: vi.fn().mockImplementation(async (_id: string, input: SaveTemplateDraftInput) =>
      detail({
        draftVersion: input.expectedVersion + 1,
        configuration: input.configuration as BusinessTemplateDetail["configuration"],
      }),
    ),
    analyzePublication: vi.fn().mockResolvedValue(analysis()),
    publish: vi.fn().mockResolvedValue(version(2)),
    listVersions: vi.fn().mockResolvedValue([version(2), version(1)]),
    ...overrides,
  });
}

function renderEditor(
  initialTemplate = detail(),
  api = editorApi(),
  initialVersions: BusinessTemplateVersion[] = [version()],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TemplateEditor
        initialTemplate={initialTemplate}
        initialVersions={initialVersions}
        api={api}
      />
    </QueryClientProvider>,
  );
}

describe("template draft aggregate", () => {
  it("adds a field with a stable template-local id and one canonical permission source", () => {
    const next = addField(emptyTemplateDraft(), "object-1", {
      id: "field-1",
      fieldKey: "name",
      label: "名称",
      type: "TEXT",
    });

    expect(next.objects[0]?.fields[0]).toMatchObject({
      id: "field-1",
      fieldKey: "name",
      type: "TEXT",
      employeeAccess: "EDIT",
    });
    expect(toTemplateConfiguration(next).objects[0]).toMatchObject({
      employeeAccess: { fields: { name: "EDIT" } },
      fields: [{ id: "field-1", fieldKey: "name", type: "TEXT" }],
    });
    expect(toTemplateConfiguration(next).objects[0]?.fields[0]).not.toHaveProperty(
      "employeeAccess",
    );
  });
});

describe("TemplateEditor save and publication flow", () => {
  it("marks local edits unsaved and disables publication until the whole draft saves", async () => {
    const api = editorApi();
    renderEditor(detail(), api);

    fireEvent.click(screen.getByRole("button", { name: "新建业务对象" }));

    expect(screen.getByText("有未保存变更")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发布模板" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布模板" })).toBeEnabled(),
    );
    expect(api.saveDraft).toHaveBeenCalledWith(
      detail().id,
      expect.objectContaining({
        expectedVersion: 3,
        name: "销售 CRM",
        description: "客户与商机模板",
        configuration: expect.objectContaining({
          schemaVersion: 1,
          objects: expect.arrayContaining([
            expect.objectContaining({ code: "customers" }),
          ]),
        }),
      }),
    );
  });

  it("preserves local objects and shows the request id when a save conflicts", async () => {
    const api = editorApi({
      saveDraft: vi.fn().mockRejectedValue({
        code: "TEMPLATE_VERSION_CONFLICT",
        message: "模板草稿已被其他管理员更新。",
        fieldErrors: {},
        requestId: "req_template_conflict",
        status: 409,
      }),
    });
    renderEditor(detail(), api);

    fireEvent.click(screen.getByRole("button", { name: "新建业务对象" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(await screen.findByText(/req_template_conflict/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "模板对象清单" })).getByText(
        "新业务对象",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("有未保存变更")).toBeInTheDocument();
  });

  it("groups blockers by object before publishing and refreshes detail and history", async () => {
    const api = editorApi({
      analyzePublication: vi.fn().mockResolvedValue(
        analysis({
          blocking: [
            {
              code: "TITLE_FIELD_REQUIRED",
              message: "标题字段必须启用并设为必填。",
              objectId: "22222222-2222-4222-8222-222222222222",
              fieldKey: "name",
            },
          ],
        }),
      ),
      detail: vi.fn().mockResolvedValue(
        detail({
          draftVersion: 3,
          hasUnpublishedChanges: false,
          status: "PUBLISHED",
          activeVersion: {
            id: version(2).id,
            versionNo: 2,
            sourceDraftVersion: 3,
            publishedAt: version(2).publishedAt,
          },
        }),
      ),
    });
    renderEditor(detail(), api);

    fireEvent.click(screen.getByRole("button", { name: "发布模板" }));
    const panel = await screen.findByRole("dialog", { name: "发布模板" });
    expect((await within(panel).findAllByText("客户")).length).toBeGreaterThan(0);
    expect(within(panel).getByText("标题字段必须启用并设为必填。")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "确认发布" })).toBeDisabled();

    api.analyzePublication = vi.fn().mockResolvedValue(analysis());
    fireEvent.click(within(panel).getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: /发布模板/ }));
    const readyPanel = await screen.findByRole("dialog", { name: "发布模板" });
    await waitFor(() =>
      expect(
        within(readyPanel).getByRole("button", { name: "确认发布" }),
      ).toBeEnabled(),
    );
    fireEvent.click(within(readyPanel).getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(api.publish).toHaveBeenCalledWith(detail().id, 3));
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith(detail().id));
    await waitFor(() => expect(api.listVersions).toHaveBeenCalledWith(detail().id));
    expect(await screen.findByText("v2 当前发布身份")).toBeInTheDocument();
  });
});
