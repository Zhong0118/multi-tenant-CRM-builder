import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
}));

vi.mock("@/lib/api/browser-client", () => ({ browserApiClient: mocks }));

import { recordApi } from "./record-api";

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}

describe("recordApi.list", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("sends the stable list query to the generated records path", async () => {
    mocks.GET.mockResolvedValue(
      ok({ items: [], page: 2, limit: 20, total: 0 }),
    );

    await recordApi.list("northwind", "customers", {
      page: 2,
      limit: 20,
      search: "百杰",
      ownerMemberId: "member-lin",
      sort: "recordNo",
      direction: "asc",
    });

    expect(mocks.GET).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records",
      {
        params: {
          path: { tenantCode: "northwind", objectCode: "customers" },
          query: {
            page: 2,
            limit: 20,
            search: "百杰",
            ownerMemberId: "member-lin",
            sort: "recordNo",
            direction: "asc",
          },
        },
      },
    );
  });

  it("omits absent optional filters rather than sending empty values", async () => {
    mocks.GET.mockResolvedValue(
      ok({ items: [], page: 1, limit: 20, total: 0 }),
    );

    await recordApi.list("northwind", "customers", { page: 1, limit: 20 });

    expect(mocks.GET.mock.calls[0][1].params.query).toEqual({
      page: 1,
      limit: 20,
    });
  });
});

describe("recordApi mutations", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("posts a batch update to the generated nested path", async () => {
    mocks.POST.mockResolvedValue(ok({ updated: 1, failed: 0, items: [] }));

    await recordApi.batchUpdate("northwind", "customers", {
      items: [{ recordId: "record-1", version: 3 }],
      values: { lead_status: "following" },
    });

    expect(mocks.POST).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/batch",
      {
        params: {
          path: { tenantCode: "northwind", objectCode: "customers" },
        },
        body: {
          items: [{ recordId: "record-1", version: 3 }],
          values: { lead_status: "following" },
        },
      },
    );
  });

  it("creates a record with values and an optional owner", async () => {
    mocks.POST.mockResolvedValue(ok({ id: "record-1" }));

    await recordApi.create("northwind", "customers", {
      values: { customer_name: "百杰" },
      ownerMemberId: "member-lin",
    });

    expect(mocks.POST).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records",
      {
        params: {
          path: { tenantCode: "northwind", objectCode: "customers" },
        },
        body: {
          values: { customer_name: "百杰" },
          ownerMemberId: "member-lin",
        },
      },
    );
  });

  it("sends the optimistic version with every update", async () => {
    mocks.PATCH.mockResolvedValue(ok({ id: "record-1", version: 4 }));

    await recordApi.update("northwind", "customers", "record-1", {
      version: 3,
      values: { customer_name: "百杰科技" },
    });

    expect(mocks.PATCH.mock.calls[0][1].body).toEqual({
      version: 3,
      values: { customer_name: "百杰科技" },
    });
  });

  it("downloads the current list filter as a CSV attachment", async () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["id,name"], { type: "text/csv" }),
      headers: {
        get: (name: string) =>
          name === "Content-Disposition"
            ? "attachment; filename*=UTF-8''%E5%AE%A2%E6%88%B7.csv"
            : null,
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    vi.spyOn(document, "createElement").mockImplementation(((
      tag: string,
    ) => {
      if (tag === "a") {
        return { click } as unknown as HTMLAnchorElement;
      }
      return document.createElement(tag);
    }) as typeof document.createElement);

    await recordApi.export("northwind", "customers", {
      search: "百杰",
      sort: "recordNo",
      direction: "asc",
      columns: ["name", "phone"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/v1/workspaces/northwind/objects/customers/records/export?",
      ),
      { credentials: "include" },
    );
    expect(fetchMock.mock.calls[0][0]).toContain("search=");
    expect(fetchMock.mock.calls[0][0]).toContain("sort=recordNo");
    expect(fetchMock.mock.calls[0][0]).toContain("columns=name");
    expect(fetchMock.mock.calls[0][0]).toContain("columns=phone");
    expect(click).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists and appends activities on the generated nested path", async () => {
    mocks.GET.mockResolvedValue(ok({ items: [], page: 1, limit: 20, total: 0 }));
    mocks.POST.mockResolvedValue(ok({ id: "activity-1" }));

    await recordApi.listActivities("northwind", "customers", "record-1");
    await recordApi.createActivity("northwind", "customers", "record-1", {
      activityType: "NOTE",
      content: "已回访",
    });

    expect(mocks.GET).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}/activities",
      {
        params: {
          path: {
            tenantCode: "northwind",
            objectCode: "customers",
            recordId: "record-1",
          },
          query: { page: 1, limit: 20 },
        },
      },
    );
    expect(mocks.POST).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}/activities",
      {
        params: {
          path: {
            tenantCode: "northwind",
            objectCode: "customers",
            recordId: "record-1",
          },
        },
        body: { activityType: "NOTE", content: "已回访" },
      },
    );
  });

  it("sends the optimistic version with a soft delete", async () => {
    mocks.DELETE.mockResolvedValue(ok({ accepted: true }));

    await recordApi.remove("northwind", "customers", "record-1", 3);

    expect(mocks.DELETE).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}",
      {
        params: {
          path: {
            tenantCode: "northwind",
            objectCode: "customers",
            recordId: "record-1",
          },
        },
        body: { version: 3 },
      },
    );
  });
});

describe("recordApi failures", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("throws the stable API error envelope on a version conflict", async () => {
    mocks.PATCH.mockResolvedValue({
      error: {
        code: "RECORD_VERSION_CONFLICT",
        message: "记录已被其他成员更新。",
        fieldErrors: {},
        requestId: "req_conflict",
        status: 409,
      },
      response: new Response(null, { status: 409 }),
    });

    await expect(
      recordApi.update("northwind", "customers", "record-1", { version: 1 }),
    ).rejects.toMatchObject({
      code: "RECORD_VERSION_CONFLICT",
      status: 409,
      requestId: "req_conflict",
    });
  });

  it("falls back to the generic envelope when the body is not an API error", async () => {
    mocks.GET.mockResolvedValue({
      error: "<html>gateway timeout</html>",
      response: new Response(null, { status: 504 }),
    });

    await expect(
      recordApi.list("northwind", "customers", { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 504 });
  });
});
