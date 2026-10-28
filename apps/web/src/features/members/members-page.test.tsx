import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, requireWorkspace } = vi.hoisted(() => ({
  get: vi.fn(),
  requireWorkspace: vi.fn(),
}));
vi.mock("@/lib/api/server-client", () => ({
  createServerApiClient: async () => ({ GET: get }),
}));
vi.mock("@/lib/auth/require-workspace", () => ({ requireWorkspace }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import MembersPage from "@/app/(workspace)/workspace/[tenantCode]/members/page";

describe("member directory server page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireWorkspace.mockResolvedValue({
      role: "TENANT_ADMIN",
      memberId: "admin",
    });
    get.mockImplementation(async (path: string) => ({
      data: path.endsWith("/invitations")
        ? { items: [] }
        : { items: [], page: 2, limit: 50, total: 55, activeAdminCount: 2 },
      response: new Response(null, { status: 200 }),
    }));
  });

  it("forwards restored search and pagination to the API and client", async () => {
    const result = await MembersPage({
      params: Promise.resolve({ tenantCode: "northwind" }),
      searchParams: Promise.resolve({
        page: "2",
        limit: "50",
        q: " 林 ",
        role: "EMPLOYEE",
        status: "ACTIVE",
        groupId: "NONE",
      }),
    });
    expect(get).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/members",
      {
        params: {
          path: { tenantCode: "northwind" },
          query: {
            page: 2,
            limit: 50,
            q: "林",
            role: "EMPLOYEE",
            status: "ACTIVE",
            groupId: "NONE",
          },
        },
      },
    );
    expect(result.props.initialFilters).toEqual({
      q: "林",
      role: "EMPLOYEE",
      status: "ACTIVE",
      groupId: "NONE",
    });
  });

  it("ignores repeated and invalid URL values instead of throwing on array.trim", async () => {
    const result = await MembersPage({
      params: Promise.resolve({ tenantCode: "northwind" }),
      searchParams: Promise.resolve({
        q: ["林", "赵"],
        limit: ["50"],
        page: "-1",
        role: "ROOT",
        status: "UNKNOWN",
        groupId: ["NONE"],
      }),
    });
    expect(result.props.initialFilters).toEqual({});
    expect(get).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/members",
      {
        params: {
          path: { tenantCode: "northwind" },
          query: { page: 1, limit: 20 },
        },
      },
    );
  });

  it("does not load the member directory for an employee", async () => {
    requireWorkspace.mockResolvedValue({
      role: "EMPLOYEE",
      memberId: "employee",
    });
    const result = await MembersPage({
      params: Promise.resolve({ tenantCode: "northwind" }),
      searchParams: Promise.resolve({ q: "林" }),
    });
    expect(get).not.toHaveBeenCalled();
    expect(result.props.viewerRole).toBe("EMPLOYEE");
  });
});
