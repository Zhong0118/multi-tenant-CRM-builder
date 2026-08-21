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
const TOKENS = {
  ledgerInk: "#172033",
  workingBlue: "#2457D6",
  canvas: "#F5F7FA",
  paper: "#FFFFFF",
  rule: "#D7DEE8",
  verifiedTeal: "#167A72",
  reviewAmber: "#A86405",
  stopRed: "#B42318",
  inkSecondary: "#526473",
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
            colorBgLayout: TOKENS.canvas,
            colorBorder: TOKENS.rule,
            colorBorderSecondary: TOKENS.rule,
            colorError: TOKENS.stopRed,
            colorPrimary: TOKENS.workingBlue,
            colorSuccess: TOKENS.verifiedTeal,
            colorText: TOKENS.ledgerInk,
            colorTextSecondary: TOKENS.inkSecondary,
            colorWarning: TOKENS.reviewAmber,
            fontFamily: TOKENS.fontUi,
            fontSize: 14,
          },
          components: {
            // A configuration ledger is read down its columns, so rows stay
            // dense and separation comes from hairlines rather than padding.
            Table: {
              cellPaddingBlock: 10,
              cellPaddingInline: 12,
              headerBg: TOKENS.paper,
              headerColor: TOKENS.inkSecondary,
              headerSplitColor: "transparent",
              rowHoverBg: TOKENS.canvas,
            },
            Tag: {
              defaultBg: TOKENS.canvas,
              defaultColor: TOKENS.inkSecondary,
            },
            // Labels sit above their control and never compete with the value.
            Form: { labelColor: TOKENS.inkSecondary, verticalLabelPadding: 0 },
            Drawer: { paddingLG: 20 },
            Segmented: { itemSelectedBg: TOKENS.paper },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </QueryProvider>
  );
}
