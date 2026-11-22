import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server-client", () => ({
  createServerApiClient: vi.fn().mockResolvedValue({ GET: mocks.get }),
}));
vi.mock("@/features/objects/object-types", () => ({
  parseRuntimeObjectSchema: (value: unknown) => value,
}));
import {
  loadRuntimeObject,
  loadRecordPage,
  loadRecord,
} from "./load-runtime-object";
const ok = (data: unknown) => ({
  data,
  response: new Response(null, { status: 200 }),
});
describe("runtime record pool requests", () => {
  beforeEach(() => mocks.get.mockReset());
  it("loads the whole admin roster across pages and labels disabled members", async () => {
    mocks.get
      .mockResolvedValueOnce(ok({ object: { code: "customers" } }))
      .mockResolvedValueOnce(
        ok({
          items: Array.from({ length: 100 }, (_, i) => ({
            id: `member-${i}`,
            status: "ACTIVE",
            displayName: `成员 ${i}`,
          })),
          total: 102,
          page: 1,
          limit: 100,
        }),
      )
      .mockResolvedValueOnce(
        ok({
          items: [
            { id: "member-100", status: "ACTIVE", displayName: "末页成员" },
            { id: "member-101", status: "DISABLED", displayName: "停用成员" },
          ],
          total: 102,
          page: 2,
          limit: 100,
        }),
      );
    const result = await loadRuntimeObject(
      "northwind",
      "customers",
      "TENANT_ADMIN",
    );
    // Disabled members stay so the records they own show a name; pickers
    // (memberSelectOptions) offer only the active ones.
    expect(result.members).toHaveLength(102);
    expect(result.members.at(-2)).toEqual({
      id: "member-100",
      displayName: "末页成员",
      status: "ACTIVE",
    });
    expect(result.members.at(-1)).toEqual({
      id: "member-101",
      displayName: "停用成员",
      status: "DISABLED",
    });
    expect(mocks.get.mock.calls[2][1].params.query).toEqual({
      page: 2,
      limit: 100,
    });
  });
  it("never requests the tenant roster for an employee", async () => {
    mocks.get.mockResolvedValueOnce(
      ok({
        object: { code: "customers" },
        scopes: { read: "OWN", update: "OWN" },
      }),
    );
    const result = await loadRuntimeObject(
      "northwind",
      "customers",
      "EMPLOYEE",
    );
    expect(result.members).toEqual([]);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("labels GROUP owners from scoped names without requesting the tenant roster", async () => {
    const ownerMembers = [
      { id: "leader", displayName: "组长", status: "ACTIVE" },
      { id: "teammate", displayName: "钱宇", status: "DISABLED" },
    ];
    mocks.get.mockResolvedValueOnce(
      ok({
        object: { code: "customers" },
        scopes: { read: "GROUP", update: "OWN" },
        ownerMembers,
      }),
    );
    const result = await loadRuntimeObject(
      "northwind",
      "customers",
      "EMPLOYEE",
    );
    expect(result.members).toEqual(ownerMembers);
    expect(result.isAdmin).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("discards scoped names when the effective read scope has fallen back to OWN", async () => {
    mocks.get.mockResolvedValueOnce(
      ok({
        object: { code: "customers" },
        scopes: { read: "OWN", update: "OWN" },
        ownerMembers: [
          { id: "former-teammate", displayName: "钱宇", status: "ACTIVE" },
        ],
      }),
    );
    const result = await loadRuntimeObject(
      "northwind",
      "customers",
      "EMPLOYEE",
    );
    expect(result.members).toEqual([]);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("passes the URL pool scope into the server record request", async () => {
    mocks.get.mockResolvedValueOnce(
      ok({ items: [], total: 0, page: 1, limit: 20 }),
    );
    await loadRecordPage("northwind", "customers", {
      page: 1,
      limit: 20,
      filters: {},
      sort: "updatedAt",
      direction: "desc",
      scope: "pool",
    });
    expect(mocks.get.mock.calls[0][1].params.query.scope).toBe("pool");
  });
});

describe("authorized archived runtime links", () => {
  it.each(["schema", "list", "record"])(
    "preserves archived meaning for %s instead of invoking notFound",
    async (kind) => {
      mocks.get.mockResolvedValueOnce({
        error: {
          code: "OBJECT_ARCHIVED",
          status: 409,
          message: "业务表已停用",
          requestId: "archived-test",
        },
        response: new Response(null, { status: 409 }),
      });
      const load =
        kind === "schema"
          ? loadRuntimeObject("northwind", "customers", "EMPLOYEE")
          : kind === "record"
            ? loadRecord("northwind", "customers", "r1")
            : loadRecordPage("northwind", "customers", {
                page: 1,
                limit: 20,
                filters: {},
                sort: "updatedAt",
                direction: "desc",
              });
      await expect(load).rejects.toMatchObject({ code: "OBJECT_ARCHIVED" });
    },
  );
});

it.each([403, 404])(
  "keeps inaccessible objects private for HTTP %s",
  async (status) => {
    mocks.get.mockResolvedValueOnce({
      error: {
        code: "OBJECT_NOT_FOUND",
        status,
        message: "对象不可用",
        requestId: "private-test",
      },
      response: new Response(null, { status }),
    });
    await expect(
      loadRuntimeObject("northwind", "customers", "EMPLOYEE"),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  },
);

describe("server record view access", () => {
  const base = {
    page: 2,
    limit: 20,
    filters: {},
    sort: "recordNo",
    direction: "asc" as const,
  };
  const viewId = "f5000000-0000-4000-8000-000000000001";
  it("sends only saved identity and pagination to the records endpoint", async () => {
    mocks.get
      .mockReset()
      .mockResolvedValue(ok({ items: [], total: 0, page: 2, limit: 20 }));
    await loadRecordPage("northwind", "customers", {
      ...base,
      viewId,
      search: "stale",
    });
    expect(mocks.get.mock.lastCall?.[1].params.query).toEqual({
      page: 2,
      limit: 20,
      viewId,
    });
  });
  it.each([
    ["RECORD_NOT_FOUND", 404],
    ["RECORD_FILTER_INVALID", 400],
  ] as const)(
    "uses a safe recoverable view state on %s",
    async (code, status) => {
      mocks.get.mockReset().mockResolvedValue({
        error: { code, status, message: "private field", requestId: "r" },
        response: new Response(null, { status }),
      });
      await expect(
        loadRecordPage("northwind", "customers", { ...base, viewId }),
      ).rejects.toMatchObject({ message: "该视图条件不可用" });
      expect(mocks.get).toHaveBeenCalledTimes(1);
    },
  );
  it("shows an object-level permission state when access to the table is revoked", async () => {
    mocks.get.mockReset().mockResolvedValue({
      error: {
        code: "OBJECT_ACTION_FORBIDDEN",
        status: 403,
        message: "无权读取",
        requestId: "r",
      },
      response: new Response(null, { status: 403 }),
    });
    await expect(
      loadRuntimeObject("northwind", "customers", "EMPLOYEE"),
    ).rejects.toMatchObject({ message: "访问受限" });
  });
});

it("does not request preview rows after a source view has been revoked", async () => {
  mocks.get.mockReset().mockResolvedValueOnce(ok({ available: false }));
  await expect(
    loadRecordPage("northwind", "customers", {
      page: 1,
      limit: 20,
      sort: "recordNo",
      direction: "asc",
      filters: {},
      baseViewId: "private-id",
      filterRule: { version: 1, match: "all", conditions: [] },
    }),
  ).rejects.toThrow("该视图条件不可用");
  expect(mocks.get).toHaveBeenCalledTimes(1);
  expect(mocks.get.mock.calls[0][0]).toMatch(/record-views/);
});

it("resolves an untouched table through its permission-projected default view before loading rows", async () => {
  const { resolveInitialRecordQuery } = await import("./load-runtime-object");
  mocks.get.mockReset().mockResolvedValueOnce(
    ok({
      items: [
        { code: "all", id: "team-view", available: false },
        {
          code: "my_records",
          id: "my-view",
          name: "我负责的",
          available: true,
        },
      ],
    }),
  );
  const query = {
    page: 1,
    limit: 20,
    sort: "updatedAt",
    direction: "desc" as const,
    filters: {},
  };
  const schema = {
    scopes: { read: "ALL" },
    defaultView: { sort: { field: "updatedAt", direction: "desc" } },
  } as unknown as import("@/features/objects/object-types").RuntimeObjectSchema;
  await expect(
    resolveInitialRecordQuery("northwind", "customers", query, schema),
  ).rejects.toMatchObject({
    message: "该视图条件不可用",
    fallback: { id: "my-view", name: "我负责的" },
  });
  mocks.get.mockResolvedValueOnce(
    ok({ items: [{ code: "all", id: "team-view", available: true }] }),
  );
  await expect(
    resolveInitialRecordQuery("northwind", "customers", query, schema),
  ).resolves.toEqual({ ...query, viewId: "team-view" });
});
