import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { templateApi, type TemplateApi } from "./template-api";
import {
  addObject,
  addField,
  buildFieldEditorPatch,
  emptyTemplateDraft,
  templateDraftFromDetail,
  updateField,
  updateObject,
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
    saveDraft: vi
      .fn()
      .mockImplementation(async (_id: string, input: SaveTemplateDraftInput) =>
        detail({
          draftVersion: input.expectedVersion + 1,
          configuration:
            input.configuration as BusinessTemplateDetail["configuration"],
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
    expect(
      toTemplateConfiguration(next).objects[0]?.fields[0],
    ).not.toHaveProperty("employeeAccess");
  });

  it("creates globally valid hyphenated object codes", () => {
    const next = addObject(emptyTemplateDraft());

    expect(next.objects.map((object) => object.object.code)).toEqual([
      "object-1",
      "object-2",
    ]);
  });

  it("ignores protected identity and ordering keys in editable patches", () => {
    const draft = templateDraftFromFixture();
    const object = draft.objects[0]!;
    const field = object.fields[0]!;
    const changedObject = updateObject(draft, object.object.id, {
      name: "更名客户",
      id: "replaced-object",
      sortOrder: 99,
      publishedCode: null,
    } as never);
    const changedField = updateField(
      changedObject,
      object.object.id,
      field.id,
      {
        label: "更名字段",
        id: "replaced-field",
        sortOrder: 99,
        publishedFieldKey: null,
        publishedType: null,
      } as never,
    );

    expect(changedField.objects[0]?.object).toMatchObject({
      id: object.object.id,
      name: "更名客户",
      sortOrder: 1,
      publishedCode: "customers",
    });
    expect(changedField.objects[0]?.fields[0]).toMatchObject({
      id: field.id,
      label: "更名字段",
      sortOrder: 1,
      publishedFieldKey: "name",
      publishedType: "TEXT",
    });
  });

  it("preserves legal unmanaged field settings and removes type-incompatible settings", () => {
    const phone = {
      ...templateDraftFromFixture().objects[0]!.fields[0]!,
      type: "PHONE" as const,
      validation: { country: "CN", minLength: 8 },
      config: { placeholder: "请输入手机号", help: "旧说明" },
    };
    const preserved = buildFieldEditorPatch(
      phone,
      editorValues({ type: "PHONE" }),
    );
    const cleaned = buildFieldEditorPatch(
      {
        ...phone,
        type: "NUMBER",
        validation: { min: 1, max: 99, scale: 2 },
        config: {
          placeholder: "请输入数字",
          options: [{ key: "legacy", label: "遗留", status: "ACTIVE" }],
        },
      },
      editorValues({ type: "TEXT", minLength: 2 }),
    );

    expect(preserved).toMatchObject({
      validation: { country: "CN" },
      config: { placeholder: "请输入手机号" },
    });
    expect(cleaned).toMatchObject({
      type: "TEXT",
      validation: { minLength: 2 },
      config: { placeholder: "请输入数字" },
    });
    expect(cleaned.validation).not.toHaveProperty("min");
    expect(cleaned.config).not.toHaveProperty("options");
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

    expect(
      await screen.findByText(/req_template_conflict/),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("complementary", { name: "模板对象清单" }),
      ).getByText("新业务对象"),
    ).toBeInTheDocument();
    expect(screen.getByText("有未保存变更")).toBeInTheDocument();
  });

  it("does not let an older save response overwrite edits made while saving", async () => {
    const pendingSave = deferred<BusinessTemplateDetail>();
    const api = editorApi({ saveDraft: vi.fn(() => pendingSave.promise) });
    renderEditor(detail(), api);
    const name = screen.getByLabelText("对象名称");

    fireEvent.change(name, { target: { value: "客户 A" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    fireEvent.change(name, { target: { value: "客户 B" } });
    pendingSave.resolve(
      detail({
        draftVersion: 4,
        configuration: {
          ...detail().configuration,
          objects: [{ ...detail().configuration.objects[0]!, name: "客户 A" }],
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("对象名称")).toHaveValue("客户 B"),
    );
    expect(screen.getByText("有未保存变更")).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "保存草稿" });
    await waitFor(() => expect(saveButton).not.toHaveClass("ant-btn-loading"));
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(api.saveDraft).toHaveBeenLastCalledWith(
        detail().id,
        expect.objectContaining({
          expectedVersion: 4,
          configuration: expect.objectContaining({
            objects: [expect.objectContaining({ name: "客户 B" })],
          }),
        }),
      ),
    );
  });

  it("closes a committed publication and retries only the failed refresh", async () => {
    const api = editorApi({
      detail: vi
        .fn()
        .mockRejectedValueOnce({
          code: "INTERNAL_ERROR",
          message: "详情刷新失败。",
          fieldErrors: {},
          requestId: "req_refresh_failed",
          status: 500,
        })
        .mockResolvedValueOnce(
          detail({ hasUnpublishedChanges: false, status: "PUBLISHED" }),
        ),
    });
    renderEditor(detail(), api);

    fireEvent.click(screen.getByRole("button", { name: "发布模板" }));
    const panel = await screen.findByRole("dialog", { name: "发布模板" });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "确认发布" }),
    );

    expect(
      await screen.findByText("模板已发布，但页面刷新失败"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "发布模板" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发布模板" })).toBeDisabled();
    expect(api.publish).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "重试刷新" }));
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
    expect(api.publish).toHaveBeenCalledTimes(1);
  });

  it("keeps edits made before a publication refresh retry", async () => {
    const api = editorApi({
      detail: vi
        .fn()
        .mockRejectedValueOnce({
          code: "INTERNAL_ERROR",
          message: "详情刷新失败。",
          fieldErrors: {},
          requestId: "req_refresh_failed_after_publish",
          status: 500,
        })
        .mockResolvedValueOnce(
          detail({
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
    fireEvent.click(
      await within(panel).findByRole("button", { name: "确认发布" }),
    );
    expect(
      await screen.findByText("模板已发布，但页面刷新失败"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("对象名称"), {
      target: { value: "刷新失败后的本地客户" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重试刷新" }));

    expect(await screen.findByText("v2 当前发布身份")).toBeInTheDocument();
    expect(screen.getByLabelText("对象名称")).toHaveValue(
      "刷新失败后的本地客户",
    );
    expect(screen.getByText("有未保存变更")).toBeInTheDocument();
  });

  it("lets the template wrapper inactivate and restore a field", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "停用字段 客户名称" }));
    expect(
      screen.getByRole("button", { name: "恢复字段 客户名称" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "字段账本" })).toHaveTextContent(
      "已停用",
    );
  });

  it("allows an empty template to receive a template-level publication blocker", async () => {
    const empty = detail({
      activeVersion: null,
      status: "DRAFT",
      configuration: { schemaVersion: 1, objects: [] },
      objectCount: 0,
      fieldCount: 0,
    });
    const api = editorApi({
      analyzePublication: vi.fn().mockResolvedValue(
        analysis({
          blocking: [
            {
              code: "TEMPLATE_OBJECT_REQUIRED",
              message: "模板至少需要一个启用的业务对象。",
              objectId: "",
            },
          ],
          changes: [],
          objectCount: 0,
          fieldCount: 0,
        }),
      ),
    });
    renderEditor(empty, api, []);

    fireEvent.click(screen.getByRole("button", { name: "发布模板" }));
    const panel = await screen.findByRole("dialog", { name: "发布模板" });
    expect(await within(panel).findByText("模板")).toBeInTheDocument();
    expect(within(panel).queryByText("未知业务对象")).not.toBeInTheDocument();
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
    expect((await within(panel).findAllByText("客户")).length).toBeGreaterThan(
      0,
    );
    expect(
      within(panel).getByText("标题字段必须启用并设为必填。"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "确认发布" }),
    ).toBeDisabled();

    api.analyzePublication = vi.fn().mockResolvedValue(analysis());
    fireEvent.click(within(panel).getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: /发布模板/ }));
    const readyPanel = await screen.findByRole("dialog", { name: "发布模板" });
    await waitFor(() =>
      expect(
        within(readyPanel).getByRole("button", { name: "确认发布" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(readyPanel).getByRole("button", { name: "确认发布" }),
    );

    await waitFor(() =>
      expect(api.publish).toHaveBeenCalledWith(detail().id, 3),
    );
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith(detail().id));
    await waitFor(() =>
      expect(api.listVersions).toHaveBeenCalledWith(detail().id),
    );
    expect(await screen.findByText("v2 当前发布身份")).toBeInTheDocument();
  });
});

function templateDraftFromFixture() {
  return templateDraftFromDetail(detail());
}

function editorValues(overrides: Record<string, unknown> = {}) {
  return {
    fieldKey: "name",
    label: "名称",
    type: "PHONE" as const,
    required: false,
    employeeAccess: "EDIT" as const,
    options: [],
    help: "",
    ...overrides,
  } as never;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
