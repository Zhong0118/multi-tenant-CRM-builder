import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { StatePanel } from "@/components/workbench/state-panel";
import { AdminWorkbench } from "@/features/dashboard/admin-workbench";
import type { DashboardRuntimeResult } from "@/features/dashboard/dashboard-types";
import { EmployeeWorkbench } from "@/features/dashboard/employee-workbench";
import { BusinessObjectBar } from "@/features/dashboard/workbench-elements";
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
    return (
      <div className={styles.home}>
        <PageHeader
          title={role === "TENANT_ADMIN" ? "管理工作台" : "我的工作台"}
          description={`${userName}，这里会使用 ${tenantName} 的真实业务记录生成工作摘要。`}
        />
        <StatePanel
          title={stateTitle(role)}
          description={stateDescription(role)}
          action={
            role === "TENANT_ADMIN" ? (
              <Link href={`/workspace/${tenantCode}/settings/dashboard`}>
                配置工作台
              </Link>
            ) : undefined
          }
        />
        <BusinessObjectBar tenantCode={tenantCode} objects={businessObjects} />
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

function stateTitle(role: WorkspaceHomeViewProps["role"]) {
  return role === "TENANT_ADMIN" ? "工作台尚未配置" : "工作台尚未启用";
}

function stateDescription(role: WorkspaceHomeViewProps["role"]) {
  return role === "TENANT_ADMIN"
    ? "添加组件并发布工作台后，这里会显示已发布的结果。"
    : "公司管理员发布工作台后，这里会显示你有权限查看的结果。";
}
