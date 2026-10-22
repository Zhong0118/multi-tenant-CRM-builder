"use client";

import {
  ApartmentOutlined,
  AuditOutlined,
  BranchesOutlined,
  BankOutlined,
  BarChartOutlined,
  CarryOutOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  HomeOutlined,
  LineChartOutlined,
  RobotOutlined,
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
  tasks: <CarryOutOutlined />,
  logs: <FileSearchOutlined />,
  settings: <SettingOutlined />,
  home: <HomeOutlined />,
  ai: <RobotOutlined />,
  stats: <BarChartOutlined />,
  team: <LineChartOutlined />,
  members: <TeamOutlined />,
  import: <SwapOutlined />,
  audit: <AuditOutlined />,
  object: <TableOutlined />,
  relation: <BranchesOutlined />,
};

export function NavIcon({ name }: { name: string }) {
  return ICONS[name] ?? <TableOutlined />;
}
