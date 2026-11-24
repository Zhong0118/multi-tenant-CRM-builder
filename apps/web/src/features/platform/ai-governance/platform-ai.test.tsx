import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformPlans } from "./plans";
import { CompanyAi } from "./company";
import { PlatformAiSettings } from "./settings";
const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
}));
vi.mock("@/lib/api/browser-client", () => ({ browserApiClient: api }));
const plan = {
  id: "p",
  name: "试用版",
  description: "",
  companies: 3,
  assignable: true,
  monthlyTokens: "10000000",
  features: ["assistant"],
  version: 1,
};
const company = {
  tenantId: "t",
  name: "示例公司",
  month: "2026-11-01",
  startedAt: "2026-11-23T17:12:00Z",
  restoresAt: "2026-12-01T00:00:00Z",
  planId: "p",
  planName: "试用版",
  features: ["assistant"],
  usedTokens: "0",
  totalTokens: "10000000",
  remainingTokens: "10000000",
  trend: [],
  usage: [],
};
import { catalogFixture } from "../../ai-governance/catalog.fixture";
const settings = {
  catalog: catalogFixture,
  configured: true,
  disabled: false,
  provider: "DeepSeek",
  model: "flash",
  affectedCompanies: 3,
  version: 4,
  defaultPlanId: "p",
  anomalies: [],
  reason: null,
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
    data: path.endsWith("plans")
      ? [plan]
      : path.endsWith("settings")
        ? settings
        : company,
  }));
});
describe("平台 AI 治理", () => {
  it("即将上线的销售功能不可勾选", async () => {
    show(<PlatformPlans />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    expect(
      await screen.findByRole("checkbox", { name: /今日建议/ }),
    ).toBeDisabled();
  });
  it("只在编辑时挂载套餐抽屉，以便服务器和客户端使用相同的初始结构", async () => {
    show(<PlatformPlans />);
    const edit = await screen.findByRole("button", { name: "编辑" });
    expect(document.querySelector(".ant-drawer")).toBeNull();
    fireEvent.click(edit);
    expect(await screen.findByDisplayValue("试用版")).toBeVisible();
  });
  it("正在使用的套餐先预览影响范围，再确认保存", async () => {
    api.POST.mockResolvedValue({
      data: {
        confirmation: "preview-token",
        companies: 3,
        removedFeatures: [],
      },
    });
    api.PATCH.mockResolvedValue({ data: plan });
    show(<PlatformPlans />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await screen.findByText(/将影响 3 家公司/);
    expect(api.PATCH).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        "/api/v1/platform/ai-plans/{id}",
        expect.objectContaining({
          body: expect.objectContaining({ confirmation: "preview-token" }),
        }),
      ),
    );
  });
  it("本月无用量仍可加量，确认时才提交本月和幂等键", async () => {
    api.POST.mockResolvedValue({ data: { applied: true } });
    show(<CompanyAi tenantId="t" />);
    await screen.findByText("本月还没有使用 AI");
    expect(screen.getByText(/2026-11-24 起计量/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "本月加量" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "增加额度（万 token）" }),
      { target: { value: "12.3" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "确认加量" }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/platform/tenants/{id}/ai/quota",
        expect.objectContaining({
          body: {
            amount: "123000",
            month: "2026-11-01",
            idempotencyKey: expect.any(String),
          },
        }),
      ),
    );
  });
  it("紧急关闭需要原因和二次确认", async () => {
    api.PATCH.mockResolvedValue({ data: {} });
    show(<PlatformAiSettings />);
    fireEvent.click(
      await screen.findByRole("button", { name: "紧急关闭全部公司的 AI" }),
    );
    const modal = screen.getByRole("dialog");
    expect(within(modal).getByText(/3 家公司/)).toBeInTheDocument();
    expect(
      within(modal).getByRole("button", { name: "确认关闭" }),
    ).toBeDisabled();
    fireEvent.change(within(modal).getByRole("textbox", { name: "关闭原因" }), {
      target: { value: "模型异常" },
    });
    fireEvent.click(within(modal).getByRole("button", { name: "确认关闭" }));
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith("/api/v1/platform/ai-settings", {
        body: {
          disabled: true,
          reason: "模型异常",
          version: 4,
          defaultPlanId: "p",
        },
      }),
    );
  });
});
