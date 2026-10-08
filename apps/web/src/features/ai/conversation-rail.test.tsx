import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationRail } from "./conversation-rail";

// A dialog exists exactly while open is true, independent of close animations.
vi.mock("antd", async (importOriginal) => {
  const antd = await importOriginal<typeof import("antd")>();
  return {
    ...antd,
    Modal: ({
      open,
      title,
      children,
      onOk,
      onCancel,
      okButtonProps,
    }: import("antd").ModalProps) =>
      open ? (
        <div
          role="dialog"
          aria-label={typeof title === "string" ? title : undefined}
        >
          {children}
          <button onClick={onOk} disabled={okButtonProps?.disabled}>
            OK
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      ) : null,
  };
});

const conversation = {
  id: "c1",
  title: "原标题",
  lastMessageAt: new Date().toISOString(),
};

function renderRail(
  overrides: Partial<React.ComponentProps<typeof ConversationRail>> = {},
) {
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
    const onRename = vi.fn().mockRejectedValue(new Error("重命名失败"));
    renderRail({ onRename });
    await openRename();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("重命名失败");
    expect(screen.getByRole("textbox")).toHaveValue("新标题");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
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
      expect(screen.getByRole("button", { name: "OK" })).toBeEnabled();
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
    const ok = within(modal).getByRole("button", { name: "OK" });
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

  it("locks delete while pending and does not repeat the mutation", async () => {
    let resolve!: () => void;
    const onDelete = vi
      .fn()
      .mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderRail({ onDelete });
    fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
    const deleteItem = screen.getByText("删除");
    fireEvent.click(deleteItem);
    fireEvent.click(screen.getByRole("button", { name: "会话操作：原标题" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    resolve();
  });
});
