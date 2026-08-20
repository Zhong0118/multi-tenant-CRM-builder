import { describe, expect, it } from "vitest";

import { deniedWorkspaceRoute, type WorkspaceView } from "./workspace-access";

const inactiveWorkspace: WorkspaceView = {
  tenantId: "tenant-paused",
  tenantCode: "paused",
  tenantName: "暂停服务公司",
  tenantStatus: "SUSPENDED",
  memberId: "member-paused",
  memberStatus: "ACTIVE",
  role: "EMPLOYEE",
};

describe("deniedWorkspaceRoute", () => {
  it("distinguishes a standalone user from a user with unavailable access", () => {
    expect(deniedWorkspaceRoute([])).toBe("/waiting");
    expect(deniedWorkspaceRoute([inactiveWorkspace])).toBe(
      "/workspaces?unavailable=1",
    );
  });
});
