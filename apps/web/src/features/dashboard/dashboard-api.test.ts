import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ POST: vi.fn() }));

vi.mock("@/lib/api/browser-client", () => ({ browserApiClient: mocks }));

import { previewDashboardDraft } from "./dashboard-api";

describe("previewDashboardDraft", () => {
  beforeEach(() => mocks.POST.mockReset());

  it("sends only the requested instant range and leaves timezone to the server", async () => {
    mocks.POST.mockResolvedValue({
      data: {
        title: "工作台",
        period: {
          from: "2026-08-01T00:00:00.000Z",
          to: "2026-09-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
        widgets: [],
      },
      response: new Response(null, { status: 200 }),
    });

    await previewDashboardDraft("northwind", { expectedVersion: 4 });

    expect(mocks.POST.mock.calls[0]?.[1].body.period).toEqual({
      from: expect.any(String),
      to: expect.any(String),
    });
  });
});
