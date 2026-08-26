import { Tag } from "antd";

const STATUS_COPY = {
  DRAFT: "草稿",
  ACTIVE: "运行中",
  SUSPENDED: "已暂停",
  CLOSED: "已关闭",
} as const;

const STATUS_COLOR = {
  DRAFT: "warning",
  ACTIVE: "success",
  SUSPENDED: "warning",
  CLOSED: "default",
} as const;

export type TenantStatus = keyof typeof STATUS_COPY;

export function tenantStatusText(status: TenantStatus) {
  return STATUS_COPY[status];
}

export function TenantStatusTag({ status }: { status: TenantStatus }) {
  return <Tag color={STATUS_COLOR[status]}>{STATUS_COPY[status]}</Tag>;
}
