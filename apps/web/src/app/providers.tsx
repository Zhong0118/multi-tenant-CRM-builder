"use client";

import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

import {
  WORKSPACE_THEME,
  WORKSPACE_TOKENS as T,
} from "@/components/theme/workspace-theme";
import { QueryProvider } from "@/lib/query/query-provider";

/**
 * The public pages (landing, sign-in, registration) use the same palette as
 * the workspace: one brand teal and one set of neutrals across the product.
 * These values must stay identical to the custom properties in globals.css.
 */
export const TOKENS = {
  ink: T.ink,
  inkHover: T.inkHover,
  textPrimary: T.textPrimary,
  textSecondary: T.textSecondary,
  primary: T.primary,
  primarySoft: T.primarySoft,
  page: T.page,
  surface: T.surface,
  border: T.border,
  borderStrong: T.borderStrong,
  hairline: T.hairline,
  track: T.track,
  hover: T.hover,
  selected: T.selected,
  success: T.success,
  warning: T.warning,
  warningSoft: T.warningSoft,
  danger: T.danger,
  fontUi: T.fontUi,
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ConfigProvider
        locale={zhCN}
        // Chinese two-character labels read as "保 存" with AntD's inserted space.
        button={{ autoInsertSpace: false }}
        theme={WORKSPACE_THEME}
      >
        {children}
      </ConfigProvider>
    </QueryProvider>
  );
}
