import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server-client", () => ({
  createServerApiClient: vi.fn().mockResolvedValue({ GET: mocks.get }),
}));

import { requireRuntimeObjects } from "./require-runtime-objects";

function navigationItem(overrides: Record<string, unknown> = {}) {
  return {
    code: "customers",
    name: "客户资料",
    icon: null,
    sortOrder: 10,
    canCreate: true,
    canRead: true,
    canUpdate: true,
    ...overrides,
  };
}

describe("requireRuntimeObjects", () => {
  beforeEach(() => mocks.get.mockReset());

  it("requests the accessible objects of the current workspace", async () => {
    mocks.get.mockResolvedValue({
      data: [navigationItem()],
      response: new Response(null, { status: 200 }),
    });

    await requireRuntimeObjects("northwind");

    expect(mocks.get).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects",
      { params: { path: { tenantCode: "northwind" } } },
    );
  });

  it("orders business objects by configured order then code", async () => {
    mocks.get.mockResolvedValue({
      data: [
        navigationItem({ code: "opportunities", sortOrder: 20 }),
        navigationItem({ code: "leads", sortOrder: 10 }),
        navigationItem({ code: "customers", sortOrder: 10 }),
      ],
      response: new Response(null, { status: 200 }),
    });

    const objects = await requireRuntimeObjects("northwind");

    expect(objects.map((object) => object.code)).toEqual([
      "customers",
      "leads",
      "opportunities",
    ]);
  });

  it("drops objects the member cannot read", async () => {
    mocks.get.mockResolvedValue({
      data: [
        navigationItem({ code: "customers" }),
        navigationItem({ code: "journals", canRead: false }),
      ],
      response: new Response(null, { status: 200 }),
    });

    const objects = await requireRuntimeObjects("northwind");

    expect(objects.map((object) => object.code)).toEqual(["customers"]);
  });

  it("degrades to an empty navigation instead of breaking the workspace shell", async () => {
    mocks.get.mockResolvedValue({
      error: {
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用，请稍后重试。",
        fieldErrors: {},
        requestId: "req_objects_5xx",
        status: 503,
      },
      response: new Response(null, { status: 503 }),
    });

    await expect(requireRuntimeObjects("northwind")).resolves.toEqual([]);
  });
});
