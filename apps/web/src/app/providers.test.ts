import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { WORKSPACE_TOKENS } from "@/components/theme/workspace-theme";

import { TOKENS } from "./providers";

const css = readFileSync(resolve(import.meta.dirname, "globals.css"), "utf8");

describe("design tokens", () => {
  it("uses one palette for public pages and the workspace", () => {
    expect(TOKENS.primary).toBe("#167568");
    expect(TOKENS.primary).toBe(WORKSPACE_TOKENS.primary);
    expect(TOKENS.textPrimary).toBe(WORKSPACE_TOKENS.textPrimary);
    expect(TOKENS.page).toBe(WORKSPACE_TOKENS.page);
    expect(TOKENS.border).toBe(WORKSPACE_TOKENS.border);
    expect(TOKENS.fontUi).toBe(WORKSPACE_TOKENS.fontUi);
    // No second palette that switches on [data-ui="workspace"] any more.
    expect(css).not.toContain(':root:has([data-ui="workspace"])');
  });

  it("keeps Ant Design tokens identical to globals.css custom properties", () => {
    const pairs: Array<[string, string]> = [
      ["--shell-ink", WORKSPACE_TOKENS.ink],
      ["--color-primary", WORKSPACE_TOKENS.primary],
      ["--color-primary-hover", WORKSPACE_TOKENS.primaryHover],
      ["--color-primary-active", WORKSPACE_TOKENS.primaryActive],
      ["--color-primary-soft", WORKSPACE_TOKENS.primarySoft],
      ["--color-primary-soft-hover", WORKSPACE_TOKENS.primarySoftHover],
      ["--color-primary-border", WORKSPACE_TOKENS.primaryBorder],
      ["--text-primary", WORKSPACE_TOKENS.textPrimary],
      ["--text-secondary", WORKSPACE_TOKENS.textSecondary],
      ["--text-tertiary", WORKSPACE_TOKENS.textTertiary],
      ["--text-disabled", WORKSPACE_TOKENS.textDisabled],
      ["--border-default", WORKSPACE_TOKENS.border],
      ["--border-strong", WORKSPACE_TOKENS.borderStrong],
      ["--border-hairline", WORKSPACE_TOKENS.hairline],
      ["--bg-page", WORKSPACE_TOKENS.page],
      ["--bg-surface", WORKSPACE_TOKENS.surface],
      ["--bg-surface-subtle", WORKSPACE_TOKENS.surfaceSubtle],
      ["--bg-hover", WORKSPACE_TOKENS.hover],
      ["--bg-selected", WORKSPACE_TOKENS.selected],
      ["--bg-sidebar", WORKSPACE_TOKENS.sidebar],
      ["--bg-sidebar-active", WORKSPACE_TOKENS.sidebarActive],
      ["--bg-track", WORKSPACE_TOKENS.track],
      ["--color-success", WORKSPACE_TOKENS.success],
      ["--color-success-soft", WORKSPACE_TOKENS.successSoft],
      ["--color-success-border", WORKSPACE_TOKENS.successBorder],
      ["--color-warning", WORKSPACE_TOKENS.warning],
      ["--color-warning-soft", WORKSPACE_TOKENS.warningSoft],
      ["--color-warning-border", WORKSPACE_TOKENS.warningBorder],
      ["--color-danger", WORKSPACE_TOKENS.danger],
      ["--color-danger-soft", WORKSPACE_TOKENS.dangerSoft],
      ["--color-danger-border", WORKSPACE_TOKENS.dangerBorder],
      ["--color-info", WORKSPACE_TOKENS.info],
      ["--color-ai", WORKSPACE_TOKENS.ai],
      ["--color-ai-soft", WORKSPACE_TOKENS.aiSoft],
    ];
    for (const [property, hex] of pairs) {
      expect(css, property).toContain(`${property}: ${hex.toLowerCase()};`);
    }
    expect(css).toContain("--radius-reading: 10px");
    expect(css).toContain("--radius-control: 6px");
    expect(css).toContain("--radius-status: 4px");
    expect(css).toContain("--radius-data: 10px");
    expect(css).toContain("--sidebar-width: 224px");
    expect(css).toContain("--header-height: 52px");
  });
});
