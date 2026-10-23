import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_OBJECT_ICON,
  OBJECT_ICON_OPTIONS,
  ObjectIcon,
  isKnownObjectIcon,
} from "./object-icon";

describe("business table icons", () => {
  it("offers unique, labelled keys that fit the API's 64-character limit", () => {
    const keys = OBJECT_ICON_OPTIONS.map((option) => option.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(OBJECT_ICON_OPTIONS.map((option) => option.label)).size).toBe(keys.length);
    for (const option of OBJECT_ICON_OPTIONS) {
      expect(option.key).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(option.key.length).toBeLessThanOrEqual(64);
      expect(option.label.trim()).not.toBe("");
    }
    expect(keys).not.toContain("table");
    expect(DEFAULT_OBJECT_ICON.label).toBe("默认");
  });

  it("draws the chosen glyph", () => {
    const { container } = render(<ObjectIcon name="team" />);
    expect(container.querySelector('[data-icon="team"]')).toBeInTheDocument();
  });

  it.each([null, undefined, "", "contacts", "TEAM"])(
    "falls back to the default table icon for %j",
    (name) => {
      const { container } = render(<ObjectIcon name={name} />);
      expect(container.querySelector('[data-icon="table"]')).toBeInTheDocument();
    },
  );

  it("hides the glyph from assistive technology", () => {
    const { container } = render(<ObjectIcon name="user" />);
    expect(container.querySelector('[role="img"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("knows which stored keys it can draw", () => {
    expect(isKnownObjectIcon("rocket")).toBe(true);
    expect(isKnownObjectIcon("contacts")).toBe(false);
    expect(isKnownObjectIcon(null)).toBe(false);
  });
});
