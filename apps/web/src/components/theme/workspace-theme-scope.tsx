"use client";

import { App, ConfigProvider, type ThemeConfig } from "antd";
import type { ReactNode } from "react";

import { WORKSPACE_THEME } from "./workspace-theme";

const SCOPE_THEME: ThemeConfig = { ...WORKSPACE_THEME, inherit: false };

/**
 * The workspace look for pages outside the app shell (account pages): the
 * antd theme, the `App` context toasts need, and `data-ui` so the CSS
 * variables switch to the workspace palette.
 */
export function WorkspaceThemeScope({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <ConfigProvider theme={SCOPE_THEME}>
      <App component={false}>
        <div className={className} data-ui="workspace">
          {children}
        </div>
      </App>
    </ConfigProvider>
  );
}
