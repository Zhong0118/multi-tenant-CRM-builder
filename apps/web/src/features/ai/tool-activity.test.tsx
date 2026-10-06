import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolActivity } from "./tool-activity";
import type { AiToolSummary } from "./ai-types";

const tool = (status: AiToolSummary["status"]): AiToolSummary =>
  ({
    callId: "c1",
    toolName: "list_followups",
    displayName: "查询跟进",
    status,
  }) as AiToolSummary;

describe("ToolActivity", () => {
  it("follows the running state until the user toggles it", () => {
    const view = render(<ToolActivity tools={[tool("RUNNING")]} />);
    expect(
      screen.getByRole("button", { name: "正在查询 CRM 数据" }),
    ).toHaveAttribute("aria-expanded", "true");

    view.rerender(<ToolActivity tools={[tool("COMPLETED")]} />);
    const toggle = screen.getByRole("button", { name: "已查询 1 项 CRM 数据" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/查询跟进/)).toBeInTheDocument();
    // Internal tool identifiers are not shown to users.
    expect(screen.queryByText("list_followups")).not.toBeInTheDocument();
  });
});
