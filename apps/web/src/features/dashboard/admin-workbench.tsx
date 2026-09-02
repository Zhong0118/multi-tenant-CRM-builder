"use client";

import { Button } from "antd";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import type { DashboardRuntimeResult } from "./dashboard-types";
import { DashboardRenderer, PeriodLabel } from "./dashboard-renderer";
import { BusinessObjectBar } from "./workbench-elements";
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
        status={<PeriodLabel period={overview.period} publication={overview.publication} />}
        extra={
          <Link href={`/workspace/${tenantCode}/settings/dashboards/home`}>
            <Button>配置工作台</Button>
          </Link>
        }
      />
      <DashboardRenderer tenantCode={tenantCode} runtime={overview} />
      <BusinessObjectBar
        tenantCode={tenantCode}
        objects={businessObjects}
        role="TENANT_ADMIN"
      />
    </div>
  );
}
