import type { components } from "@crm/contracts";

export type WorkspaceView =
  components["schemas"]["WorkspaceSummaryResponseDto"] & {
    lastAccessedAt?: string;
  };

export function isActiveWorkspace(workspace: WorkspaceView): boolean {
  return (
    workspace.tenantStatus === "ACTIVE" && workspace.memberStatus === "ACTIVE"
  );
}

export function deniedWorkspaceRoute(
  workspaces: readonly WorkspaceView[],
): "/waiting" | "/workspaces?unavailable=1" {
  return workspaces.length === 0 ? "/waiting" : "/workspaces?unavailable=1";
}
