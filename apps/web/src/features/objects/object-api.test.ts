import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ GET: vi.fn() }));

vi.mock("@/lib/api/browser-client", () => ({ browserApiClient: mocks }));

import { objectApi } from "./object-api";

const schemaResponse = {
  publication: { number: 3, publishedAt: "2026-08-21T02:00:00.000Z" },
  object: {
    code: "customers",
    name: "客户资料",
    description: null,
    titleFieldKey: "customer_name",
    icon: null,
    sortOrder: 10,
  },
  fields: [
    {
      id: "field-name",
      fieldKey: "customer_name",
      label: "客户名称",
      type: "TEXT",
      required: true,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 1,
      isSystem: false,
      access: "EDIT",
    },
  ],
  defaultView: {
    code: "default",
    name: "默认视图",
    columnFieldKeys: ["customer_name"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  },
  scopes: { read: "OWN", update: "OWN" },
};

describe("objectApi", () => {
  beforeEach(() => mocks.GET.mockReset());

  it("lists accessible business objects from the generated path", async () => {
    mocks.GET.mockResolvedValue({
      data: [],
      response: new Response(null, { status: 200 }),
    });

    await objectApi.listAccessible("northwind");

    expect(mocks.GET).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects",
      { params: { path: { tenantCode: "northwind" } } },
    );
  });

  it("returns a narrowed runtime schema rather than the loose contract shape", async () => {
    mocks.GET.mockResolvedValue({
      data: schemaResponse,
      response: new Response(null, { status: 200 }),
    });

    const schema = await objectApi.runtimeSchema("northwind", "customers");

    expect(mocks.GET).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/schema",
      {
        params: { path: { tenantCode: "northwind", objectCode: "customers" } },
      },
    );
    expect(schema.scopes.read).toBe("OWN");
    expect(schema.fields[0].access).toBe("EDIT");
  });

  it("throws the stable API error envelope when an object is forbidden", async () => {
    mocks.GET.mockResolvedValue({
      error: {
        code: "OBJECT_ACTION_FORBIDDEN",
        message: "没有访问该业务对象的权限。",
        fieldErrors: {},
        requestId: "req_forbidden",
        status: 403,
      },
      response: new Response(null, { status: 403 }),
    });

    await expect(
      objectApi.runtimeSchema("northwind", "customers"),
    ).rejects.toMatchObject({ code: "OBJECT_ACTION_FORBIDDEN", status: 403 });
  });
});
