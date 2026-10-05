import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkspacePage from "./page";
import NamedDashboardPage from "./dashboards/[dashboardCode]/page";

const { get, requireUser, requireWorkspace, requireRuntimeObjects } =
  vi.hoisted(() => ({
    get: vi.fn(),
    requireUser: vi.fn(),
    requireWorkspace: vi.fn(),
    requireRuntimeObjects: vi.fn(),
  }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server-client", () => ({
  createServerApiClient: async () => ({ GET: get }),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser }));
vi.mock("@/lib/auth/require-workspace", () => ({ requireWorkspace }));
vi.mock("@/lib/auth/require-runtime-objects", () => ({
  requireRuntimeObjects,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/workspace/northwind",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@ant-design/charts", () => ({ Bar: () => null, Line: () => null }));
vi.mock("@/features/follow-ups/follow-up-workbench", () => ({
  PersonalFollowUpWorkbench: () => (
    <section aria-label="我的跟进">可处理的个人任务</section>
  ),
}));

const params = Promise.resolve({
  tenantCode: "northwind",
  dashboardCode: "sales",
});
const searchParams = Promise.resolve({ from: "2026-08-01", to: "2026-08-31" });
const routes = [
  {
    name: "default",
    page: WorkspacePage,
    path: "/api/v1/workspaces/{tenantCode}/dashboards/overview",
    dashboardCode: undefined,
  },
  {
    name: "named",
    page: NamedDashboardPage,
    path: "/api/v1/workspaces/{tenantCode}/dashboards/{dashboardCode}/overview",
    dashboardCode: "sales",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  requireUser.mockResolvedValue({ displayName: "李明" });
  requireWorkspace.mockResolvedValue({
    tenantCode: "northwind",
    tenantName: "百杰",
    role: "EMPLOYEE",
  });
  requireRuntimeObjects.mockResolvedValue([]);
});

for (const route of routes) {
  describe(`${route.name} dashboard route`, () => {
    it("keeps personal tasks available when the overview request rejects", async () => {
      get.mockRejectedValue(new Error("private upstream stack"));
      render(await route.page({ params, searchParams }));
      expect(
        screen.getByRole("region", { name: "我的跟进" }),
      ).toHaveTextContent("可处理的个人任务");
      expect(
        screen.getByRole("button", { name: "重试工作台概览" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
      expect(get).toHaveBeenCalledWith(route.path, {
        params: {
          path: {
            tenantCode: "northwind",
            ...(route.dashboardCode
              ? { dashboardCode: route.dashboardCode }
              : {}),
          },
          query: { from: "2026-08-01", to: "2026-08-31" },
        },
      });
    });

    it("isolates server failure with its request ID and no private error text", async () => {
      get.mockResolvedValue({
        error: {
          status: 503,
          code: "QUERY_FAILED",
          message: "private SQL details",
          requestId: "req_overview",
          fieldErrors: {},
        },
        response: { status: 503 },
      });
      render(await route.page({ params, searchParams }));
      expect(screen.getByText(/req_overview/)).toBeInTheDocument();
      expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
    });

    it("preserves Next redirect control flow", async () => {
      const error = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/login;307;",
      });
      get.mockRejectedValue(error);
      await expect(route.page({ params, searchParams })).rejects.toBe(error);
    });

    it.each([400, 401, 403, 404])(
      "preserves authoritative overview status %s",
      async (status) => {
        const error = {
          status,
          code: "ACCESS_DENIED",
          message: "无权访问",
          requestId: "req_auth",
          fieldErrors: {},
        };
        get.mockResolvedValue({ error, response: { status } });
        await expect(
          route.page({ params, searchParams }),
        ).rejects.toMatchObject(error);
      },
    );

    it("does not hide identity or workspace permission failures", async () => {
      const error = new Error("authoritative auth boundary");
      requireWorkspace.mockRejectedValue(error);
      get.mockRejectedValue(new Error("overview failed too"));
      await expect(route.page({ params, searchParams })).rejects.toBe(error);
    });
  });
}
