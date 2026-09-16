import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { StatePanel } from "@/components/workbench/state-panel";
import { AdminWorkbench } from "@/features/dashboard/admin-workbench";
import type { DashboardRuntimeResult } from "@/features/dashboard/dashboard-types";
import { EmployeeWorkbench } from "@/features/dashboard/employee-workbench";
import { dashboardSettingsPath } from "@/features/dashboard/workbench-period";
import { BusinessObjectBar } from "@/features/dashboard/workbench-elements";
import { PersonalFollowUpWorkbench } from "@/features/follow-ups/follow-up-workbench";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import styles from "./workspace-home.module.css";

export interface WorkspaceHomeViewProps {
  tenantCode: string;
  tenantName: string;
  userName: string;
  role: "TENANT_ADMIN" | "EMPLOYEE";
  businessObjects: RuntimeObjectNavigation[];
  overview: DashboardRuntimeResult;
}

export function WorkspaceHomeView({
  tenantCode,
  tenantName,
  userName,
  role,
  businessObjects,
  overview,
}: WorkspaceHomeViewProps) {
  if (overview.state === "UNCONFIGURED") {
    if (role === "TENANT_ADMIN") {
      return (
        <div className={styles.home}>
          <PageHeader
            title="管理工作台"
            description={`${userName}，这里会使用 ${tenantName} 的真实业务记录生成工作摘要。`}
          />
          <StatePanel
            title={emptyHomeTitle(role, businessObjects.length)}
            description={emptyHomeDescription(role, businessObjects.length)}
            action={emptyHomeAction(
              tenantCode,
              role,
              businessObjects.length,
              overview.dashboardCode,
            )}
          />
          <BusinessObjectBar
            tenantCode={tenantCode}
            objects={businessObjects}
            role={role}
          />
        </div>
      );
    }

    /**
     * An employee's own follow-ups are personal execution data, so they must not
     * wait for an administrator to publish a dashboard (§10.1). The personal
     * workbench therefore renders above the "not enabled yet" state.
     */
    return (
      <div className={styles.home}>
        <PageHeader
          title="我的工作台"
          description={`${userName}，这里会使用 ${tenantName} 的真实业务记录生成工作摘要。`}
        />
        <PersonalFollowUpWorkbench tenantCode={tenantCode} />
        <StatePanel
          title="工作台尚未启用"
          description="公司管理员发布工作台后，这里会显示你有权限查看的结果。"
        />
        <BusinessObjectBar
          tenantCode={tenantCode}
          objects={businessObjects}
          role="EMPLOYEE"
        />
      </div>
    );
  }

  return role === "TENANT_ADMIN" ? (
    <AdminWorkbench
      tenantCode={tenantCode}
      tenantName={tenantName}
      userName={userName}
      overview={overview}
      businessObjects={businessObjects}
    />
  ) : (
    <EmployeeWorkbench
      tenantCode={tenantCode}
      tenantName={tenantName}
      userName={userName}
      overview={overview}
      businessObjects={businessObjects}
    />
  );
}

function emptyHomeTitle(
  role: WorkspaceHomeViewProps["role"],
  objectCount: number,
) {
  if (role === "TENANT_ADMIN" && objectCount === 0) return "还没有业务表";
  return role === "TENANT_ADMIN" ? "工作台尚未配置" : "工作台尚未启用";
}

function emptyHomeDescription(
  role: WorkspaceHomeViewProps["role"],
  objectCount: number,
) {
  if (role === "TENANT_ADMIN" && objectCount === 0) {
    return "先创建并发布第一张业务表。模板不是必选项。发布后员工才能在侧栏看到它。";
  }
  return role === "TENANT_ADMIN"
    ? "添加组件并发布工作台后，这里会显示已发布的结果。"
    : "公司管理员发布工作台后，这里会显示你有权限查看的结果。";
}

function emptyHomeAction(
  tenantCode: string,
  role: WorkspaceHomeViewProps["role"],
  objectCount: number,
  dashboardCode?: string,
) {
  if (role !== "TENANT_ADMIN") return undefined;
  if (objectCount === 0) {
    return (
      <Link href={`/workspace/${tenantCode}/settings/objects/new`}>
        创建第一张业务表
      </Link>
    );
  }
  return (
    <Link href={dashboardSettingsPath(tenantCode, dashboardCode)}>
      配置工作台
    </Link>
  );
}
