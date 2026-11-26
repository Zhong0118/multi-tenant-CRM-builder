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
  ScheduleOutlined,
  SettingOutlined,
  SwapOutlined,
  TableOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import { AiSparkIcon } from "@/components/icons/ai-spark-icon";

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
  ai: <AiSparkIcon />,
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
