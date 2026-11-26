import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiAccessContext } from "@/features/ai-governance/access";
import type { Capabilities } from "@/features/ai-governance/workspace-api";
import { AiAssistantPage } from "./ai-assistant-page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  pathname: "/workspace/northwind/ai",
  conversation: undefined as string | undefined,
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  streamTurn: vi.fn(),
  retryTurn: vi.fn(),
  confirmBatch:vi.fn(),
  confirmProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getProposal: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  usePathname: () => mocks.pathname,
  useSearchParams: () =>
    new URLSearchParams(
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
    confirmBatch: (...args: unknown[])=>mocks.confirmBatch(...args),
    confirmProposal: (...args: unknown[]) => mocks.confirmProposal(...args),
    rejectProposal: (...args: unknown[]) => mocks.rejectProposal(...args),
    getProposal: (...args: unknown[]) => mocks.getProposal(...args),
    rename: (...args: unknown[]) => mocks.rename(...args),
    remove: (...args: unknown[]) => mocks.remove(...args),
  },
}));

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.retryTurn.mockReset();
  mocks.listConversations.mockReset();
  mocks.listMessages.mockReset();
  mocks.conversation = undefined;
  mocks.listConversations.mockResolvedValue({ items: [] });
  mocks.listMessages.mockResolvedValue({ items: [] });
  mocks.confirmBatch.mockReset();
  mocks.confirmProposal.mockReset();
  mocks.rejectProposal.mockReset();
  mocks.getProposal.mockReset();
  mocks.rename.mockReset();
  mocks.remove.mockReset();
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
  it("keeps a draft but blocks sending and quick prompts until the company quota recovers", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const caps: Capabilities = { features: ["assistant"], disabled: false, allocation: "shared", restoresAt: "2026-11-30T16:00:00Z", notice: null, percent: null, remainingTokens: null };
    const page = (value: Capabilities) => (
      <QueryClientProvider client={client}>
        <AiAccessContext.Provider value={value}>
          <AiAssistantPage tenantCode="northwind" businessObjects={[]} />
        </AiAccessContext.Provider>
      </QueryClientProvider>
    );
    const view = render(page(caps));
    const input = screen.getByPlaceholderText("输入你的问题");
    fireEvent.change(input, { target: { value: "查询记录" } });
    expect(await screen.findByRole("button", {name:"最近有哪些需要跟进？"})).toBeEnabled();
    view.rerender(page({...caps, notice:"company_exhausted",percent:100}));
    expect(input).toBeDisabled();
    expect(screen.getByRole("button",{name:"发送"})).toBeDisabled();
    expect(screen.queryByRole("button",{name:"最近有哪些需要跟进？"})).toBeNull();
    expect(screen.getByText(/恢复。如需增加，请联系管理员/)).toBeVisible();
    expect(mocks.streamTurn).not.toHaveBeenCalled();
    view.rerender(page(caps));
    expect(input).toHaveValue("查询记录");
    expect(input).toBeEnabled();
    expect(screen.getByRole("button",{name:"最近有哪些需要跟进？"})).toBeEnabled();
  });

  it("shows mutation recovery feedback and restores the server proposal after confirm timeout", async () => {
    const proposal = {
      proposalId: "p1",
      operation: "UPDATE_RECORD",
      title: "更新客户",
      targetSummary: "Acme",
      changes: [{ label: "状态", before: "线索", after: "成交" }],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      failureCode: null,
      auditId: null,
      result: null,
    };
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({
      items: [
        {
          id: "m1",
          conversationId: "c1",
          turnId: "t1",
          role: "ASSISTANT",
          status: "COMPLETED",
          content: "",
          toolSummary: [],
          sourceSummary: [],
          proposal,
          createdAt: "2026-09-23T00:00:00.000Z",
        },
      ],
    });
    mocks.confirmProposal.mockRejectedValue(new Error("timeout"));
    mocks.getProposal.mockResolvedValue({
      ...proposal,
      status: "CONFLICTED",
      failureCode: "RECORD_VERSION_CONFLICT",
    });
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "确认执行" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() =>
      expect(mocks.getProposal).toHaveBeenCalledWith("northwind", "p1"),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("数据已变化"),
    );
  });

  it("restores rejected history after reject", async () => {
    const proposal = {
      proposalId: "p2",
      operation: "ADD_ACTIVITY_NOTE",
      title: "添加备注",
      targetSummary: "Acme",
      changes: [{ label: "NOTE", after: "已联系" }],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      failureCode: null,
      auditId: null,
      result: null,
    };
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({
      items: [
        {
          id: "m2",
          conversationId: "c1",
          turnId: "t2",
          role: "ASSISTANT",
          status: "COMPLETED",
          content: "",
          toolSummary: [],
          sourceSummary: [],
          proposal,
          createdAt: "2026-09-23T00:00:00.000Z",
        },
      ],
    });
    mocks.rejectProposal.mockResolvedValue({ ...proposal, status: "REJECTED" });
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /拒\s*绝/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /拒\s*绝/ }));
    await waitFor(() =>
      expect(screen.getByText("已拒绝，未写入数据。")).toBeInTheDocument(),
    );
  });

  it("keeps freshly redacted server history authoritative over an earlier mutation response", async () => {
    const proposal = {
      proposalId: "p-redact",
      operation: "UPDATE_RECORD",
      title: "更新客户",
      targetSummary: "old secret",
      changes: [{ label: "姓名", after: "old secret" }],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      failureCode: null,
      auditId: null,
      result: null,
    };
    const message = {
      id: "m-redact",
      conversationId: "c1",
      turnId: "t1",
      role: "ASSISTANT",
      status: "COMPLETED",
      content: "",
      toolSummary: [],
      sourceSummary: [],
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({ items: [{ ...message, proposal }] });
    mocks.rejectProposal.mockResolvedValue({ ...proposal, status: "REJECTED" });
    const { client } = renderPage();
    await screen.findByText("old secret", { selector: "p" });
    fireEvent.click(screen.getByRole("button", { name: /拒\s*绝/ }));
    await screen.findByText("已拒绝，未写入数据。");
    client.setQueryData(["ai", "northwind", "c1"], {
      pages: [
        {
          items: [
            {
              ...message,
              proposal: {
                ...proposal,
                status: "REJECTED",
                targetSummary: "",
                changes: [],
                result: null,
              },
            },
          ],
        },
      ],
      pageParams: [undefined],
    });
    await waitFor(() =>
      expect(screen.queryByText("old secret")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("已拒绝，未写入数据。")).toBeInTheDocument();
  });

  it("removes a cached mutation field error after a redacted history refetch", async () => {
    const proposal = {
      proposalId: "p-failed",
      operation: "UPDATE_RECORD",
      title: "更新客户",
      targetSummary: "客户",
      changes: [],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      failureCode: null,
      fieldErrors: {},
      auditId: null,
      result: null,
    };
    const message = {
      id: "m-failed",
      conversationId: "c1",
      turnId: "t1",
      role: "ASSISTANT",
      status: "COMPLETED",
      content: "",
      toolSummary: [],
      sourceSummary: [],
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({ items: [{ ...message, proposal }] });
    mocks.confirmProposal.mockResolvedValue({
      ...proposal,
      status: "FAILED",
      failureCode: "FIELD_INVALID",
      fieldErrors: { secret: ["校验失败"] },
    });
    const { client } = renderPage();
    await screen.findByRole("button", { name: "确认执行" });
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await screen.findByText("校验失败");
    client.setQueryData(["ai", "northwind", "c1"], {
      pages: [
        {
          items: [
            {
              ...message,
              proposal: {
                ...proposal,
                status: "FAILED",
                failureCode: "FIELD_INVALID",
                fieldErrors: {},
              },
            },
          ],
        },
      ],
      pageParams: [undefined],
    });
    await waitFor(() =>
      expect(screen.queryByText("校验失败")).not.toBeInTheDocument(),
    );
  });

  it("refreshes the record beside the panel once a confirmed change is written", async () => {
    const proposal = {
      proposalId: "p-exec",
      operation: "UPDATE_RECORD",
      title: "修改记录",
      targetSummary: "Acme",
      changes: [{ label: "阶段", before: "初步接触", after: "商务谈判" }],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      fieldErrors: {},
      failureCode: null,
      auditId: null,
      result: null,
    };
    mocks.conversation = "c1";
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-exec" },
      };
      yield {
        event: "proposal.ready",
        data: { turnId: "t-exec", batch: { items: [proposal] } },
      };
      yield {
        event: "turn.completed",
        data: { turnId: "t-exec", messageId: "m-exec" },
      };
    });
    mocks.confirmBatch.mockResolvedValue({
      items: [{ proposalId: "p-exec", status: "EXECUTED", message: "已执行" }],
    });
    renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "改阶段" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认执行" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("replaces a completed live card with fresh server history after field access revocation", async () => {
    const proposal = {
      proposalId: "p-live-field",
      operation: "UPDATE_RECORD",
      title: "修改记录",
      targetSummary: "old secret",
      changes: [{ label: "名称", after: "old secret" }],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      fieldErrors: {},
      failureCode: null,
      auditId: null,
      result: null,
    };
    mocks.conversation = "c1";
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-live-field" },
      };
      yield {
        event: "proposal.ready",
        data: { turnId: "t-live-field", batch:{items:[proposal]} },
      };
      yield {
        event: "turn.completed",
        data: { turnId: "t-live-field", messageId: "m-live-field" },
      };
    });
    mocks.confirmBatch.mockResolvedValue({items:[{proposalId:proposal.proposalId,status:"FAILED",message:"校验失败"}]});
    const { client } = renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "修改记录" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认执行" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await screen.findByText("校验失败");
    client.setQueryData(["ai", "northwind", "c1"], {
      pages: [
        {
          items: [
            {
              id: "m-live-field",
              conversationId: "c1",
              turnId: "t-live-field",
              role: "ASSISTANT",
              status: "COMPLETED",
              content: "",
              toolSummary: [],
              sourceSummary: [],
              createdAt: "2026-09-23T00:00:00.000Z",
              proposal: {
                ...proposal,
                status: "FAILED",
                failureCode: "FIELD_INVALID",
                targetSummary: "",
                changes: [],
                fieldErrors: {},
              },
            },
          ],
        },
      ],
      pageParams: [undefined],
    });
    await waitFor(() =>
      expect(screen.queryByText("校验失败")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("old secret")).not.toBeInTheDocument();
  });

  it("shows a rejected live SSE proposal immediately without reloading history", async () => {
    const proposal = {
      proposalId: "p-live-reject",
      operation: "ADD_ACTIVITY_NOTE",
      title: "添加备注",
      targetSummary: "Acme",
      changes: [{ label: "备注", after: "已联系" }],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      failureCode: null,
      auditId: null,
      result: null,
    };
    mocks.conversation = "c1";
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-live" },
      };
      yield { event: "proposal.ready", data: { turnId: "t-live", batch:{items:[proposal]} } };
      yield {
        event: "turn.completed",
        data: { turnId: "t-live", messageId: "m-live" },
      };
    });
    mocks.rejectProposal.mockResolvedValue({ ...proposal, status: "REJECTED" });
    renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "添加备注" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /拒\s*绝/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /拒\s*绝/ }));
    await waitFor(() =>
      expect(screen.getByText("已拒绝，未写入数据。")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "确认执行" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /拒\s*绝/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a conflicted live SSE proposal immediately after confirmation", async () => {
    const proposal = {
      proposalId: "p-live-conflict",
      operation: "UPDATE_RECORD",
      title: "更新客户",
      targetSummary: "Acme",
      changes: [{ label: "状态", before: "线索", after: "成交" }],
      validationWarnings: [],
      expiresAt: "2999-01-01T00:00:00.000Z",
      status: "PROPOSED",
      failureCode: null,
      auditId: null,
      result: null,
    };
    mocks.conversation = "c1";
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-live" },
      };
      yield { event: "proposal.ready", data: { turnId: "t-live", batch:{items:[proposal]} } };
      yield {
        event: "turn.completed",
        data: { turnId: "t-live", messageId: "m-live" },
      };
    });
    mocks.confirmBatch.mockResolvedValue({items:[{proposalId:proposal.proposalId,status:"CONFLICTED",message:"数据已变化，未覆盖最新内容"}]});
    renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "更新客户" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认执行" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("数据已变化"),
    );
    expect(screen.getByText("已冲突")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "确认执行" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /拒\s*绝/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the read-only header and updates the conversation query on conversation.ready", async () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: /AI 助手/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("只查你有权限的数据，修改前会请你确认")).toBeInTheDocument();
    expect(screen.getByTestId("ai-conversation-canvas")).toBeInTheDocument();
    expect(
      screen.getByText("Enter 发送 · Shift+Enter 换行"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "会话" })).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
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
      screen.getByPlaceholderText("输入你的问题"),
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

  it("ignores a stale aborted request after Stop then a newer turn", async () => {
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
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "第一轮" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "第二轮提问" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    finishA(new DOMException("Aborted", "AbortError"));
    await waitFor(() => expect(screen.getByText("第二轮")).toBeInTheDocument());
    expect(screen.queryByText("连接已中断")).not.toBeInTheDocument();
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
    await waitFor(() =>
      expect(screen.getByText("最近的问题")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
    await waitFor(() =>
      expect(screen.getByText("旧回答失败")).toBeInTheDocument(),
    );
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
      screen.getByPlaceholderText("输入你的问题"),
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

  it("abandons an in-flight turn when the rail selects another conversation", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    mocks.streamTurn.mockImplementation(async function* () {
      await gateA;
      yield {
        event: "conversation.ready",
        data: { conversationId: "c-new", title: "新问", turnId: "t-late" },
      };
      yield { event: "assistant.delta", data: { text: "晚到的回答" } };
    });
    mocks.listConversations.mockResolvedValue({
      items: [
        {
          id: "c-b",
          title: "会话B",
          lastMessageAt: new Date().toISOString(),
        },
      ],
    });
    mocks.listMessages.mockImplementation((_tenant: string, id: string) =>
      Promise.resolve({
        items:
          id === "c-b"
            ? [
                {
                  id: "b1",
                  conversationId: "c-b",
                  turnId: "tb",
                  role: "USER",
                  status: "COMPLETED",
                  content: "B的历史",
                  toolSummary: [],
                  sourceSummary: [],
                  createdAt: "2026-09-21T00:00:00.000Z",
                },
              ]
            : [],
      }),
    );
    const view = renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "新问题" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "会话B" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "会话B" }));
    mocks.conversation = "c-b";
    view.rerender(
      <QueryClientProvider client={view.client}>
        <AiAssistantPage
          tenantCode="northwind"
          businessObjects={[{ code: "leads", name: "销售线索" } as never]}
        />
      </QueryClientProvider>,
    );
    releaseA();
    await waitFor(() =>
      expect(screen.getByText("B的历史")).toBeInTheDocument(),
    );
    expect(screen.queryByText("晚到的回答")).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith(
      "/workspace/northwind/ai?conversation=c-b",
    );
  });

  it("abandons an in-flight turn when starting a new conversation", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    mocks.conversation = "c1";
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-a" },
      };
      yield { event: "assistant.delta", data: { text: "进行中" } };
      await gateA;
      yield { event: "assistant.delta", data: { text: "不该出现" } };
      yield {
        event: "turn.completed",
        data: { turnId: "t-a", messageId: "m-a" },
      };
    });
    mocks.listMessages.mockResolvedValue({ items: [] });
    const view = renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "进行中的问题" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByText("进行中")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    mocks.conversation = undefined;
    view.rerender(
      <QueryClientProvider client={view.client}>
        <AiAssistantPage
          tenantCode="northwind"
          businessObjects={[{ code: "leads", name: "销售线索" } as never]}
        />
      </QueryClientProvider>,
    );
    releaseA();
    await waitFor(() =>
      expect(screen.getByText("只查你有权限的数据，修改前会请你确认")).toBeInTheDocument(),
    );
    expect(screen.queryByText("不该出现")).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/workspace/northwind/ai");
  });

  it("abandons A when browser history opens a different conversation", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    mocks.conversation = "c1";
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-a" },
      };
      yield { event: "assistant.delta", data: { text: "A流" } };
      await gateA;
      yield { event: "assistant.delta", data: { text: "污染B" } };
    });
    mocks.listConversations.mockResolvedValue({
      items: [
        {
          id: "c1",
          title: "会话A",
          lastMessageAt: new Date().toISOString(),
        },
        {
          id: "c2",
          title: "会话B",
          lastMessageAt: new Date().toISOString(),
        },
      ],
    });
    mocks.listMessages.mockImplementation((_tenant: string, id: string) =>
      Promise.resolve({
        items:
          id === "c2"
            ? [
                {
                  id: "b1",
                  conversationId: "c2",
                  turnId: "tb",
                  role: "USER",
                  status: "COMPLETED",
                  content: "B历史",
                  toolSummary: [],
                  sourceSummary: [],
                  createdAt: "2026-09-21T00:00:00.000Z",
                },
              ]
            : [],
      }),
    );
    const view = renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "A问" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByText("A流")).toBeInTheDocument());
    mocks.conversation = "c2";
    view.rerender(
      <QueryClientProvider client={view.client}>
        <AiAssistantPage
          tenantCode="northwind"
          businessObjects={[{ code: "leads", name: "销售线索" } as never]}
        />
      </QueryClientProvider>,
    );
    releaseA();
    await waitFor(() => expect(screen.getByText("B历史")).toBeInTheDocument());
    expect(screen.queryByText("污染B")).not.toBeInTheDocument();
  });

  it("retries a real turnId after ready and never retries unknown before ready", async () => {
    let failReady!: (error?: unknown) => void;
    const afterReady = new Promise<void>((_resolve, reject) => {
      failReady = (error) => reject(error);
    });
    mocks.streamTurn.mockImplementationOnce(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t1" },
      };
      await afterReady;
    });
    mocks.retryTurn.mockImplementation(async function* () {
      yield { event: "assistant.delta", data: { text: "重试后" } };
      yield {
        event: "turn.completed",
        data: { turnId: "t1", messageId: "m1" },
      };
    });
    renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "有 turn 的失败" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument(),
    );
    failReady(new Error("network"));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(mocks.retryTurn).toHaveBeenCalledWith(
        "northwind",
        "t1",
        expect.any(AbortSignal),
      ),
    );

    mocks.retryTurn.mockClear();
    cleanup();
    mocks.streamTurn.mockImplementationOnce(async function* () {
      throw new Error("network-before-ready");
    });
    const fresh = renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "还没 ready" } },
    );
    fireEvent.click(fresh.container.querySelector('[aria-label="发送"]')!);
    await waitFor(() =>
      expect(screen.getByText("连接已中断")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
    expect(mocks.retryTurn).not.toHaveBeenCalled();
  });

  it("keeps an older identical USER prompt while a new pending send is visible", async () => {
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({
      items: [
        {
          id: "old",
          conversationId: "c1",
          turnId: "t-old",
          role: "USER",
          status: "COMPLETED",
          content: "帮我总结客户",
          toolSummary: [],
          sourceSummary: [],
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ],
    });
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-new" },
      };
      await new Promise(() => undefined);
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("帮我总结客户")).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "帮我总结客户" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getAllByText("帮我总结客户")).toHaveLength(2),
    );
  });

  it("shows 回答已停止 for persisted CANCELLED and one retry control", async () => {
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({
      items: [
        {
          id: "cancelled",
          conversationId: "c1",
          turnId: "t-stop",
          role: "ASSISTANT",
          status: "CANCELLED",
          content: "半句",
          toolSummary: [],
          sourceSummary: [],
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ],
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("回答已停止")).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(1);
    expect(
      screen.queryByText("AI 服务暂时不可用，请稍后重试"),
    ).not.toBeInTheDocument();
  });

  it("shows the partial warning once after a tool failure completes the turn", async () => {
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t1" },
      };
      yield {
        event: "tool.failed",
        data: {
          callId: "x",
          toolName: "list_followups",
          displayName: "查询跟进",
          status: "FAILED",
        },
      };
      yield { event: "assistant.delta", data: { text: "部分结果" } };
      yield {
        event: "turn.completed",
        data: { turnId: "t1", messageId: "m1" },
      };
    });
    renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "问跟进" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("部分查询未成功，可展开查看"),
      ).toHaveLength(1),
    );
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).toBeInTheDocument();
  });

  it("shows the partial warning once for persisted COMPLETED with a failed tool", async () => {
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({
      items: [
        {
          id: "partial",
          conversationId: "c1",
          turnId: "t-partial",
          role: "ASSISTANT",
          status: "COMPLETED",
          content: "部分结果",
          toolSummary: [
            {
              callId: "x",
              toolName: "list_followups",
              displayName: "查询跟进",
              status: "FAILED",
            },
          ],
          sourceSummary: [],
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ],
    });
    renderPage();
    await waitFor(() =>
      expect(
        screen.getAllByText("部分查询未成功，可展开查看"),
      ).toHaveLength(1),
    );
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).toBeInTheDocument();
    mocks.retryTurn.mockClear();
    mocks.retryTurn.mockImplementation(async function* () {
      yield { event: "turn.started", data: { turnId: "t-partial" } };
      await new Promise(() => undefined);
    });
    const retryButton = screen.getByRole("button", { name: "重试" });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    expect(mocks.retryTurn).toHaveBeenCalledTimes(1);
    expect(mocks.retryTurn).toHaveBeenCalledWith("northwind", "t-partial", expect.any(AbortSignal));
    expect(mocks.confirmProposal).not.toHaveBeenCalled();
  });

  it("does not run historical Retry while a turn is generating", async () => {
    mocks.conversation = "c1";
    mocks.listMessages.mockResolvedValue({
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
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ],
    });
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t-live" },
      };
      await new Promise(() => undefined);
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("旧回答失败")).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "新问题" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
    expect(mocks.retryTurn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "重试" }).length,
      ).toBeGreaterThan(0),
    );
  });

  it("offers retry when conversations fail to load", async () => {
    mocks.listConversations.mockRejectedValueOnce(new Error("会话失败"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("会话加载失败"),
    );
    mocks.listConversations.mockResolvedValueOnce({ items: [] });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(mocks.listConversations).toHaveBeenCalledTimes(2),
    );
  });

  it("offers retry when messages fail to load", async () => {
    mocks.conversation = "c1";
    mocks.listMessages.mockRejectedValueOnce(new Error("消息失败"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("消息加载失败"),
    );
    mocks.listMessages.mockResolvedValueOnce({ items: [] });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(2));
  });

  it("aborts the in-flight stream when the page unmounts", async () => {
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t1" },
      };
      await new Promise(() => undefined);
    });
    const view = renderPage();
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "进行中" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(mocks.streamTurn).toHaveBeenCalled());
    const signal = mocks.streamTurn.mock.calls.at(-1)?.[2] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  function historyRow(overrides: Record<string, unknown>) {
    return {
      conversationId: "c1",
      turnId: "t1",
      status: "COMPLETED",
      content: "",
      toolSummary: [],
      sourceSummary: [],
      createdAt: "2026-10-06T00:00:00.000Z",
      ...overrides,
    };
  }

  it("keeps streaming text visible after history returns the GENERATING placeholder", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.conversation = "c1";
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t1" },
      };
      yield { event: "assistant.delta", data: { text: "正在整理的回答" } };
      await gate;
      yield {
        event: "turn.completed",
        data: { turnId: "t1", messageId: "a1" },
      };
    });
    const { client } = renderPage();
    await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(1));
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "本周情况" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByText("正在整理的回答")).toBeInTheDocument(),
    );

    // The server persists USER + GENERATING ASSISTANT rows as soon as the turn starts.
    mocks.listMessages.mockResolvedValue({
      items: [
        historyRow({ id: "u1", role: "USER", content: "本周情况" }),
        historyRow({ id: "a1", role: "ASSISTANT", status: "GENERATING" }),
      ],
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["ai", "northwind", "c1"] });
      // Let React Query flush its batched observer notification.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const answer = screen.getByText("正在整理的回答");
    const question = screen.getByText("本周情况");
    expect(screen.getAllByText("本周情况")).toHaveLength(1);
    expect(
      question.compareDocumentPosition(answer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    mocks.listMessages.mockResolvedValue({
      items: [
        historyRow({ id: "u1", role: "USER", content: "本周情况" }),
        historyRow({ id: "a1", role: "ASSISTANT", content: "正在整理的回答" }),
      ],
    });
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument(),
    );
    expect(screen.getAllByText("正在整理的回答")).toHaveLength(1);
  });

  it("orders a failed turn after its question and reports the failure once", async () => {
    mocks.conversation = "c1";
    mocks.streamTurn.mockImplementation(async function* () {
      yield {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t1" },
      };
      yield {
        event: "turn.failed",
        data: { turnId: "t1", code: "AI_PROVIDER_UNAVAILABLE" },
      };
    });
    renderPage();
    await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(1));
    mocks.listMessages.mockResolvedValue({
      items: [
        historyRow({ id: "u1", role: "USER", content: "这次会失败" }),
        historyRow({
          id: "a1",
          role: "ASSISTANT",
          status: "FAILED",
          errorCode: "AI_PROVIDER_UNAVAILABLE",
        }),
      ],
    });
    fireEvent.change(
      screen.getByPlaceholderText("输入你的问题"),
      { target: { value: "这次会失败" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getAllByText("AI 服务暂时不可用，请稍后重试")).toHaveLength(
        1,
      ),
    );
    const question = within(screen.getByRole("region",{name:"AI 对话内容"})).getByText("这次会失败");
    expect(screen.getByRole("textbox")).toHaveValue("这次会失败");
    const failure = screen.getByText("AI 服务暂时不可用，请稍后重试");
    expect(
      question.compareDocumentPosition(failure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(1);
  });

  describe("retrying a persisted failure", () => {
    const previousFailure = () =>
      historyRow({
        id: "a-failed",
        role: "ASSISTANT",
        turnId: "t-failed",
        status: "FAILED",
        errorCode: "AI_PROVIDER_TIMEOUT",
        completedAt: "2026-10-06T00:00:05.000Z",
      });
    const history = () => ({
      items: [
        historyRow({
          id: "u-failed",
          role: "USER",
          turnId: "t-failed",
          content: "上周回款",
        }),
        previousFailure(),
      ],
    });

    it("reports a permission change on retry instead of the previous attempt's error", async () => {
      mocks.conversation = "c1";
      // The server refuses the retry before rewriting the row, so every
      // refetch still returns the previous attempt's FAILED row.
      mocks.listMessages.mockResolvedValue(history());
      mocks.retryTurn.mockImplementation(async function* () {
        throw {
          status: 403,
          code: "WORKSPACE_FORBIDDEN",
          message: "无权访问",
          requestId: "req-forbidden",
        };
      });
      const { client } = renderPage();
      await screen.findByText("AI 暂时没有响应，请重试");
      fireEvent.click(screen.getByRole("button", { name: "重试" }));

      expect(
        await screen.findByText("你的访问权限发生变化，请重新提问"),
      ).toBeVisible();
      expect(
        screen.queryByText("AI 暂时没有响应，请重试"),
      ).not.toBeInTheDocument();

      await act(async () => {
        await client.invalidateQueries({ queryKey: ["ai", "northwind", "c1"] });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(
        screen.getByText("你的访问权限发生变化，请重新提问"),
      ).toBeVisible();
      expect(
        screen.queryByText("AI 暂时没有响应，请重试"),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText("上周回款")).toHaveLength(1);
    });

    it("streams the retry and reports its dropped connection over the cached failure", async () => {
      let drop!: () => void;
      const gate = new Promise<void>((resolve) => {
        drop = resolve;
      });
      mocks.conversation = "c1";
      mocks.listMessages.mockResolvedValue(history());
      mocks.retryTurn.mockImplementation(async function* () {
        yield {
          event: "conversation.ready",
          data: { conversationId: "c1", title: "问", turnId: "t-failed" },
        };
        yield { event: "turn.started", data: { turnId: "t-failed" } };
        yield { event: "assistant.delta", data: { text: "本次重试的回答" } };
        await gate;
        throw new TypeError("Failed to fetch");
      });
      renderPage();
      await screen.findByText("AI 暂时没有响应，请重试");
      fireEvent.click(screen.getByRole("button", { name: "重试" }));

      expect(await screen.findByText("本次重试的回答")).toBeVisible();
      expect(
        screen.queryByText("AI 暂时没有响应，请重试"),
      ).not.toBeInTheDocument();

      await act(async () => {
        drop();
      });
      expect(await screen.findByText("连接已中断")).toBeVisible();
      expect(screen.getByText("本次重试的回答")).toBeVisible();
      expect(
        screen.queryByText("AI 暂时没有响应，请重试"),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(1);
    });

    it("shows the server's row once the retry has rewritten it", async () => {
      mocks.conversation = "c1";
      mocks.listMessages.mockResolvedValue(history());
      mocks.retryTurn.mockImplementation(async function* () {
        yield {
          event: "conversation.ready",
          data: { conversationId: "c1", title: "问", turnId: "t-failed" },
        };
        yield {
          event: "turn.failed",
          data: { turnId: "t-failed", code: "AI_PROVIDER_UNAVAILABLE" },
        };
      });
      renderPage();
      await screen.findByText("AI 暂时没有响应，请重试");
      mocks.listMessages.mockResolvedValue({
        items: [
          history().items[0],
          {
            ...previousFailure(),
            errorCode: "AI_PROVIDER_UNAVAILABLE",
            completedAt: "2026-10-06T00:01:00.000Z",
          },
        ],
      });
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(2));
      expect(
        await screen.findByText("AI 服务暂时不可用，请稍后重试"),
      ).toBeVisible();
      expect(screen.getAllByText("AI 服务暂时不可用，请稍后重试")).toHaveLength(
        1,
      );
      expect(
        screen.queryByText("AI 暂时没有响应，请重试"),
      ).not.toBeInTheDocument();
    });

    it("reports a retry stream that closes without finishing", async () => {
      mocks.conversation = "c1";
      mocks.listMessages.mockResolvedValue(history());
      mocks.retryTurn.mockImplementation(async function* () {
        yield {
          event: "conversation.ready",
          data: { conversationId: "c1", title: "问", turnId: "t-failed" },
        };
        yield { event: "turn.started", data: { turnId: "t-failed" } };
        yield { event: "assistant.delta", data: { text: "说到一半" } };
      });
      renderPage();
      await screen.findByText("AI 暂时没有响应，请重试");
      fireEvent.click(screen.getByRole("button", { name: "重试" }));

      expect(await screen.findByText("连接已中断")).toBeVisible();
      expect(screen.getByText("说到一半")).toBeVisible();
      expect(
        screen.queryByText("AI 暂时没有响应，请重试"),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(1);
      expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
    });

    it("reports a retry that fails the same way exactly once", async () => {
      mocks.conversation = "c1";
      mocks.listMessages.mockResolvedValue(history());
      mocks.retryTurn.mockImplementation(async function* () {
        yield {
          event: "conversation.ready",
          data: { conversationId: "c1", title: "问", turnId: "t-failed" },
        };
        yield {
          event: "turn.failed",
          data: { turnId: "t-failed", code: "AI_PROVIDER_TIMEOUT" },
        };
      });
      const { client } = renderPage();
      await screen.findByText("AI 暂时没有响应，请重试");
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      // The refetch after turn.failed still returns the old row: the retry's
      // own failure is shown in its place, not beside it.
      await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(2));
      expect(screen.getAllByText("AI 暂时没有响应，请重试")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(1);

      mocks.listMessages.mockResolvedValue({
        items: [
          history().items[0],
          { ...previousFailure(), completedAt: "2026-10-06T00:01:00.000Z" },
        ],
      });
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["ai", "northwind", "c1"] });
      });
      await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(3));
      expect(screen.getAllByText("AI 暂时没有响应，请重试")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(1);
      expect(screen.getAllByText("上周回款")).toHaveLength(1);
    });
  });
});

