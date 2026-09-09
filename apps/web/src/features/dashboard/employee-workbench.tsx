"use client";

import { FollowUpSummary } from "@/features/follow-ups/follow-up-summary";
import { PageHeader } from "@/components/layout/page-header";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import type { DashboardRuntimeResult } from "./dashboard-types";
import { DashboardRenderer } from "./dashboard-renderer";
import {
  EmployeeShortcuts,
  WorkbenchPeriodNav,
  WorkbenchSwitcher,
} from "./workbench-chrome";
import { BusinessObjectBar } from "./workbench-elements";
import { workbenchPath } from "./workbench-period";
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
        description={
          <>
            {`${tenantName}的已发布工作台。`}
            <span>数据只显示你当前有权查看的结果。</span>
          </>
        }
      />
      <div className={styles.workbenchChrome}>
        <WorkbenchSwitcher
          tenantCode={tenantCode}
          currentCode={overview.dashboardCode}
          dashboards={overview.dashboards}
        />
        <WorkbenchPeriodNav
          pathname={workbenchPath(tenantCode, overview.dashboardCode)}
          period={overview.period}
          publication={overview.publication}
        />
      </div>
      <FollowUpSummary tenantCode={tenantCode} />
      <DashboardRenderer tenantCode={tenantCode} runtime={overview} />
      <EmployeeShortcuts tenantCode={tenantCode} objects={businessObjects} />
      <BusinessObjectBar
        tenantCode={tenantCode}
        objects={businessObjects}
        role="EMPLOYEE"
      />
    </div>
  );
}
