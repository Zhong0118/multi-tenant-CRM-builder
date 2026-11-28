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
import { CompanyTelephony } from "./company-telephony";
import { PlatformTelephonyPlans } from "./plans-page";

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

describe("通话套餐", () => {
  it("列出套餐，保存前校验月售价", async () => {
    api.POST.mockResolvedValue({ data: { ...plan, id: "p2" } });
    show(<PlatformTelephonyPlans />);
    expect(await screen.findByText("标准版")).toBeInTheDocument();
    expect(screen.getByText("¥120.00")).toBeInTheDocument();
    // In use by a company: no delete.
    expect(screen.queryByRole("button", { name: /删\s*除/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建套餐" }));
    fireEvent.change(await screen.findByLabelText("套餐名称"), {
      target: { value: "旗舰版" },
    });
    fireEvent.change(screen.getByLabelText("月售价（元）"), {
      target: { value: "1.234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(
      await screen.findByText("请输入金额，最多两位小数"),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("月售价（元）"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/platform/telephony-plans",
        {
          body: {
            name: "旗舰版",
            seats: 5,
            monthlyMinutes: 1000,
            monthlyPrice: "300",
            assignable: true,
          },
        },
      ),
    );
  });

  it("只有没公司在用的套餐能删，删除时带版本号", async () => {
    api.GET.mockImplementation(async () => ({
      data: [{ ...plan, companies: 0 }],
    }));
    api.DELETE.mockResolvedValue({
      response: new Response(null, { status: 204 }),
    });
    show(<PlatformTelephonyPlans />);
    fireEvent.click(await screen.findByRole("button", { name: /删\s*除/ }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /删\s*除/,
      }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        "/api/v1/platform/telephony-plans/{id}",
        { params: { path: { id: "p1" }, query: { version: 2 } } },
      ),
    );
  });

  it("收支标签按公司列出收入、成本、毛利和合计", async () => {
    show(<PlatformTelephonyPlans />);
    fireEvent.click(await screen.findByRole("tab", { name: "收支" }));
    expect(await screen.findByText("星云科技")).toBeInTheDocument();
    expect(screen.getAllByText("¥129.70")).toHaveLength(2);
    expect(screen.getByText("合计")).toBeInTheDocument();
    expect(
      screen.getByText(/坐席成本按当前坐席月进价 ¥10.00 计算/),
    ).toBeInTheDocument();
  });
});

describe("公司通话服务", () => {
  it("显示本月分钟和坐席，加分钟带本月和幂等键", async () => {
    api.POST.mockResolvedValue({
      data: { applied: true, month: "2026-11-01" },
    });
    show(<CompanyTelephony tenantId="t" />);
    expect(await screen.findByText("标准版")).toBeInTheDocument();
    expect(screen.getByText("坐席 2 / 3")).toBeInTheDocument();
    expect(screen.getByText(/月中加量/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加分钟" }));
    fireEvent.change(await screen.findByLabelText("增加分钟"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("收费（元）"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认加量" }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/platform/tenants/{tenantId}/telephony/minutes",
        {
          params: { path: { tenantId: "t" } },
          body: {
            month: "2026-11-01",
            minutes: 50,
            price: "30",
            note: "",
            idempotencyKey: expect.any(String),
          },
        },
      ),
    );
  });

  it("可以换套餐，也可以改回未开通", async () => {
    api.PATCH.mockResolvedValue({
      data: { ...company, planId: null, planName: null },
    });
    show(<CompanyTelephony tenantId="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "更换套餐" }));
    fireEvent.mouseDown(await screen.findByLabelText("通话套餐"));
    fireEvent.click(await screen.findByTitle("未开通"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /保\s*存/,
      }),
    );
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        "/api/v1/platform/tenants/{tenantId}/telephony",
        {
          params: { path: { tenantId: "t" } },
          body: { version: 1, planId: null },
        },
      ),
    );
  });
});
