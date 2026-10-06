import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

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

describe("AiMessageList proposal errors", () => {
  it("passes proposal errors through to the assistant proposal card", () => {
    const proposal = {
      proposalId: "p1",
      operation: "UPDATE_RECORD",
      title: "更新客户",
      targetSummary: "客户",
      changes: [],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      failureCode: null,
      auditId: null,
      result: null,
    } as never;
    render(
      <AiMessageList
        tenantCode="northwind"
        messages={[{
          ...message("assistant", ""),
          role: "ASSISTANT",
          proposal,
        }]}
        phase="IDLE"
        proposalError="提案执行失败"
      />,
    );
    expect(screen.queryByText("提案执行失败")).toBeInTheDocument();
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

describe("AiMessageList completion announcement", () => {
  it("announces completion through a visually hidden live region", () => {
    render(
      <AiMessageList
        tenantCode="northwind"
        messages={[message("m1", "问题")]}
        phase="COMPLETED"
      />,
    );
    const status = screen.getByText("回答已完成");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.className).toMatch(/srOnly/);
  });
});

describe("AiMessageList pending answer", () => {
  it("shows a waiting line while the assistant row has no content yet", () => {
    render(
      <AiMessageList
        tenantCode="northwind"
        messages={[
          message("u1", "问题"),
          { ...message("a1", ""), role: "ASSISTANT", status: "GENERATING" },
        ]}
        phase="STREAMING"
      />,
    );
    expect(screen.getByText("正在整理回答…")).toBeInTheDocument();
  });
});
