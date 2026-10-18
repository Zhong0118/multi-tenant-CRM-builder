import type { components } from "@crm/contracts";

type Schemas = components["schemas"];

export const POOL_STAGES = [
  "LEAD_POOL",
  "CUSTOMER_POOL",
  "PENDING_CONTACT",
  "FOLLOWING",
  "PROTECTED",
] as const;
export type PoolStage = (typeof POOL_STAGES)[number];
export type PoolStageFilter = PoolStage | "LEGACY";
export type PoolQuality = "INVALID" | "DUPLICATE" | "LOST";
export type PoolLabels = Required<Schemas["PoolLabelsDto"]>;
export const DEFAULT_POOL_LABELS: PoolLabels = {
  leadPool: "初始公共池",
  customerPool: "已联系公共池",
  pending: "待联系",
  following: "跟进中",
  protected: "受保护",
};
export const CUSTOMER_POOL_LABELS: PoolLabels = {
  leadPool: "线索公海",
  customerPool: "客户公海",
  pending: "我的待联系",
  following: "我的跟进客户",
  protected: "我的成交客户",
};
export const POOL_LABEL_KEYS = {
  LEAD_POOL: "leadPool",
  CUSTOMER_POOL: "customerPool",
  PENDING_CONTACT: "pending",
  FOLLOWING: "following",
  PROTECTED: "protected",
} as const;
export type PoolProtectionSource = Schemas["PoolProtectionSourceDto"];
// Keep legacy cached configs usable before their first lifecycle save.
export type RecordPoolConfig = Omit<Schemas["RecordPoolConfigResponseDto"], "contactTtlHours" | "followUpTtlHours"> & {
  contactTtlHours?: number;
  followUpTtlHours?: number;
  serverTimeReceivedAt?: number;
};
export type RecordOwnershipInput = Schemas["RecordOwnershipDto"];
export type OwnershipAction = RecordOwnershipInput["action"];
