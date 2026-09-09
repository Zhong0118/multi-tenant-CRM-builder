"use client";

import {
  ApartmentOutlined,
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  HomeOutlined,
  ScheduleOutlined,
  SettingOutlined,
  SwapOutlined,
  TableOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  overview: <DashboardOutlined />,
  company: <BankOutlined />,
  template: <ApartmentOutlined />,
  jobs: <ScheduleOutlined />,
  calendar: <ScheduleOutlined />,
  logs: <FileSearchOutlined />,
  settings: <SettingOutlined />,
  home: <HomeOutlined />,
  stats: <BarChartOutlined />,
  members: <TeamOutlined />,
  import: <SwapOutlined />,
  audit: <AuditOutlined />,
  object: <TableOutlined />,
};

export function NavIcon({ name }: { name: string }) {
  return ICONS[name] ?? <TableOutlined />;
}
