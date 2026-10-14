import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server-client", () => ({
  createServerApiClient: vi.fn().mockResolvedValue({ GET: mocks.get }),
}));
vi.mock("@/features/objects/object-types", () => ({
  parseRuntimeObjectSchema: (value: unknown) => value,
}));
import { loadRuntimeObject, loadRecordPage } from "./load-runtime-object";
const ok = (data: unknown) => ({
  data,
  response: new Response(null, { status: 200 }),
});
describe("runtime record pool requests", () => {
  beforeEach(() => mocks.get.mockReset());
  it("loads active assignment choices beyond the first admin roster page", async () => {
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
    expect(result.members).toHaveLength(101);
    expect(result.members.at(-1)?.displayName).toBe("末页成员");
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
