"use client";

import { PageHeader } from "@/components/layout/page-header";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import type { DashboardRuntimeResult } from "./dashboard-types";
import { DashboardRenderer, PeriodLabel } from "./dashboard-renderer";
import { BusinessObjectBar } from "./workbench-elements";
import styles from "./workbench.module.css";

export function EmployeeWorkbench({
  tenantCode,
  tenantName,
  overview,
  businessObjects,
}: {
  tenantCode: string;
  tenantName: string;
  userName: string;
  overview: DashboardRuntimeResult;
  businessObjects: RuntimeObjectNavigation[];
}) {
  return (
    <div className={styles.workbench}>
      <PageHeader
        title={overview.title}
        description={`${tenantName}的已发布工作台。数据只显示你当前有权查看的结果。`}
        status={<PeriodLabel period={overview.period} publication={overview.publication} />}
      />
      <DashboardRenderer tenantCode={tenantCode} runtime={overview} />
      <BusinessObjectBar
        tenantCode={tenantCode}
        objects={businessObjects}
        role="EMPLOYEE"
      />
    </div>
  );
}
