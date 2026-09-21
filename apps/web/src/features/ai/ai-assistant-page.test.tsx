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
    retryTurn: vi.fn(),
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AiAssistantPage
        tenantCode="northwind"
        businessObjects={[{ code: "leads", name: "销售线索" } as never]}
      />
    </QueryClientProvider>,
  );
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
});
