"use client";

import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

import { QueryProvider } from "@/lib/query/query-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            borderRadius: 6,
            colorBgLayout: "#F4F7F9",
            colorBorder: "#D8E0E6",
            colorPrimary: "#2563EB",
            colorSuccess: "#0F766E",
            colorText: "#162532",
            colorTextSecondary: "#526473",
            fontFamily:
              '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
          },
        }}
      >
        {children}
      </ConfigProvider>
    </QueryProvider>
  );
}
