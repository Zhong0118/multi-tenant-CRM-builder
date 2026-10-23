"use client";

import {
  AccountBookOutlined,
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  CalendarOutlined,
  CarOutlined,
  ClockCircleOutlined,
  CloudOutlined,
  CreditCardOutlined,
  CrownOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  FlagOutlined,
  GiftOutlined,
  HeartOutlined,
  IdcardOutlined,
  LineChartOutlined,
  MailOutlined,
  MessageOutlined,
  PhoneOutlined,
  PieChartOutlined,
  ProjectOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  StarOutlined,
  TableOutlined,
  TagOutlined,
  TeamOutlined,
  ToolOutlined,
  TrophyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ComponentType } from "react";

type IconComponent = ComponentType<{ "aria-hidden"?: boolean }>;

export interface ObjectIconOption {
  /** The value stored on the business table. Stable: it is saved in published configuration. */
  key: string;
  label: string;
  Icon: IconComponent;
}

/** What a business table shows when no icon was chosen, or a stored key is no longer offered. */
export const DEFAULT_OBJECT_ICON: Omit<ObjectIconOption, "key"> = {
  label: "默认",
  Icon: TableOutlined,
};

/**
 * The icons a company can give a business table. Keys are stored as-is (the API
 * accepts any string up to 64 characters), so a key is never renamed or reused
 * for a different glyph; retire one by removing it and letting readers fall back
 * to the default.
 */
export const OBJECT_ICON_OPTIONS: readonly ObjectIconOption[] = [
  { key: "user", label: "联系人", Icon: UserOutlined },
  { key: "team", label: "团队", Icon: TeamOutlined },
  { key: "idcard", label: "名片", Icon: IdcardOutlined },
  { key: "bank", label: "公司", Icon: BankOutlined },
  { key: "shop", label: "门店", Icon: ShopOutlined },
  { key: "cart", label: "订单", Icon: ShoppingCartOutlined },
  { key: "file", label: "合同", Icon: FileTextOutlined },
  { key: "audit", label: "审批", Icon: AuditOutlined },
  { key: "account-book", label: "账目", Icon: AccountBookOutlined },
  { key: "dollar", label: "回款", Icon: DollarOutlined },
  { key: "credit-card", label: "支付", Icon: CreditCardOutlined },
  { key: "calendar", label: "日程", Icon: CalendarOutlined },
  { key: "clock", label: "跟进", Icon: ClockCircleOutlined },
  { key: "phone", label: "电话", Icon: PhoneOutlined },
  { key: "mail", label: "邮件", Icon: MailOutlined },
  { key: "message", label: "沟通", Icon: MessageOutlined },
  { key: "tag", label: "标签", Icon: TagOutlined },
  { key: "star", label: "重点", Icon: StarOutlined },
  { key: "flag", label: "里程碑", Icon: FlagOutlined },
  { key: "rocket", label: "项目", Icon: RocketOutlined },
  { key: "project", label: "看板", Icon: ProjectOutlined },
  { key: "trophy", label: "商机", Icon: TrophyOutlined },
  { key: "gift", label: "礼品", Icon: GiftOutlined },
  { key: "car", label: "车辆", Icon: CarOutlined },
  { key: "environment", label: "地址", Icon: EnvironmentOutlined },
  { key: "book", label: "资料", Icon: BookOutlined },
  { key: "safety", label: "资质", Icon: SafetyCertificateOutlined },
  { key: "tool", label: "工单", Icon: ToolOutlined },
  { key: "cloud", label: "云服务", Icon: CloudOutlined },
  { key: "database", label: "数据库", Icon: DatabaseOutlined },
  { key: "line-chart", label: "业绩", Icon: LineChartOutlined },
  { key: "pie-chart", label: "报表", Icon: PieChartOutlined },
  { key: "crown", label: "会员", Icon: CrownOutlined },
  { key: "heart", label: "关怀", Icon: HeartOutlined },
  { key: "customer-service", label: "客服", Icon: CustomerServiceOutlined },
];

const BY_KEY = new Map(OBJECT_ICON_OPTIONS.map((option) => [option.key, option]));

/** Whether the key names an icon this version can draw. */
export function isKnownObjectIcon(key: string | null | undefined): key is string {
  return typeof key === "string" && BY_KEY.has(key);
}

/** The glyph for a business table, falling back to the default table icon. */
export function ObjectIcon({ name }: { name?: string | null }) {
  const Icon = (isKnownObjectIcon(name) ? BY_KEY.get(name) : undefined)?.Icon ?? DEFAULT_OBJECT_ICON.Icon;
  return <Icon aria-hidden />;
}
