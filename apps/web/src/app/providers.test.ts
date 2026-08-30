import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { TOKENS } from "./providers";

describe("design tokens", () => {
  it("keeps Ant Design tokens identical to globals.css custom properties", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "globals.css"),
      "utf8",
    );

    expect(TOKENS.ink).toBe("#17232D");
    expect(TOKENS.inkHover).toBe("#22313D");
    expect(TOKENS.textPrimary).toBe("#17232D");
    expect(TOKENS.primary).toBe("#167568");
    expect(TOKENS.primarySoft).toBe("#E7F3F0");
    expect(TOKENS.page).toBe("#F3F6F8");
    expect(TOKENS.surface).toBe("#FFFFFF");
    expect(TOKENS.border).toBe("#D8E0E5");
    expect(TOKENS.borderStrong).toBe("#C8D2D9");
    expect(TOKENS.textSecondary).toBe("#687681");
    expect(TOKENS.success).toBe("#167568");
    expect(TOKENS.warning).toBe("#C66C18");
    expect(TOKENS.warningSoft).toBe("#FFF3E5");
    expect(TOKENS.danger).toBe("#B42318");

    expect(css).toContain(
      `--text-primary: ${TOKENS.textPrimary.toLowerCase()}`,
    );
    expect(css).toContain(`--color-primary: ${TOKENS.primary.toLowerCase()}`);
    expect(css).toContain(`--bg-page: ${TOKENS.page.toLowerCase()}`);
    expect(css).toContain(`--border-default: ${TOKENS.border.toLowerCase()}`);
    expect(css).toContain(`--color-success: ${TOKENS.success.toLowerCase()}`);
    expect(css).toContain(`--shell-ink: ${TOKENS.ink.toLowerCase()}`);
    expect(css).toContain(
      `--border-strong: ${TOKENS.borderStrong.toLowerCase()}`,
    );
    expect(css).toContain("--radius-reading: 10px");
    expect(css).toContain("--radius-control: 6px");
    expect(css).toContain("--radius-status: 4px");
    expect(css).toContain("--radius-data: 2px");
    expect(css).toContain("--sidebar-width: 224px");
    expect(css).toContain("--header-height: 56px");
  });
});
