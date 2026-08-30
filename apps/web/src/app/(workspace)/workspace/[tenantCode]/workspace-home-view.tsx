import Link from "next/link";

import { StatePanel } from "@/components/workbench/state-panel";
import { StatusTag } from "@/components/workbench/status-tag";
import { DataPanel, ReadingPanel } from "@/components/workbench/surface";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import styles from "./workspace-home.module.css";

export interface WorkspaceHomeViewProps {
  tenantCode: string;
  tenantName: string;
  userName: string;
  role: "TENANT_ADMIN" | "EMPLOYEE";
  businessObjects: RuntimeObjectNavigation[];
}

export function WorkspaceHomeView({
  tenantCode,
  tenantName,
  userName,
  role,
  businessObjects,
}: WorkspaceHomeViewProps) {
  const root = `/workspace/${tenantCode}`;
  const isAdmin = role === "TENANT_ADMIN";

  return (
    <div className={styles.home}>
      <ReadingPanel
        ariaLabel={isAdmin ? "管理工作台概览" : "我的工作台概览"}
        className={styles.hero}
      >
        <header>
          <span className={styles.context}>{tenantName}</span>
          <h1>{isAdmin ? "管理工作台" : "我的工作台"}</h1>
          <p>
            {isAdmin
              ? `${userName}，在这里配置公司的业务表、成员和发布状态。`
              : `${userName}，选择一个业务表开始处理你的工作。`}
          </p>
        </header>
      </ReadingPanel>

      {isAdmin ? (
        <ReadingPanel ariaLabel="常用管理" className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>常用管理</h2>
            <p>表结构和员工权限在发布后生效。</p>
          </div>
          <div className={styles.actionGrid}>
            <Link
              href={`${root}/settings/objects`}
              className={styles.actionCard}
            >
              <strong>配置业务表</strong>
              <span>创建表、字段、列表视图和员工权限</span>
            </Link>
            <Link href={`${root}/members`} className={styles.actionCard}>
              <strong>管理成员</strong>
              <span>邀请员工并设置成员访问范围</span>
            </Link>
          </div>
        </ReadingPanel>
      ) : null}

      <DataPanel
        ariaLabel={isAdmin ? "已上线业务表" : "我可以使用的业务表"}
        className={styles.section}
      >
        <div className={styles.sectionHeading}>
          <h2>{isAdmin ? "已上线业务表" : "我可以使用的业务表"}</h2>
          <p>{businessObjects.length} 个已发布并授权的业务表</p>
        </div>
        {businessObjects.length ? (
          <div className={styles.objectGrid}>
            {businessObjects.map((object) => (
              <Link
                key={object.code}
                href={`${root}/objects/${object.code}`}
                className={styles.objectCard}
              >
                <span className={styles.objectMark} aria-hidden>
                  {object.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{object.name}</strong>
                  <StatusTag tone={object.canCreate ? "success" : "neutral"}>
                    {object.canCreate ? "可查看、可新建" : "可查看"}
                  </StatusTag>
                </span>
                <span className={styles.openLabel}>打开</span>
              </Link>
            ))}
          </div>
        ) : (
          <StatePanel
            title={isAdmin ? "还没有已发布的业务表" : "暂时没有可用业务表"}
            description={
              isAdmin
                ? "先创建业务表并发布，员工才能开始使用。"
                : "公司管理员发布并授权后，业务表会出现在这里。"
            }
            action={
              isAdmin ? (
                <Link href={`${root}/settings/objects`}>创建第一张业务表</Link>
              ) : undefined
            }
          />
        )}
      </DataPanel>
    </div>
  );
}
