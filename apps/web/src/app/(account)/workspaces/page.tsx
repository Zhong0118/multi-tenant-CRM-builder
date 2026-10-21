import { Alert } from "antd";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountShell } from "@/components/layout/account-shell";
import { PageHeader } from "@/components/layout/page-header";
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

  return (
    <AccountShell current="workspaces">
      <PageHeader
        title="选择工作空间"
        description={`${user.displayName}，选择要进入的公司。开通中的公司会显示为等待平台启用。`}
      />
      <div>
        {unavailable ? (
          <Alert
            className={styles.notice}
            type="warning"
            showIcon
            title="无法进入该工作空间"
            description="若公司仍是草稿，请等待平台启用。其他不可用的成员关系会保留显示，但不能进入。"
          />
        ) : null}
        {active.length === 0 && (workspaces ?? []).length === 0 ? (
          <Alert
            type="info"
            showIcon
            title="尚未加入公司"
            description={<Link href="/waiting">返回等待页查看公司邀请</Link>}
          />
        ) : (
          <WorkspaceList workspaces={workspaces ?? []} />
        )}
      </div>
    </AccountShell>
  );
}
