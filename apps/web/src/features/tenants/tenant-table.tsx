"use client";

import type { components } from "@crm/contracts";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataPanel } from "@/components/workbench/surface";

import styles from "./tenants.module.css";
import { tenantNextStep } from "./tenant-next-step";
import { TenantStatusTag } from "./tenant-status";

type PlatformTenant = components["schemas"]["PlatformTenantResponseDto"];
export type PlatformTenantPage =
  components["schemas"]["PlatformTenantPageResponseDto"];

const columns: ColumnsType<PlatformTenant> = [
  {
    title: "公司",
    dataIndex: "name",
    render: (name: string, tenant) => (
      <Link
        href={`/platform/tenants/${tenant.id}`}
        className={styles.tenantLink}
        onClick={(event) => event.stopPropagation()}
      >
        {name}
      </Link>
    ),
  },
  { title: "工作空间代码", dataIndex: "code" },
  {
    title: "状态",
    dataIndex: "status",
    render: (status: PlatformTenant["status"]) => (
      <TenantStatusTag status={status} />
    ),
  },
  {
    title: "首位管理员",
    // A company that is already running has no pending invitation to show, and
    // "尚未邀请" beside a non-zero 活跃管理员 count contradicts itself. Say what
    // is actually true — no invitation row — as the company detail page does.
    render: (_, tenant) =>
      tenant.firstAdminInvitation?.targetPhone ??
      (tenant.activeAdminCount > 0 ? "未创建邀请" : "尚未邀请"),
  },
  { title: "活跃管理员", dataIndex: "activeAdminCount" },
  {
    title: "下一步",
    render: (_, tenant) => (
      <span className={styles.nextStep}>{tenantNextStep(tenant)}</span>
    ),
  },
  {
    title: "创建时间",
    dataIndex: "createdAt",
    render: (value?: string) => formatDate(value),
  },
];

export function TenantTable({
  data,
  navigate,
  filters = {},
}: {
  data: PlatformTenantPage;
  navigate?: (path: string) => void;
  filters?: { status?: string; search?: string };
}) {
  const router = useRouter();
  return (
    <DataPanel ariaLabel="公司列表" className={styles.tenantTable}>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data.items}
        scroll={{ x: 1080 }}
        pagination={{
          current: data.page,
          pageSize: data.limit,
          total: data.total,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 家公司`,
          onChange: (page) =>
            (navigate ?? router.push)(
              `/platform/tenants?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(filters).filter(([, value]) => Boolean(value))) as Record<string, string>), page: String(page) })}`,
            ),
        }}
        onRow={(tenant) => ({
          onClick: () =>
            (navigate ?? router.push)(`/platform/tenants/${tenant.id}`),
        })}
      />
    </DataPanel>
  );
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
