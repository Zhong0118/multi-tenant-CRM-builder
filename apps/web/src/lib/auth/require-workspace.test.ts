import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/api/server-client", () => ({
  createServerApiClient: vi.fn().mockResolvedValue({ GET: mocks.get }),
}));

import { requireWorkspace } from "./require-workspace";

describe("requireWorkspace", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.redirect.mockClear();
  });

  it("surfaces an authoritative workspace 5xx without masking it as denied access", async () => {
    mocks.get
      .mockResolvedValueOnce({
        error: {
          code: "INTERNAL_ERROR",
          message: "服务暂时不可用，请稍后重试。",
          fieldErrors: {},
          requestId: "req_workspace_5xx",
          status: 503,
        },
        response: new Response(null, { status: 503 }),
      })
      .mockResolvedValueOnce({
        data: [],
        response: new Response(null, { status: 200 }),
      });

    await expect(requireWorkspace("northwind")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 503,
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
