import { requireUser } from "@/lib/auth/require-user";
import { requireWorkspace } from "@/lib/auth/require-workspace";

import styles from "./workspace-home.module.css";

export interface WorkspacePageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const { tenantCode } = await params;
  const [user, workspace] = await Promise.all([
    requireUser(`/workspace/${encodeURIComponent(tenantCode)}`),
    requireWorkspace(tenantCode),
  ]);

  return (
    <main className={styles.home}>
      <span className={styles.eyebrow}>VERIFIED CONTEXT</span>
      <h1>工作空间已就绪</h1>
      <p>
        当前页面只显示经服务端确认的账号与工作空间身份。业务对象和记录将在后续模块中逐步开放。
      </p>
      <dl className={styles.identity}>
        <div>
          <dt>当前用户</dt>
          <dd>{user.displayName}</dd>
        </div>
        <div>
          <dt>公司</dt>
          <dd>{workspace.tenantName}</dd>
        </div>
        <div>
          <dt>成员角色</dt>
          <dd>{workspace.role === "TENANT_ADMIN" ? "公司管理员" : "员工"}</dd>
        </div>
      </dl>
    </main>
  );
}
