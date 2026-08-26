"use client";

import type { components } from "@crm/contracts";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";

import styles from "./tenants.module.css";
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
  { title: "活跃管理员", dataIndex: "activeAdminCount" },
  {
    title: "创建时间",
    dataIndex: "createdAt",
    render: (value?: string) => formatDate(value),
  },
];

export function TenantTable({
  data,
  navigate,
}: {
  data: PlatformTenantPage;
  navigate?: (path: string) => void;
}) {
  const router = useRouter();
  return (
    <Table
      className={styles.tenantTable}
      rowKey="id"
      columns={columns}
      dataSource={data.items}
      pagination={{
        current: data.page,
        pageSize: data.limit,
        total: data.total,
        showSizeChanger: false,
        onChange: (page) =>
          (navigate ?? router.push)(`/platform/tenants?page=${page}`),
      }}
      onRow={(tenant) => ({
        onClick: () =>
          (navigate ?? router.push)(`/platform/tenants/${tenant.id}`),
      })}
    />
  );
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
