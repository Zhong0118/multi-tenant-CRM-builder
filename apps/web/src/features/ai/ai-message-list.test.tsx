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


describe("AiMessageList question navigation", () => {
  it("does not resume following during the first upward frames of a smooth anchor scroll", () => {
    render(<AiMessageList tenantCode="northwind" messages={[message("u1", "第一条问题"), message("u2", "第二条问题")]} phase="IDLE" />);
    const scroller = screen.getByTestId("ai-message-scroller");
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1600 },
      clientHeight: { value: 400 },
      scrollTop: { value: 1200, writable: true },
    });
    const scroll = vi.fn();
    scroller.scrollTo = scroll;
    fireEvent.scroll(scroller);
    fireEvent.click(screen.getByRole("button", { name: "定位提问：第一条问题" }));
    scroll.mockClear();
    scroller.scrollTop = 1198;
    fireEvent.scroll(scroller);
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "回到最新" })).toBeInTheDocument();
  });

  it("creates one accessible anchor per question and does not jump back down while reading", () => {
    const items = [message("u1", "第一条问题"), { ...message("a1", "回答一"), role: "ASSISTANT" }, message("u2", "第二条问题")];
    const { rerender } = render(<AiMessageList tenantCode="northwind" messages={items} phase="STREAMING" streaming />);
    const navigation = screen.getByRole("navigation", { name: "按提问定位" });
    expect(navigation.querySelectorAll("button")).toHaveLength(2);
    const scroller = screen.getByTestId("ai-message-scroller");
    const scroll = vi.fn();
    scroller.scrollTo = scroll;
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 300, writable: true });
    scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    const first = scroller.querySelector('[data-ai-question="u1"]') as HTMLElement;
    first.getBoundingClientRect = () => ({ top: 220 } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: "定位提问：第一条问题" }));
    expect(scroll).toHaveBeenLastCalledWith({ top: 404, behavior: "smooth" });
    scroll.mockClear();
    rerender(<AiMessageList tenantCode="northwind" messages={[...items, { ...message("a2", "新内容"), role: "ASSISTANT" }]} phase="STREAMING" streaming />);
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "定位提问：第一条问题" })).toHaveAttribute("aria-current", "location");
  });

  it("updates the active question from the actual viewport while scrolling", () => {
    render(<AiMessageList tenantCode="northwind" messages={[message("u1", "第一条问题"), message("u2", "第二条问题")]} phase="IDLE" />);
    const scroller = screen.getByTestId("ai-message-scroller");
    Object.defineProperties(scroller, { scrollHeight: { value: 1600 }, clientHeight: { value: 400 }, scrollTop: { value: 400 } });
    scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    const questions = scroller.querySelectorAll<HTMLElement>("[data-ai-question]");
    questions[0].getBoundingClientRect = () => ({ top: -200 } as DOMRect);
    questions[1].getBoundingClientRect = () => ({ top: 400 } as DOMRect);
    fireEvent.scroll(scroller);
    expect(screen.getByRole("button", { name: "定位提问：第一条问题" })).toHaveAttribute("aria-current", "location");
    questions[1].getBoundingClientRect = () => ({ top: 120 } as DOMRect);
    fireEvent.scroll(scroller);
    expect(screen.getByRole("button", { name: "定位提问：第二条问题" })).toHaveAttribute("aria-current", "location");
  });
});
