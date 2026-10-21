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
  hairline: "#E8EBEE",
  track: "#EEF1F2",
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
        // Chinese two-character labels read as "保 存" with AntD's inserted space.
        button={{ autoInsertSpace: false }}
        theme={{
          token: {
            borderRadius: 8,
            borderRadiusLG: 12,
            colorBgLayout: TOKENS.page,
            colorBorder: TOKENS.border,
            colorBorderSecondary: TOKENS.border,
            colorError: TOKENS.danger,
            colorLink: TOKENS.primary,
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
              // Record lists use size="small": about 41px rows, hairlines only.
              cellPaddingBlockSM: 10,
              cellPaddingInlineSM: 12,
              borderColor: TOKENS.hairline,
              headerBg: TOKENS.surface,
              headerColor: TOKENS.textSecondary,
              headerSplitColor: "transparent",
              headerSortActiveBg: "transparent",
              headerSortHoverBg: "transparent",
              rowHoverBg: "#F3F5F6",
            },
            Tag: { defaultBg: TOKENS.page, defaultColor: TOKENS.textSecondary },
            Form: { labelColor: TOKENS.textSecondary, verticalLabelPadding: 0 },
            Drawer: { paddingLG: 20 },
            // Grey track with a raised white pill, the same control in every tab strip.
            Segmented: {
              trackBg: TOKENS.track,
              trackPadding: 3,
              itemSelectedBg: TOKENS.surface,
              itemSelectedColor: TOKENS.textPrimary,
              itemColor: "#4B5560",
              itemHoverColor: TOKENS.textPrimary,
              itemHoverBg: "transparent",
              borderRadius: 9,
              borderRadiusSM: 7,
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </QueryProvider>
  );
}
