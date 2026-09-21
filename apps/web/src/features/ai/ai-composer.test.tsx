import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiComposer } from "./ai-composer";

describe("AiComposer", () => {
  it("disables send for blank text and becomes Stop while streaming", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <AiComposer
        value="   "
        phase="IDLE"
        onChange={vi.fn()}
        onSend={onSend}
        onStop={onStop}
      />,
    );
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    rerender(
      <AiComposer
        value="问"
        phase="STREAMING"
        onChange={vi.fn()}
        onSend={onSend}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  });
});
