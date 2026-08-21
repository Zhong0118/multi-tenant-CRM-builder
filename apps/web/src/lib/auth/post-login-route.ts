import type { components } from "@crm/contracts";

type Workspace = Pick<
  components["schemas"]["WorkspaceSummaryResponseDto"],
  "tenantCode" | "tenantStatus" | "memberStatus"
>;

export interface PostLoginRouteInput {
  workspaces: readonly Workspace[];
  returnTo?: string | null;
  isPlatformAdmin?: boolean;
  canAccessReturnTo?: (pathname: string) => boolean;
}

export function resolvePostLoginRoute({
  workspaces,
  returnTo,
  isPlatformAdmin = false,
  canAccessReturnTo,
}: PostLoginRouteInput): string {
  const activeWorkspaces = workspaces.filter(
    (workspace) =>
      workspace.tenantStatus === "ACTIVE" &&
      workspace.memberStatus === "ACTIVE",
  );
  const safeReturnTo = toSafeRelativePath(returnTo);
  if (
    safeReturnTo &&
    isAuthorizedPath(
      safeReturnTo,
      activeWorkspaces,
      isPlatformAdmin,
      canAccessReturnTo,
    )
  ) {
    return safeReturnTo;
  }

  if (isPlatformAdmin) return "/platform";

  if (activeWorkspaces.length === 0) return "/waiting";
  if (activeWorkspaces.length === 1) {
    return `/workspace/${encodeURIComponent(activeWorkspaces[0].tenantCode)}`;
  }
  return "/workspaces";
}

function isAuthorizedPath(
  value: string,
  workspaces: readonly Workspace[],
  isPlatformAdmin: boolean,
  canAccessReturnTo?: (pathname: string) => boolean,
): boolean {
  const pathname = new URL(value, "http://internal.invalid").pathname;

  if (pathname === "/waiting" || pathname === "/workspaces") return true;
  if (pathname === "/account/security") return true;
  if (/^\/invitations\/[^/]+$/u.test(pathname)) {
    return canAccessReturnTo?.(pathname) ?? false;
  }
  if (pathname === "/platform" || pathname.startsWith("/platform/")) {
    return isPlatformAdmin;
  }

  const workspaceMatch = pathname.match(/^\/workspace\/([^/]+)(?:\/.*)?$/u);
  if (!workspaceMatch) return false;

  let tenantCode: string;
  try {
    tenantCode = decodeURIComponent(workspaceMatch[1]);
  } catch {
    return false;
  }
  const hasWorkspace = workspaces.some(
    (workspace) => workspace.tenantCode === tenantCode,
  );
  if (!hasWorkspace) return false;

  const workspaceRoot = `/workspace/${workspaceMatch[1]}`;
  if (pathname === workspaceRoot) return true;
  return canAccessReturnTo?.(pathname) ?? false;
}

function toSafeRelativePath(value?: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/u.test(value)) return null;

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || decoded.includes("\\")) return null;
  } catch {
    return null;
  }

  return value;
}
