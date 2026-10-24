import { notFound } from "next/navigation";

import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { workspaceSettingsNavigation } from "@/components/navigation/workspace-navigation";
import { SettingsOverview } from "@/features/settings/settings-overview";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface WorkspaceSettingsPageProps {
  params: Promise<{ tenantCode: string }>;
}

/**
 * The settings home: the same groups as the settings sidebar, one row per page
 * with what it is for, when it takes effect and where it stands (Linear, Attio).
 */
export default async function WorkspaceSettingsPage({
  params,
}: WorkspaceSettingsPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  const client = await createServerApiClient();
  const [objects, members, invitations] = await Promise.all([
    client.GET("/api/v1/workspaces/{tenantCode}/object-definitions", {
      params: { path: { tenantCode } },
    }),
    client.GET("/api/v1/workspaces/{tenantCode}/members", {
      params: { path: { tenantCode }, query: { page: 1, limit: 1 } },
    }),
    client.GET("/api/v1/workspaces/{tenantCode}/invitations", {
      params: { path: { tenantCode } },
    }),
  ]);
  const drafts = objects.data ?? [];
  const active = drafts.filter(
    (draft) => draft.object.status === "ACTIVE",
  ).length;
  const pending = drafts.filter(
    (draft) => draft.object.hasUnpublishedChanges,
  ).length;
  const pendingInvitations = invitations.data
    ? invitations.data.items.filter((item) => item.status === "PENDING").length
    : 0;
  const memberValue = members.data
    ? [
        `${members.data.total} 人`,
        `${members.data.activeAdminCount} 位管理员`,
        pendingInvitations
          ? `${pendingInvitations}${invitations.data?.nextCursor ? "+" : ""} 个邀请待接受`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const groups = workspaceSettingsNavigation(tenantCode).filter(
    (group) => !group.items.every((item) => item.icon === "overview"),
  );

  return (
    <Page width="settings">
      <PageHeader
        title="设置"
        description="公司的成员与权限、业务数据结构和安全记录。"
      />
      <SettingsOverview
        groups={groups}
        objectsHref={`/workspace/${tenantCode}/settings/objects`}
        status={{
          pendingTables: pending,
          values: {
            members: memberValue,
            object: objects.data
              ? `${active} 张使用中${pending ? ` · ${pending} 张待发布` : ""}`
              : null,
          },
        }}
      />
    </Page>
  );
}
