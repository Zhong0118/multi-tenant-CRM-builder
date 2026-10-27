import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, requireWorkspace } = vi.hoisted(() => ({
  get: vi.fn(),
  requireWorkspace: vi.fn(),
}));
vi.mock("@/lib/api/server-client", () => ({
  createServerApiClient: async () => ({ GET: get }),
}));
vi.mock("@/lib/auth/require-workspace", () => ({ requireWorkspace }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import MemberAccessPage from "@/app/(workspace)/workspace/[tenantCode]/members/[memberId]/access/page";

describe("member access server page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireWorkspace.mockResolvedValue({
      role: "TENANT_ADMIN",
      memberId: "admin",
    });
    get.mockImplementation(async (path: string) => ({
      data: path.endsWith("/member-groups")
        ? {
            items: [
              {
                id: "group-a",
                name: "销售组",
                version: 1,
                leaderMemberId: "far-member",
                memberIds: ["far-member"],
              },
            ],
            members: [
              {
                id: "far-member",
                displayName: "远页员工",
                status: "ACTIVE",
                role: "EMPLOYEE",
                groupId: "group-a",
              },
            ],
          }
        : path.endsWith("/members")
          ? { items: [], page: 1, limit: 100, total: 150, activeAdminCount: 1 }
          : [],
      response: new Response(null, { status: 200 }),
    }));
  });

  it("resolves leader identity independently of the first member directory page", async () => {
    const page = await MemberAccessPage({
      params: Promise.resolve({
        tenantCode: "northwind",
        memberId: "far-member",
      }),
    });
    const access = page.props.children[1];
    expect(access.props.memberName).toBe("远页员工");
    expect(access.props.isGroupLeader).toBe(true);
    expect(access.props.groupName).toBe("销售组");
    expect(get).not.toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/members",
      expect.anything(),
    );
  });

  it("does not treat a failed group lookup as proof the member is no longer a leader", async () => {
    get.mockImplementation(async (path: string) =>
      path.endsWith("/member-groups")
        ? {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "小组读取失败",
              requestId: "req_group",
              status: 503,
            },
            response: new Response(null, { status: 503 }),
          }
        : {
            data: path.endsWith("/members")
              ? {
                  items: [],
                  page: 1,
                  limit: 100,
                  total: 150,
                  activeAdminCount: 1,
                }
              : [],
            response: new Response(null, { status: 200 }),
          },
    );
    await expect(
      MemberAccessPage({
        params: Promise.resolve({
          tenantCode: "northwind",
          memberId: "far-member",
        }),
      }),
    ).rejects.toThrow("小组读取失败");
  });

  it("prevents employees from loading another member's permission controls", async () => {
    requireWorkspace.mockResolvedValue({
      role: "EMPLOYEE",
      memberId: "employee",
    });
    await expect(
      MemberAccessPage({
        params: Promise.resolve({
          tenantCode: "northwind",
          memberId: "far-member",
        }),
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(get).not.toHaveBeenCalled();
  });
});
