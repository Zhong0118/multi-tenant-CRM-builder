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

    expect(TOKENS.textPrimary).toBe("#0F172A");
    expect(TOKENS.primary).toBe("#2563EB");
    expect(TOKENS.page).toBe("#F8FAFC");
    expect(TOKENS.surface).toBe("#FFFFFF");
    expect(TOKENS.border).toBe("#E2E8F0");
    expect(TOKENS.textSecondary).toBe("#475569");
    expect(TOKENS.success).toBe("#0F766E");
    expect(TOKENS.warning).toBe("#B45309");
    expect(TOKENS.danger).toBe("#B42318");

    expect(css).toContain(
      `--text-primary: ${TOKENS.textPrimary.toLowerCase()}`,
    );
    expect(css).toContain(`--color-primary: ${TOKENS.primary.toLowerCase()}`);
    expect(css).toContain(`--bg-page: ${TOKENS.page.toLowerCase()}`);
    expect(css).toContain(`--border-default: ${TOKENS.border.toLowerCase()}`);
    expect(css).toContain(`--color-success: ${TOKENS.success.toLowerCase()}`);
    expect(css).not.toContain("#172033");
    expect(css).not.toContain("#2457d6");
    expect(css).not.toContain("#f5f7fa");
  });
});
