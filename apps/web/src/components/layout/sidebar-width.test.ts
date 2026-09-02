import { describe, expect, it } from "vitest";

import {
  SIDEBAR_DEFAULT_WIDTH,
  clampSidebarWidth,
  parseSidebarWidth,
  resolveSidebarDrag,
} from "./sidebar-width";

describe("clampSidebarWidth", () => {
  it("keeps values inside the expanded range", () => {
    expect(clampSidebarWidth(224)).toBe(224);
    expect(clampSidebarWidth(180)).toBe(200);
    expect(clampSidebarWidth(400)).toBe(320);
  });
});

describe("parseSidebarWidth", () => {
  it("reads a stored expanded width and falls back to the default", () => {
    expect(parseSidebarWidth("280")).toBe(280);
    expect(parseSidebarWidth("12")).toBe(200);
    expect(parseSidebarWidth("not-a-number")).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("resolveSidebarDrag", () => {
  it("clamps an expanded drag to 200–320", () => {
    expect(
      resolveSidebarDrag(250, { collapsed: false, width: 224 }),
    ).toEqual({ collapsed: false, width: 250 });
    expect(
      resolveSidebarDrag(400, { collapsed: false, width: 224 }),
    ).toEqual({ collapsed: false, width: 320 });
  });

  it("collapses when the pointer shrinks past the icon-rail threshold", () => {
    expect(
      resolveSidebarDrag(150, { collapsed: false, width: 280 }),
    ).toEqual({ collapsed: true, width: 280 });
  });

  it("stays collapsed until the pointer is wide enough to show labels again", () => {
    expect(
      resolveSidebarDrag(180, { collapsed: true, width: 280 }),
    ).toEqual({ collapsed: true, width: 280 });
    expect(
      resolveSidebarDrag(240, { collapsed: true, width: 280 }),
    ).toEqual({ collapsed: false, width: 240 });
  });
});
