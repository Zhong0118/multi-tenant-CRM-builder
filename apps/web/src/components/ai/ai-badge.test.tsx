import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiBadge } from "./ai-badge";

describe("AiBadge", () => {
  it("says AI wrote the content, or names what AI wrote", () => {
    const { rerender } = render(<AiBadge />);
    expect(screen.getByText("AI 生成")).toBeInTheDocument();
    rerender(<AiBadge>AI 提议</AiBadge>);
    expect(screen.getByText("AI 提议")).toBeInTheDocument();
  });
});
