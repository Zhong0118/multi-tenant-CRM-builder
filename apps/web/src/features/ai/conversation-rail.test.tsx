import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConfigProvider } from "antd";
import { describe, expect, it, vi } from "vitest";

import { ConversationRail } from "./conversation-rail";

// A dialog exists exactly while open is true, independent of close animations.
// afterClose runs once the dialog has gone, as AntD does after its transition.
vi.mock("antd", async (importOriginal) => {
  const antd = await importOriginal<typeof import("antd")>();
  const { useEffect, useRef } = await import("react");
  function Modal({
    open,
    title,
    children,
    onOk,
    onCancel,
    okText,
    cancelText,
    okButtonProps,
    afterClose,
  }: import("antd").ModalProps) {
    const wasOpen = useRef(open);
    useEffect(() => {
      if (wasOpen.current && !open) afterClose?.();
      wasOpen.current = open;
    }, [open, afterClose]);
    return open ? (
      <div
        role="dialog"
        aria-label={typeof title === "string" ? title : undefined}
      >
        {children}
        <button onClick={onOk} disabled={okButtonProps?.disabled}>
          {okText ?? "OK"}
        </button>
        <button onClick={onCancel}>{cancelText ?? "Cancel"}</button>
      </div>
    ) : null;
  }
  return { ...antd, Modal };
});

const conversation = {
  id: "c1",
  title: "原标题",
  lastMessageAt: new Date().toISOString(),
};

function renderRail(
  overrides: Partial<React.ComponentProps<typeof ConversationRail>> = {},
) {
  // Without motion the row menus close at once instead of waiting for a CSS
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

async function openRename(title = "原标题") {
  fireEvent.click(screen.getByRole("button", { name: `会话操作：${title}` }));
  const activeRename = () =>
    screen
      .getAllByRole("menuitem", { name: "重命名" })
      .filter((item) => !item.closest(".ant-slide-up-leave"));
  await waitFor(() => expect(activeRename()).toHaveLength(1));
  fireEvent.click(activeRename()[0]);
}

describe("ConversationRail mutations", () => {
  it("keeps the edited title and modal open when rename rejects", async () => {
    const onRename = vi.fn().mockRejectedValue({
      status: 409,
      code: "CONFLICT",
      message: "会话名称已被占用",
      requestId: "req-rename-1",
    });
    renderRail({ onRename });
    await openRename();
    const input = screen.getByRole("textbox", { name: "会话名称" });
    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: /^保\s*存$/ }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("c1", "新标题"));
    // The server's reason and request number reach the user, not a generic line.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("重命名失败");
    expect(alert).toHaveTextContent("会话名称已被占用");
    expect(alert).toHaveTextContent("req-rename-1");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "会话名称" })).toHaveValue(
      "新标题",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^保\s*存$/ })).toBeEnabled(),
    );
  });

  it("closes the rename dialog after a successful save", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderRail({ onRename });
    await openRename();
    fireEvent.change(screen.getByRole("textbox", { name: "会话名称" }), {
      target: { value: "客户复盘" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "会话名称" }), {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith("c1", "客户复盘"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it.each(["resolve", "reject"] as const)(
    "keeps a reopened rename session when the old request %s completes",
    async (outcome) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const onRename = vi.fn().mockReturnValue(
        new Promise<void>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
      );
      renderRail({
        onRename,
        conversations: [
          conversation,
          { ...conversation, id: "c2", title: "另一会话" },
        ],
      });
      await openRename();
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "旧请求标题" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^保\s*存$/ }));
      fireEvent.click(screen.getByRole("button", { name: /^取\s*消$/ }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await openRename("另一会话");
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "新会话输入" },
      });
      await act(async () => {
        if (outcome === "resolve") resolve();
        else reject(new Error("旧请求失败"));
      });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toHaveValue("新会话输入");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^保\s*存$/ })).toBeEnabled();
    },
  );

  it("locks rename while pending and does not submit a duplicate", async () => {
    let resolve!: () => void;
    const onRename = vi
      .fn()
      .mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderRail({ onRename });
    await openRename();
    const modal = screen.getByRole("dialog");
    const ok = within(modal).getByRole("button", { name: /^保\s*存$/ });
    fireEvent.click(ok);
    fireEvent.click(ok);
    expect(onRename).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve();
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
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
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(onDelete).not.toHaveBeenCalled();
    // Focus returns to the row's menu button rather than falling to <body>.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "会话操作：原标题" }),
      ).toHaveFocus(),
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
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /新建会话/ })).toHaveFocus(),
    );
  });

  it("locks delete while pending and does not repeat the mutation", async () => {
    let resolve!: () => void;
    const onDelete = vi
      .fn()
      .mockReturnValue(new Promise<void>((r) => (resolve = r)));
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
