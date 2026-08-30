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
  ink: "#17232D",
  inkHover: "#22313D",
  textPrimary: "#17232D",
  textSecondary: "#687681",
  primary: "#167568",
  primarySoft: "#E7F3F0",
  page: "#F3F6F8",
  surface: "#FFFFFF",
  border: "#D8E0E5",
  borderStrong: "#C8D2D9",
  hover: "#EEF2F4",
  selected: "#E7F3F0",
  success: "#167568",
  warning: "#C66C18",
  warningSoft: "#FFF3E5",
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
            borderRadiusLG: 10,
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
            controlHeight: 34,
          },
          components: {
            Table: {
              cellPaddingBlock: 11,
              cellPaddingInline: 13,
              headerBg: "#F7F9FA",
              headerColor: TOKENS.textSecondary,
              headerSplitColor: "transparent",
              rowHoverBg: TOKENS.hover,
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
