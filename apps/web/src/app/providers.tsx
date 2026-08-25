"use client";

import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

import { QueryProvider } from "@/lib/query/query-provider";

/**
 * These values must stay identical to the custom properties in globals.css.
 * Ant Design components and the CSS modules both render the same surfaces, so
 * a second near-identical palette reads as an unresolved interface.
 */
export const TOKENS = {
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  primary: "#2563EB",
  page: "#F8FAFC",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  hover: "#F1F5F9",
  selected: "#EFF6FF",
  success: "#0F766E",
  warning: "#B45309",
  danger: "#B42318",
  fontUi:
    '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            borderRadius: 6,
            colorBgLayout: TOKENS.page,
            colorBorder: TOKENS.border,
            colorBorderSecondary: TOKENS.border,
            colorError: TOKENS.danger,
            colorPrimary: TOKENS.primary,
            colorSuccess: TOKENS.success,
            colorText: TOKENS.textPrimary,
            colorTextSecondary: TOKENS.textSecondary,
            colorWarning: TOKENS.warning,
            fontFamily: TOKENS.fontUi,
            fontSize: 14,
            controlHeight: 36,
          },
          components: {
            Table: {
              cellPaddingBlock: 12,
              cellPaddingInline: 12,
              headerBg: TOKENS.surface,
              headerColor: TOKENS.textSecondary,
              headerSplitColor: "transparent",
              rowHoverBg: TOKENS.page,
            },
            Tag: { defaultBg: TOKENS.page, defaultColor: TOKENS.textSecondary },
            Form: { labelColor: TOKENS.textSecondary, verticalLabelPadding: 0 },
            Drawer: { paddingLG: 20 },
            Segmented: { itemSelectedBg: TOKENS.surface },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </QueryProvider>
  );
}
