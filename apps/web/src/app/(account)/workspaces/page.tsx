import { Alert, Button } from "antd";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoutButton } from "@/features/auth/logout-button";
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
    <main className={styles.accountPage}>
      <header className={styles.accountHeader}>
        <div>
          <span className={styles.eyebrow}>ACCESS REGISTER</span>
          <h1>选择工作空间</h1>
          <p>
            {user.displayName}
            ，请选择你已获授权的公司。草稿公司会显示为等待平台启用，这不是权限错误。
          </p>
        </div>
        <div className={styles.accountActions}>
          <Button>
            <Link href="/account/security">账号安全</Link>
          </Button>
          <LogoutButton />
        </div>
      </header>
      <div className={styles.accountContent}>
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
    </main>
  );
}
