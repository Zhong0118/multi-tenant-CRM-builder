import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationRail } from "./conversation-rail";

const conversation = {
  id: "c1",
  title: "原标题",
  lastMessageAt: new Date().toISOString(),
} as never;

function renderRail(overrides: Partial<React.ComponentProps<typeof ConversationRail>> = {}) {
  return render(
    <ConversationRail
      conversations={[conversation]}
      selectedId="c1"
      onNew={vi.fn()}
      onSelect={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  );
}

function openRename() {
  fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
  fireEvent.click(screen.getByText("重命名"));
}

describe("ConversationRail mutations", () => {
  it("keeps the edited title and modal open when rename rejects", async () => {
    const onRename = vi.fn().mockRejectedValue(new Error("重命名失败"));
    renderRail({ onRename });
    openRename();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("c1", "新标题"));
    expect(screen.getByRole("textbox")).toHaveValue("新标题");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("locks rename while pending and does not submit a duplicate", async () => {
    let resolve!: () => void;
    const onRename = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderRail({ onRename });
    openRename();
    const modal = screen.getByRole("dialog");
    const ok = within(modal).getByRole("button", { name: "OK" });
    fireEvent.click(ok);
    fireEvent.click(ok);
    expect(onRename).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
  });

  it("locks delete while pending and does not repeat the mutation", async () => {
    let resolve!: () => void;
    const onDelete = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderRail({ onDelete });
    fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
    const deleteItem = screen.getByText("删除");
    fireEvent.click(deleteItem);
    fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    resolve();
  });
});
