import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AiMessageList, nextPrependScrollTop } from "./ai-message-list";
import type { AiMessage } from "./ai-types";

function message(id: string, content: string): AiMessage {
  return {
    id,
    conversationId: "c1",
    turnId: id,
    role: "USER",
    status: "COMPLETED",
    content,
    toolSummary: [],
    sourceSummary: [],
    createdAt: "2026-09-21T00:00:00.000Z",
  };
}

describe("nextPrependScrollTop", () => {
  it("keeps the previous viewport after older messages increase height", () => {
    expect(
      nextPrependScrollTop({ height: 1000, top: 200 }, 1400),
    ).toBe(600);
  });
});

describe("AiMessageList prepend anchor", () => {
  it("records scroll geometry before loading older messages and restores it after prepend", () => {
    function Harness({ onGrow }: { onGrow: () => void }) {
      const [items, setItems] = useState([message("latest", "最近的问题")]);
      return (
        <AiMessageList
          tenantCode="northwind"
          messages={items}
          phase="IDLE"
          onLoadOlder={() => {
            onGrow();
            setItems([message("old", "更早的问题"), ...items]);
          }}
        />
      );
    }
    let height = 1000;
    let top = 200;
    render(<Harness onGrow={() => { height = 1400; }} />);
    const scroller = screen.getByTestId("ai-message-scroller");
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => height,
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    fireEvent.scroll(scroller);
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
    expect(screen.getByText("更早的问题")).toBeInTheDocument();
    expect(top).toBe(600);
  });

  it("clears the prepend anchor when older history fails to load", async () => {
    let height = 1000;
    let top = 200;
    const { rerender } = render(
      <AiMessageList
        tenantCode="northwind"
        messages={[message("latest", "最近的问题")]}
        phase="IDLE"
        onLoadOlder={async () => {
          throw new Error("load older failed");
        }}
      />,
    );
    const scroller = screen.getByTestId("ai-message-scroller");
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => height,
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    fireEvent.scroll(scroller);
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
    await Promise.resolve();
    await Promise.resolve();
    height = 1400;
    rerender(
      <AiMessageList
        tenantCode="northwind"
        messages={[
          message("latest", "最近的问题"),
          message("newer", "更新的问题"),
        ]}
        phase="IDLE"
      />,
    );
    expect(top).toBe(200);
  });
});
