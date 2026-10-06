import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConfigProvider } from "antd";
import { describe, expect, it, vi } from "vitest";

import { ConversationRail } from "./conversation-rail";

const conversation = {
  id: "c1",
  title: "原标题",
  lastMessageAt: new Date().toISOString(),
} as never;

function renderRail(overrides: Partial<React.ComponentProps<typeof ConversationRail>> = {}) {
  // Without motion, closing dialogs unmount instead of waiting for a CSS
  // transition that jsdom never finishes.
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <ConversationRail
        conversations={[conversation]}
        selectedId="c1"
        onNew={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        {...overrides}
      />
    </ConfigProvider>,
  );
}

function openRename() {
  fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
  fireEvent.click(screen.getByText("重命名"));
}

describe("ConversationRail mutations", () => {
  it("keeps the edited title and modal open when rename rejects", async () => {
    const onRename = vi.fn().mockRejectedValue(new Error("会话名称已被占用"));
    renderRail({ onRename });
    openRename();
    const input = screen.getByRole("textbox", { name: "会话名称" });
    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: /^保\s*存$/ }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("c1", "新标题"));
    // Wait for the rejection to settle before asserting the dialog survived it.
    expect(await screen.findByText("会话名称已被占用")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "会话名称" })).toHaveValue("新标题");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^保\s*存$/ })).toBeEnabled(),
    );
  });

  it("closes the rename dialog after a successful save", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderRail({ onRename });
    openRename();
    fireEvent.change(screen.getByRole("textbox", { name: "会话名称" }), {
      target: { value: "客户复盘" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "会话名称" }), {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("c1", "客户复盘"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("locks rename while pending and does not submit a duplicate", async () => {
    let resolve!: () => void;
    const onRename = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderRail({ onRename });
    openRename();
    const modal = screen.getByRole("dialog");
    const ok = within(modal).getByRole("button", { name: /^保\s*存$/ });
    fireEvent.click(ok);
    fireEvent.click(ok);
    expect(onRename).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
  });

  it("asks for confirmation before deleting and can be cancelled", async () => {
    const onDelete = vi.fn();
    renderRail({ onDelete });
    fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
    fireEvent.click(screen.getByText("删除"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("「原标题」及其全部消息删除后无法找回");
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^取\s*消$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();
    // Focus returns to the row's menu button rather than falling to <body>.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "会话操作：原标题" })).toHaveFocus(),
    );
  });

  it("moves focus to 新建会话 after the row is deleted", async () => {
    const view = renderRail({ onDelete: vi.fn().mockResolvedValue(undefined) });
    fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
    fireEvent.click(screen.getByText("删除"));
    const dialog = await screen.findByRole("dialog");
    view.rerender(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <ConversationRail
          conversations={[]}
          onNew={vi.fn()}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        />
      </ConfigProvider>,
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /^删\s*除$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /新建会话/ })).toHaveFocus(),
    );
  });

  it("locks delete while pending and does not repeat the mutation", async () => {
    let resolve!: () => void;
    const onDelete = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderRail({ onDelete });
    fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
    fireEvent.click(screen.getByText("删除"));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /^删\s*除$/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("c1");
    resolve();
  });

  it("explains the empty list", () => {
    renderRail({ conversations: [] });
    expect(screen.getByText(/还没有会话/)).toBeInTheDocument();
  });
});
