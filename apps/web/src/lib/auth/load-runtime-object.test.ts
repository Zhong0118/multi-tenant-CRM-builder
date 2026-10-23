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
    mocks.get.mockResolvedValueOnce(ok({ object: { code: "customers" } }));
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
