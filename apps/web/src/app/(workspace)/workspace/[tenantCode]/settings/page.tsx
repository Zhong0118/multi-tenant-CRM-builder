import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { StatusTag } from "@/components/workbench/status-tag";
import { DataPanel, ReadingPanel } from "@/components/workbench/surface";
import styles from "@/features/settings/workspace-settings.module.css";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface WorkspaceSettingsPageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function WorkspaceSettingsPage({
  params,
}: WorkspaceSettingsPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  return (
    <main className={styles.page}>
      <PageHeader
        title="工作空间设置"
        status={<StatusTag tone="info">管理员专属</StatusTag>}
        description="管理公司的业务表、工作台，以及成员和权限。"
      />

      <div className={styles.settingsGrid}>
        <ReadingPanel className={styles.primarySetting} ariaLabel="业务表配置">
          <div>
            <h2>业务表与字段</h2>
            <p>
              新建或调整公司自己的业务表，配置字段、默认列表和员工默认权限。没有平台模板时，也可以从这里创建第一张业务表。
            </p>
          </div>
          <ol className={styles.lifecycleSteps} aria-label="修改如何生效">
            <li>
              <strong>编辑草稿</strong>
              <span>修改业务表、字段、视图和默认权限，员工暂时看不到。</span>
            </li>
            <li>
              <strong>检查并发布</strong>
              <span>发布前查看阻断项和变更摘要。</span>
            </li>
            <li>
              <strong>员工开始使用</strong>
              <span>员工页面只读取最新发布的版本。</span>
            </li>
          </ol>
          <Link
            className={styles.primaryAction}
            href={`/workspace/${tenantCode}/settings/objects`}
          >
            管理业务表
          </Link>
        </ReadingPanel>

        <DataPanel className={styles.secondarySetting} ariaLabel="成员与权限">
          <div>
            <h2>成员与权限</h2>
            <p>
              邀请管理员或员工，停用离职成员，并按业务表覆盖某位员工的操作和数据范围。
            </p>
          </div>
          <Link href={`/workspace/${tenantCode}/members`}>进入成员管理</Link>
        </DataPanel>

        <DataPanel className={styles.secondarySetting} ariaLabel="工作台与指标">
          <div>
            <h2>工作台与指标</h2>
            <p>
              绑定已发布业务表的指标、分布和列表。先发布业务表，再配置管理工作台。
            </p>
          </div>
          <Link href={`/workspace/${tenantCode}/settings/dashboards/home`}>
            配置工作台
          </Link>
        </DataPanel>
      </div>
    </main>
  );
}
