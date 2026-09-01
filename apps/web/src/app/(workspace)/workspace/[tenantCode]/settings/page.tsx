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
        description="在这里创建业务表、配置工作台和成员。模板不是使用业务表的前置条件。"
      />

      <div className={styles.settingsGrid}>
        <ReadingPanel className={styles.primarySetting} ariaLabel="业务表配置">
          <span className={styles.eyebrow}>BUSINESS TABLES</span>
          <h2>业务表与字段</h2>
          <p>
            新建或调整公司自己的业务表，配置字段、默认列表和员工默认权限。没有平台模板时，也可以从这里创建第一张业务表。所有修改先保存为草稿，发布后才影响员工页面。
          </p>
          <ol className={styles.settingFlow}>
            <li>
              <span>1</span>设计业务表
            </li>
            <li>
              <span>2</span>检查员工视角
            </li>
            <li>
              <span>3</span>发布到工作区
            </li>
          </ol>
          <Link
            className={styles.primaryAction}
            href={`/workspace/${tenantCode}/settings/objects`}
          >
            管理业务表，或创建第一张 <span aria-hidden>→</span>
          </Link>
        </ReadingPanel>

        <DataPanel className={styles.secondarySetting} ariaLabel="成员与权限">
          <div className={styles.settingIndex}>02</div>
          <div>
            <h2>成员与权限</h2>
            <p>
              邀请管理员或员工，停用离职成员，并按业务表覆盖某位员工的操作和数据范围。
            </p>
          </div>
          <Link href={`/workspace/${tenantCode}/members`}>
            进入成员管理 <span aria-hidden>→</span>
          </Link>
        </DataPanel>

        <DataPanel className={styles.secondarySetting} ariaLabel="工作台与指标">
          <div className={styles.settingIndex}>03</div>
          <div>
            <h2>工作台与指标</h2>
            <p>
              绑定已发布业务表的指标、分布和列表。先发布业务表，再配置管理工作台。
            </p>
          </div>
          <Link href={`/workspace/${tenantCode}/settings/dashboard`}>
            配置工作台 <span aria-hidden>→</span>
          </Link>
        </DataPanel>
      </div>

      <ReadingPanel className={styles.lifecyclePanel} ariaLabel="配置生效规则">
        <div className={styles.lifecycleIntro}>
          <span className={styles.eyebrow}>HOW IT WORKS</span>
          <h2>配置不会突然改变员工正在使用的页面</h2>
          <p>
            公司设置采用草稿和发布两层，管理员可以先改完并检查，再选择何时生效。
          </p>
        </div>
        <div className={styles.lifecycleSteps}>
          <div>
            <strong>编辑草稿</strong>
            <span>修改业务表、字段、视图和默认权限。</span>
          </div>
          <i aria-hidden>→</i>
          <div>
            <strong>检查并发布</strong>
            <span>发布前查看阻断项和变更摘要。</span>
          </div>
          <i aria-hidden>→</i>
          <div>
            <strong>员工开始使用</strong>
            <span>运行时只读取最新发布版本。</span>
          </div>
        </div>
      </ReadingPanel>
    </main>
  );
}
