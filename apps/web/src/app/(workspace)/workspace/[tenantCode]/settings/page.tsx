import Link from "next/link";
import { Typography } from "antd";

import styles from "@/features/objects/objects.module.css";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface WorkspaceSettingsPageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function WorkspaceSettingsPage({
  params,
}: WorkspaceSettingsPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  const isAdmin = workspace.role === "TENANT_ADMIN";

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>WORKSPACE SETTINGS</span>
        <h1>工作空间设置</h1>
        <p>管理当前公司的基础配置。</p>
      </header>
      <section className={styles.panel}>
        {isAdmin ? (
          <>
            <div className={styles.sectionHeading}>
              <h2>业务对象</h2>
            </div>
            <Typography.Paragraph type="secondary">
              配置业务对象的字段、列表视图和员工权限，并发布给成员使用。
            </Typography.Paragraph>
            <Link href={`/workspace/${tenantCode}/settings/objects`}>
              进入业务对象配置
            </Link>
          </>
        ) : (
          <Typography.Paragraph type="secondary">
            公司配置由公司管理员维护。你可以继续使用已授权的业务功能。
          </Typography.Paragraph>
        )}
      </section>
    </main>
  );
}
