import { describe, expect, it } from "vitest";

import { resolvePostLoginRoute } from "./post-login-route";

function activeWorkspace(tenantCode: string) {
  return {
    tenantCode,
    tenantStatus: "ACTIVE" as const,
    memberStatus: "ACTIVE" as const,
  };
}

describe("resolvePostLoginRoute", () => {
  it("routes users by the number of available workspaces", () => {
    expect(resolvePostLoginRoute({ workspaces: [], returnTo: null })).toBe(
      "/waiting",
    );
    expect(
      resolvePostLoginRoute({
        workspaces: [activeWorkspace("acme")],
        returnTo: null,
      }),
    ).toBe("/workspace/acme");
    expect(
      resolvePostLoginRoute({
        workspaces: [activeWorkspace("acme"), activeWorkspace("globex")],
        returnTo: null,
      }),
    ).toBe("/workspaces");
  });

  it("counts only active tenant and membership combinations for routing", () => {
    const inactiveOnly = [
      {
        tenantCode: "paused",
        tenantStatus: "SUSPENDED" as const,
        memberStatus: "ACTIVE" as const,
      },
    ];
    const mixed = [
      {
        tenantCode: "acme",
        tenantStatus: "ACTIVE" as const,
        memberStatus: "ACTIVE" as const,
      },
      ...inactiveOnly,
    ];

    expect(resolvePostLoginRoute({ workspaces: inactiveOnly })).toBe(
      "/waiting",
    );
    expect(resolvePostLoginRoute({ workspaces: mixed })).toBe(
      "/workspace/acme",
    );
    expect(
      resolvePostLoginRoute({
        workspaces: mixed,
        returnTo: "/workspace/paused",
      }),
    ).toBe("/workspace/acme");
  });

  it("keeps a safe relative return path", () => {
    expect(
      resolvePostLoginRoute({
        workspaces: [activeWorkspace("acme")],
        returnTo: "/account/security?from=login",
      }),
    ).toBe("/account/security?from=login");
  });

  it("revalidates workspace and platform access before returning", () => {
    const workspaces = [activeWorkspace("acme")];

    expect(
      resolvePostLoginRoute({
        workspaces,
        returnTo: "/workspace/acme",
      }),
    ).toBe("/workspace/acme");
    expect(
      resolvePostLoginRoute({
        workspaces,
        returnTo: "/workspace/acme/members",
      }),
    ).toBe("/workspace/acme");
    expect(
      resolvePostLoginRoute({
        workspaces,
        returnTo: "/workspace/acme/members",
        canAccessReturnTo: (pathname) => pathname.endsWith("/members"),
      }),
    ).toBe("/workspace/acme/members");
    expect(
      resolvePostLoginRoute({ workspaces, returnTo: "/workspace/globex" }),
    ).toBe("/workspace/acme");
    expect(
      resolvePostLoginRoute({ workspaces, returnTo: "/platform/tenants" }),
    ).toBe("/workspace/acme");
    expect(
      resolvePostLoginRoute({
        workspaces,
        returnTo: "/platform/tenants",
        isPlatformAdmin: true,
      }),
    ).toBe("/platform/tenants");
  });

  it("requires explicit ownership authorization for invitation deep links", () => {
    expect(
      resolvePostLoginRoute({
        workspaces: [],
        returnTo: "/invitations/invitation-a",
      }),
    ).toBe("/waiting");
    expect(
      resolvePostLoginRoute({
        workspaces: [],
        returnTo: "/invitations/invitation-a",
        canAccessReturnTo: (pathname) =>
          pathname === "/invitations/invitation-a",
      }),
    ).toBe("/invitations/invitation-a");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%2F%2Fevil.example",
  ])("rejects unsafe return path %s", (returnTo) => {
    expect(resolvePostLoginRoute({ workspaces: [], returnTo })).toBe(
      "/waiting",
    );
  });
});
