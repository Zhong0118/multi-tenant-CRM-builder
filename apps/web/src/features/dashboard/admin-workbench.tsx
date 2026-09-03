"use client";

import { Button } from "antd";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import type { DashboardRuntimeResult } from "./dashboard-types";
import { DashboardRenderer } from "./dashboard-renderer";
import { WorkbenchPeriodNav, WorkbenchSwitcher } from "./workbench-chrome";
import { BusinessObjectBar } from "./workbench-elements";
import { dashboardSettingsPath, workbenchPath } from "./workbench-period";
import styles from "./workbench.module.css";

export function AdminWorkbench({
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
        description={`${tenantName}的已发布工作台。数据会按当前权限更新。`}
        extra={
          <Link
            href={dashboardSettingsPath(tenantCode, overview.dashboardCode)}
          >
            <Button>配置工作台</Button>
          </Link>
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
      <DashboardRenderer tenantCode={tenantCode} runtime={overview} />
      <BusinessObjectBar
        tenantCode={tenantCode}
        objects={businessObjects}
        role="TENANT_ADMIN"
      />
    </div>
  );
}
