import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { StatePanel } from "@/components/workbench/state-panel";
import { AdminWorkbench } from "@/features/dashboard/admin-workbench";
import type { DashboardOverview } from "@/features/dashboard/dashboard-types";
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
  overview: DashboardOverview;
}

export function WorkspaceHomeView({
  tenantCode,
  tenantName,
  userName,
  role,
  businessObjects,
  overview,
}: WorkspaceHomeViewProps) {
  if (overview.state !== "READY") {
    return (
      <div className={styles.home}>
        <PageHeader
          title={role === "TENANT_ADMIN" ? "管理工作台" : "我的工作台"}
          description={`${userName}，这里会使用 ${tenantName} 的真实业务记录生成工作摘要。`}
        />
        <StatePanel
          title={stateTitle(overview.state, role)}
          description={stateDescription(overview.state, role)}
          action={
            role === "TENANT_ADMIN" ? (
              <Link href={`/workspace/${tenantCode}/settings/dashboard`}>
                {overview.state === "NEEDS_REPAIR"
                  ? "修复工作台配置"
                  : "配置工作台"}
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

function stateTitle(
  state: DashboardOverview["state"],
  role: WorkspaceHomeViewProps["role"],
) {
  if (state === "NEEDS_REPAIR") return "工作台配置需要修复";
  if (state === "UNAVAILABLE") return "当前没有可统计的业务数据";
  return role === "TENANT_ADMIN"
    ? "还没有配置经营工作台"
    : "公司尚未启用工作台";
}

function stateDescription(
  state: DashboardOverview["state"],
  role: WorkspaceHomeViewProps["role"],
) {
  if (state === "NEEDS_REPAIR") {
    return role === "TENANT_ADMIN"
      ? "已映射的业务表或字段发生了变化，请重新选择当前发布版本中的字段。"
      : "公司工作台配置正在调整，你仍然可以从下方进入有权限的业务表。";
  }
  if (state === "UNAVAILABLE") {
    return "当前账号没有读取工作台所需字段或记录的权限，请从下方进入已有权限的业务表。";
  }
  return role === "TENANT_ADMIN"
    ? "选择一张已发布的业务表，并指定阶段、金额和日期字段后，系统才会计算真实数据。"
    : "公司管理员完成指标映射后，这里会显示你的个人管道、成交结果和优先事项。";
}