it("resumes a persisted question using its server option id without sending label text", async () => {
  mocks.conversation = "c1";
  mocks.listMessages.mockResolvedValue({
    items: [
      {
        id: "m",
        conversationId: "c1",
        turnId: "t",
        role: "ASSISTANT",
        status: "WAITING",
        content: "",
        questions: [
          {
            kind: "choose_record",
            state: "OPEN",
            questionId: "q",
            turnId: "t",
            prompt: "是哪位客户？",
            options: [{ id: "two", label: "远山科技", summary: "苏州" }],
          },
        ],
        toolSummary: [],
        sourceSummary: [],
        createdAt: "2026-11-22T00:00:00Z",
      },
    ],
  });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /远山科技/ }));
  expect(mocks.streamTurn).toHaveBeenCalledWith(
    "northwind",
    {
      conversationId: "c1",
      answer: {
        questionId: "q",
        value: { kind: "choose_record", optionId: "two" },
      },
    },
    expect.any(AbortSignal),
  );
});

it("previews clarification choices without applying a list filter", async () => {
  mocks.conversation = "c1";
  const rule = { version: 1, match: "all", conditions: [] };
  mocks.listMessages.mockResolvedValue({
    items: [
      {
        id: "m",
        conversationId: "c1",
        turnId: "t",
        role: "ASSISTANT",
        status: "COMPLETED",
        content: "",
        action: {
          kind: "filter",
          objectCode: "customers",
          currentRule: rule,
          preview: {
            kind: "clarify",
            options: [{ id: "one", label: "我负责的", value: rule }],
          },
        },
        toolSummary: [],
        sourceSummary: [],
        createdAt: "2026-11-22T00:00:00Z",
      },
    ],
  });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "我负责的" }));
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "在表格中应用" })).toBeEnabled();
});

