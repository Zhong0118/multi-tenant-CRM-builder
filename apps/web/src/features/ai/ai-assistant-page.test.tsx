import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiAssistantPage } from "./ai-assistant-page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/workspace/northwind/ai",
  conversation: undefined as string | undefined,
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  streamTurn: vi.fn(),
  retryTurn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(
    mocks.conversation ? `conversation=${mocks.conversation}` : "",
  ),
}));

vi.mock("./ai-api", () => ({
  aiQueryKeys: {
    conversations: (tenantCode: string) => ["ai", tenantCode, "c"],
    messages: (tenantCode: string, id: string) => ["ai", tenantCode, id],
  },
  aiApi: {
    listConversations: (...args: unknown[]) => mocks.listConversations(...args),
    listMessages: (...args: unknown[]) => mocks.listMessages(...args),
    streamTurn: (...args: unknown[]) => mocks.streamTurn(...args),
    retryTurn: (...args: unknown[]) => mocks.retryTurn(...args),
    rename: vi.fn(),
    remove: vi.fn(),
  },
}));

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.conversation = undefined;
  mocks.listConversations.mockResolvedValue({ items: [] });
  mocks.listMessages.mockResolvedValue({ items: [] });
  mocks.streamTurn.mockImplementation(async function* () {
    yield {
      event: "conversation.ready",
      data: { conversationId: "c1", title: "问", turnId: "t1" },
    };
    yield { event: "assistant.delta", data: { text: "你好" } };
    yield { event: "turn.completed", data: { turnId: "t1", messageId: "m1" } };
  });
});

function renderPage(client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return {
    client: queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AiAssistantPage
          tenantCode="northwind"
          businessObjects={[{ code: "leads", name: "销售线索" } as never]}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("AiAssistantPage", () => {
  it("shows the read-only header and updates the conversation query on conversation.ready", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /AI 助手/ })).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText("基于当前权限，询问可访问的 CRM 数据"),
      { target: { value: "帮我看看" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByText("你好")).toBeInTheDocument());
    expect(mocks.replace).toHaveBeenCalledWith(
      "/workspace/northwind/ai?conversation=c1",
    );
  });

  it("keeps the live turn after the URL hydrates the same conversation id", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t1" },
      };
      yield { event: "assistant.delta", data: { text: "你" } };
      await gate;
      yield { event: "assistant.delta", data: { text: "好" } };
      yield {
        event: "turn.completed",
        data: { turnId: "t1", messageId: "m1" },
      };
    });
    const view = renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("基于当前权限，询问可访问的 CRM 数据"),
      { target: { value: "帮我看看" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByText("你")).toBeInTheDocument());
    mocks.conversation = "c1";
    view.rerender(
      <QueryClientProvider client={view.client}>
        <AiAssistantPage
          tenantCode="northwind"
          businessObjects={[{ code: "leads", name: "销售线索" } as never]}
        />
      </QueryClientProvider>,
    );
    release();
    await waitFor(() => expect(screen.getByText("你好")).toBeInTheDocument());
    expect(screen.queryByText("你")).not.toBeInTheDocument();
  });

  it("ignores a stale aborted request after a newer turn starts", async () => {
    let finishA!: (error?: unknown) => void;
    const first = new Promise<void>((resolve, reject) => {
      finishA = (error) => (error ? reject(error) : resolve());
    });
    let calls = 0;
    mocks.streamTurn.mockImplementation(async function* () {
      calls += 1;
      if (calls === 1) {
        yield {
          event: "conversation.ready",
          data: { conversationId: "c1", title: "问", turnId: "t-a" },
        };
        await first;
        return;
      }
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-b" },
      };
      yield { event: "assistant.delta", data: { text: "第二轮" } };
      yield {
        event: "turn.completed",
        data: { turnId: "t-b", messageId: "m-b" },
      };
    });
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({
      items: [
        {
          id: "u1",
          conversationId: "c1",
          turnId: "t-old",
          role: "USER",
          status: "COMPLETED",
          content: "上一问",
          toolSummary: [],
          sourceSummary: [],
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("上一问")).toBeInTheDocument());
    fireEvent.change(
      screen.getByPlaceholderText("基于当前权限，询问可访问的 CRM 数据"),
      { target: { value: "第一轮" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByText("第一轮")).toBeInTheDocument());
    const afterFirst = mocks.streamTurn.mock.calls.length;
    fireEvent.change(
      screen.getByPlaceholderText("基于当前权限，询问可访问的 CRM 数据"),
      { target: { value: "第二轮提问" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(mocks.streamTurn.mock.calls.length).toBeGreaterThan(afterFirst),
    );
    finishA(new DOMException("Aborted", "AbortError"));
    await waitFor(() => expect(screen.getByText("第二轮")).toBeInTheDocument());
    expect(screen.queryByText("连接已中断")).not.toBeInTheDocument();
    expect(screen.queryByText("回答已停止")).not.toBeInTheDocument();
  });

  it("renders older history and a persisted FAILED retry", async () => {
    mocks.conversation = "c1";
    mocks.listMessages
      .mockResolvedValueOnce({
        items: [
          {
            id: "latest-user",
            conversationId: "c1",
            turnId: "t-new",
            role: "USER",
            status: "COMPLETED",
            content: "最近的问题",
            toolSummary: [],
            sourceSummary: [],
            createdAt: "2026-09-21T02:00:00.000Z",
          },
        ],
        nextBefore: "cursor-old",
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "old-failed",
            conversationId: "c1",
            turnId: "t-failed",
            role: "ASSISTANT",
            status: "FAILED",
            content: "旧回答失败",
            toolSummary: [],
            sourceSummary: [],
            errorCode: "AI_PROVIDER_TIMEOUT",
            createdAt: "2026-09-21T01:00:00.000Z",
          },
        ],
      });
    mocks.retryTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-failed" },
      };
      yield { event: "assistant.delta", data: { text: "重试成功" } };
      yield {
        event: "turn.completed",
        data: { turnId: "t-failed", messageId: "m-retry" },
      };
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("最近的问题")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
    await waitFor(() => expect(screen.getByText("旧回答失败")).toBeInTheDocument());
    expect(screen.getByText("最近的问题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(mocks.retryTurn).toHaveBeenCalledWith(
        "northwind",
        "t-failed",
        expect.any(AbortSignal),
      ),
    );
  });

  it("shows the sent USER prompt and the new conversation in the rail", async () => {
    mocks.listConversations
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({
        items: [
          {
            id: "c1",
            title: "帮我看看",
            lastMessageAt: "2026-09-21T00:00:00.000Z",
          },
        ],
      });
    renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("基于当前权限，询问可访问的 CRM 数据"),
      { target: { value: "帮我看看本月商机" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByText("帮我看看本月商机")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getAllByText("帮我看看").length).toBeGreaterThan(0),
    );
  });
});
