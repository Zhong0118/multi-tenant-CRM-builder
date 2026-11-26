import { Alert, Button, Space } from "antd";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountShell } from "@/components/layout/account-shell";
import { PageHeader } from "@/components/layout/page-header";
import { StatePanel } from "@/components/workbench/state-panel";
import { isActiveWorkspace } from "@/features/workspaces/workspace-access";
import { WorkspaceList } from "@/features/workspaces/workspace-list";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";

import styles from "../account.module.css";

export interface WorkspacesPageProps {
  searchParams: Promise<{ unavailable?: string }>;
}

export default async function WorkspacesPage({
  searchParams,
}: WorkspacesPageProps) {
  const user = await requireUser("/workspaces");
  const client = await createServerApiClient();
  const { data: workspaces, response } = await client.GET(
    "/api/v1/me/workspaces",
  );
  if (!workspaces && response.status >= 500) {
    throw new Error("工作空间列表暂时不可用。");
  }
  const active = (workspaces ?? []).filter(isActiveWorkspace);
  const { unavailable } = await searchParams;
  if (active.length === 1 && !unavailable) {
    redirect(`/workspace/${encodeURIComponent(active[0].tenantCode)}`);
  }
  // No company at all: the waiting page is where invitations arrive, so an
  // empty chooser would only point there. Platform admins stay to reach the
  // management centre.
  if (
    workspaces &&
    workspaces.length === 0 &&
    !unavailable &&
    !user.isPlatformAdmin
  ) {
    redirect("/waiting");
  }

  return (
    <AccountShell
      current="workspaces"
      user={{
        displayName: user.displayName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
      }}
    >
      <PageHeader title="选择工作空间" />
      <div>
        {unavailable ? (
          <Alert
            className={styles.notice}
            type="warning"
            showIcon
            title="无法进入该工作空间"
            description="公司还在开通中或你的成员身份已停用。"
          />
        ) : null}
        {active.length === 0 && (workspaces ?? []).length === 0 ? (
          <StatePanel
            title="还没有加入公司"
            description={
              user.isPlatformAdmin
                ? "可以在管理中心开通公司；被公司邀请后，工作空间会出现在这里。"
                : "接受公司邀请后，工作空间会出现在这里。"
            }
            action={
              user.isPlatformAdmin ? (
                <Space wrap>
                  <Link href="/platform">
                    <Button type="primary">进入管理中心</Button>
                  </Link>
                  <Link href="/waiting">查看公司邀请</Link>
                </Space>
              ) : (
                <Link href="/waiting">
                  <Button type="primary">查看公司邀请</Button>
                </Link>
              )
            }
          />
        ) : (
          <WorkspaceList workspaces={workspaces ?? []} />
        )}
      </div>
    </AccountShell>
  );
}