it("removes both the current record and its prompt shortcuts before the next send", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const panel = {
    conversationId: undefined,
    page: {
      hint: { objectCode: "contracts", recordId: "r1" },
      label: "合同 · 续约协议",
      objectName: "合同",
    },
    select: vi.fn(),
    close: vi.fn(),
  };
  render(
    <QueryClientProvider client={client}>
      <AiAssistantPage
        tenantCode="northwind"
        memberId="sales"
        businessObjects={[]}
        panel={panel}
      />
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole("button", { name: "查看合同概况" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "移除页面关联" }));
  expect(
    screen.queryByRole("button", { name: "查看合同概况" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "我能查看哪些业务表" })).toBeVisible();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "看看记录" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(mocks.streamTurn).toHaveBeenCalledWith(
    "northwind",
    { conversationId: undefined, content: "看看记录" },
    expect.any(AbortSignal),
  );
  await waitFor(() => expect(panel.select).toHaveBeenCalledWith("c1"));
});

it("submits only selected batch items and reviewed edits", async () => {
  mocks.conversation = "c1";
  const item = {
    operation: "ADD_ACTIVITY_NOTE",
    title: "添加纪要",
    changes: [{ label: "纪要", after: "旧内容" }],
    editableFields: [
      { key: "content", label: "纪要内容", type: "TEXT", value: "旧内容" },
    ],
    status: "PROPOSED",
    expiresAt: "2999-01-01T00:00:00Z",
    validationWarnings: [],
  };
  mocks.listMessages.mockResolvedValue({
    items: [
      {
        id: "a",
        conversationId: "c1",
        turnId: "t",
        role: "ASSISTANT",
        status: "COMPLETED",
        content: "",
        toolSummary: [],
        sourceSummary: [],
        createdAt: "2026-11-22",
        batch: {
          items: [
            { ...item, proposalId: "one", targetSummary: "甲客户" },
            { ...item, proposalId: "two", targetSummary: "乙客户" },
          ],
        },
      },
    ],
  });
  mocks.confirmBatch.mockResolvedValue({
    items: [{ proposalId: "one", status: "EXECUTED", message: "已保存" }],
  });
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox", { name: "选择乙客户" }));
  fireEvent.change(screen.getAllByLabelText("纪要内容")[0], {
    target: { value: "已联系采购" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认所选项" }));
  await waitFor(() =>
    expect(mocks.confirmBatch).toHaveBeenCalledWith("northwind", "t", {
      items: [
        {
          proposalId: "one",
          idempotencyKey: expect.any(String),
          edits: { content: "已联系采购" },
        },
      ],
    }),
  );
  expect(await screen.findByText("已保存")).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "选择乙客户" }),
  ).not.toBeChecked();
});

