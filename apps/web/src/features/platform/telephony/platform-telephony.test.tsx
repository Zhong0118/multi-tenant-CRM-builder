import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  lineState,
  PlatformTelephonyLine,
  PlatformTelephonySummary,
} from "./line-settings";

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
}));
vi.mock("@/lib/api/browser-client", () => ({ browserApiClient: api }));

const line = {
  version: 3,
  mode: "KUAIMA" as const,
  companyId: "131",
  hasAppSecret: true,
  hasCallbackToken: false,
  callbackEndpoint: "https://api.example.com/api/v1/telephony/hooks",
  liveEnabled: false,
  mockAllowed: true,
  costPerMinute: "0.1500",
  seatMonthlyCost: "10.00",
  ready: false,
  problems: [
    "回调地址未生成",
    "服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）",
  ],
  seats: 4,
};
const plan = {
  id: "p1",
  name: "标准版",
  seats: 3,
  monthlyMinutes: 1000,
  monthlyPrice: "120.00",
  assignable: true,
  version: 2,
  companies: 1,
};
const company = {
  tenantId: "t",
  version: 1,
  planId: "p1",
  planName: "标准版",
  seats: 3,
  monthlyMinutes: 100,
  month: "2026-11-01",
  usedMinutes: 2,
  extraMinutes: 30,
  allowance: 130,
  seatsEnabled: 2,
  additions: [
    {
      month: "2026-11-01",
      minutes: 30,
      price: "30.00",
      note: "月中加量",
      createdAt: "2026-11-20T08:00:00.000Z",
    },
  ],
};
const report = {
  month: "2026-11",
  seatMonthlyCost: "10.00",
  rows: [
    {
      tenantId: "t",
      tenantName: "星云科技",
      planName: "标准版",
      monthlyMinutes: 100,
      usedMinutes: 2,
      extraMinutes: 30,
      allowance: 130,
      planPrice: "120.00",
      extraPrice: "30.00",
      revenue: "150.00",
      minuteCost: "0.30",
      seatCost: "20.00",
      cost: "20.30",
      margin: "129.70",
      seatsProvisioned: 2,
    },
  ],
  total: { usedMinutes: 2, revenue: "150.00", cost: "20.30", margin: "129.70" },
};
function show(ui: React.ReactNode) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith("telephony-settings")
      ? line
      : path.endsWith("telephony-plans")
        ? [plan]
        : path.endsWith("telephony-report")
          ? report
          : company,
  }));
});

describe("平台电话线路", () => {
  it("写明线路缺什么，密钥留空就不修改", async () => {
    api.PATCH.mockResolvedValue({
      data: { ...line, version: 4, companyId: "132" },
    });
    show(<PlatformTelephonyLine />);
    expect(await screen.findByText("回调地址未生成")).toBeInTheDocument();
    expect(
      screen.getByText("服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("快马企业 ID"), {
      target: { value: "132" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        "/api/v1/platform/telephony-settings",
        {
          body: {
            version: 3,
            mode: "KUAIMA",
            companyId: "132",
            costPerMinute: "0.1500",
            seatMonthlyCost: "10.00",
          },
        },
      ),
    );
  });

  it("新的回调地址只显示这一次", async () => {
    const url = "https://api.example.com/api/v1/telephony/hooks?token=abc";
    api.POST.mockResolvedValue({
      data: { settings: { ...line, hasCallbackToken: true }, callbackUrl: url },
    });
    show(<PlatformTelephonyLine />);
    fireEvent.click(await screen.findByRole("button", { name: /生\s*成/ }));
    // The auto-sizing box keeps a hidden copy of its value; ask for the visible one.
    expect(
      await screen.findByRole("textbox", { name: "回调地址" }),
    ).toHaveValue(url);
    expect(
      within(screen.getByRole("dialog")).getByText(/只显示这一次/),
    ).toBeInTheDocument();
  });

  it("系统设置页显示线路状态和入口", async () => {
    show(<PlatformTelephonySummary />);
    expect(await screen.findByText("未就绪")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /管理电话线路/ })).toHaveAttribute(
      "href",
      "/platform/settings/telephony",
    );
  });

  it("就绪的线路按类型称呼", () => {
    expect(lineState({ mode: "KUAIMA", ready: true })).toEqual({
      label: "快马回拨",
      tone: "success",
    });
    expect(lineState({ mode: "MOCK", ready: true }).label).toBe("模拟线路");
    expect(lineState({ mode: "KUAIMA", ready: false }).label).toBe("未就绪");
  });
});
