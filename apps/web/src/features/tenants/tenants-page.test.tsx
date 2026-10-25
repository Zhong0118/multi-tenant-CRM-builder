import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, refresh } = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/api/server-client", () => ({
  createServerApiClient: async () => ({ GET: get }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
import TenantsPage from "@/app/(platform)/platform/tenants/page";

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (path: string) =>
    path.endsWith("/summary")
      ? {
          error: { message: "统计不可用" },
          response: new Response(null, { status: 503 }),
        }
      : {
          data: { items: [], page: 1, limit: 20, total: 0 },
          response: new Response(null, { status: 200 }),
        },
  );
});
describe("platform companies server page", () => {
  it("keeps status filters and retry when only the summary request fails", async () => {
    render(
      await TenantsPage({
        searchParams: Promise.resolve({ status: "ACTIVE" }),
      }),
    );
    const all = screen.getByRole("link", { name: "全部" });
    expect(all).toHaveAttribute("href", "/platform/tenants");
    expect(screen.getByRole("link", { name: "运行中" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("公司状态统计暂时无法读取")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载统计" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("ignores repeated query parameters instead of throwing before fetching", async () => {
    await TenantsPage({
      searchParams: Promise.resolve({
        search: ["x", "y"],
        status: ["ACTIVE", "DRAFT"],
        page: ["2", "3"],
      }),
    });
    expect(get).toHaveBeenCalledWith("/api/v1/platform/tenants", {
      params: { query: { page: 1, limit: 20 } },
    });
  });
});