it("rejects stale filter previews when a different view is now open", async () => {
  const apply = vi.fn(),
    rule = { version: 1 as const, match: "all" as const, conditions: [] };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const panel = {
    conversationId: "c2",
    page: {
      hint: { objectCode: "customers", viewId: "new-view" },
      label: "我的客户",
      filterDraft: rule,
      applyFilter: apply,
    },
    select: vi.fn(),
    close: vi.fn(),
  };
  mocks.listMessages.mockResolvedValue({
    items: [
      {
        id: "a",
        conversationId: "c2",
        turnId: "t",
        role: "ASSISTANT",
        status: "COMPLETED",
        content: "",
        action: {
          kind: "filter",
          objectCode: "customers",
          baseViewId: "old-view",
          currentRule: rule,
          preview: { kind: "rule", rule },
        },
        toolSummary: [],
        sourceSummary: [],
        createdAt: "2026-11-22",
      },
    ],
  });
  render(
    <QueryClientProvider client={client}>
      <AiAssistantPage
        tenantCode="northwind"
        memberId="sales"
        businessObjects={[]}
        panel={panel}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "在表格中应用" }));
  expect(screen.getByText(/页面或筛选条件已变化/)).toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
});

it("keeps the filled question available after a rejected answer", async () => {
  mocks.conversation = "c-error";
  const historyRow = {
    id: "q-row",
    conversationId: "c-error",
    turnId: "turn",
    role: "ASSISTANT",
    status: "WAITING",
    content: "",
    toolSummary: [],
    sourceSummary: [],
    createdAt: "2026-11-22",
    questions: [
      {
        kind: "fill_fields",
        questionId: "question",
        turnId: "turn",
        state: "OPEN",
        prompt: "补充字段",
        fields: [{ key: "name", label: "客户名称", type: "TEXT" }],
      },
    ],
  };
  mocks.listMessages
    .mockResolvedValueOnce({ items: [{ ...historyRow, id: "stream-turn" }] })
    .mockResolvedValue({ items: [historyRow] });
  mocks.streamTurn.mockImplementation(async function* () {
    throw {
      code: "VALIDATION_FAILED",
      message: "invalid",
      fieldErrors: { name: ["字段值格式不正确。"], secret: ["隐藏错误"] },
      requestId: "request",
      status: 400,
    };
  });
  renderPage();
  fireEvent.change(await screen.findByRole("textbox", { name: "客户名称" }), {
    target: { value: "保留的填写内容" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交填写内容" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("region", { name: "助手追问" })).getByRole(
        "alert",
      ),
    ).toHaveTextContent("客户名称：字段值格式不正确。"),
  );
  expect(
    screen.getByRole("textbox", { name: "客户名称" }),
  ).toHaveAccessibleDescription("客户名称：字段值格式不正确。");
  expect(screen.queryByText(/隐藏错误/)).toBeNull();
  expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue(
    "保留的填写内容",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
    target: { value: "已修正" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交填写内容" }));
  await waitFor(() =>
    expect(mocks.streamTurn).toHaveBeenLastCalledWith(
      "northwind",
      {
        conversationId: "c-error",
        answer: {
          questionId: "question",
          value: { kind: "fill_fields", values: { name: "已修正" } },
        },
      },
      expect.any(AbortSignal),
    ),
  );
});

it("renders a saved follow-up deadline in company time in batch history", async () => {
  mocks.conversation = "c-time";
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { followUpQueryKeys } =
    await import("@/features/follow-ups/follow-up-api");
  client.setQueryData(followUpQueryKeys.workbench("northwind"), {
    timezone: "Asia/Shanghai",
  });
  mocks.listMessages.mockResolvedValue({
    items: [
      {
        id: "a",
        turnId: "t",
        conversationId: "c-time",
        role: "ASSISTANT",
        status: "COMPLETED",
        content: "",
        toolSummary: [],
        sourceSummary: [],
        createdAt: "2026-11-22",
        batch: {
          items: [
            {
              operation: "CREATE_FOLLOW_UP",
              proposalId: "p",
              title: "创建跟进",
              status: "EXECUTED",
              targetSummary: "采购客户",
              expiresAt: "2026-12-01",
              validationWarnings: [],
              changes: [
                { label: "到期时间", after: "2026-11-23T01:00:00.000Z" },
              ],
            },
          ],
        },
      },
    ],
  });
  renderPage(client);
  expect(await screen.findByText(/11月23日.*09:00/)).toBeVisible();
  expect(
    screen.queryByText("2026-11-23T01:00:00.000Z"),
  ).not.toBeInTheDocument();
});

it("uses published select labels in a change preview", async () => {
  mocks.conversation = "c-choice";
  mocks.listMessages.mockResolvedValue({
    items: [
      {
        id: "a",
        turnId: "t",
        conversationId: "c-choice",
        role: "ASSISTANT",
        status: "COMPLETED",
        content: "",
        toolSummary: [],
        sourceSummary: [],
        createdAt: "2026-11-22",
        batch: {
          items: [
            {
              operation: "UPDATE_RECORD",
              proposalId: "p",
              title: "更新阶段",
              status: "PROPOSED",
              targetSummary: "客户",
              expiresAt: "2999-12-01",
              validationWarnings: [],
              changes: [
                { label: "阶段", before: "discovery", after: "negotiation" },
              ],
              editableFields: [
                {
                  key: "stage",
                  label: "阶段",
                  type: "SINGLE_SELECT",
                  value: "negotiation",
                  options: [
                    { id: "discovery", label: "初次接触" },
                    { id: "negotiation", label: "谈判" },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  });
  renderPage();
  // The editable stage shows once, in its control, with the old label beneath.
  expect(await screen.findByText("原为 初次接触")).toBeInTheDocument();
  expect(screen.queryByText("初次接触 → 谈判")).not.toBeInTheDocument();
  expect(screen.queryByText(/discovery|negotiation/)).not.toBeInTheDocument();
});

describe("settled proposal batches", () => {
  const batchItem = {
    operation: "UPDATE_RECORD",
    proposalId: "p-old",
    title: "更新阶段",
    targetSummary: "华东仓储系统升级",
    validationWarnings: [],
    changes: [{ label: "阶段", before: "方案报价", after: "商务谈判" }],
  };
  function history(item: Record<string, unknown>) {
    return {
      items: [
        {
          id: "u-old",
          conversationId: "c-settled",
          turnId: "t-old",
          role: "USER",
          status: "COMPLETED",
          content: "把阶段改成商务谈判",
          toolSummary: [],
          sourceSummary: [],
          createdAt: "2026-11-25T00:00:00.000Z",
        },
        {
          id: "a-old",
          conversationId: "c-settled",
          turnId: "t-old",
          role: "ASSISTANT",
          status: "COMPLETED",
          content: "已生成一项变更建议，待你确认后才会生效：",
          toolSummary: [],
          sourceSummary: [],
          createdAt: "2026-11-25T00:00:01.000Z",
          batch: { items: [{ ...batchItem, ...item }] },
        },
      ],
    };
  }

  it("heads an expired batch as not written and offers to ask again", async () => {
    mocks.conversation = "c-settled";
    mocks.listMessages.mockResolvedValue(
      history({ status: "PROPOSED", expiresAt: "2000-01-01T00:00:00.000Z" }),
    );
    renderPage();
    expect(await screen.findByText("建议已过期，没有写入")).toBeInTheDocument();
    expect(screen.getByText("AI 提议")).toBeInTheDocument();
    // Nothing to choose on a settled card: its title is text, not a checkbox.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "按最新数据重新提议" }));
    await waitFor(() => expect(mocks.streamTurn).toHaveBeenCalled());
    expect(mocks.streamTurn.mock.calls.at(-1)?.[1]).toMatchObject({
      conversationId: "c-settled",
      content: "把阶段改成商务谈判",
    });
  });

  it("heads an executed batch with what was written", async () => {
    mocks.conversation = "c-settled";
    mocks.listMessages.mockResolvedValue(
      history({ status: "EXECUTED", expiresAt: "2999-01-01T00:00:00.000Z" }),
    );
    renderPage();
    expect(await screen.findByText("已执行 1 项")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "按最新数据重新提议" }),
    ).not.toBeInTheDocument();
  });
});
