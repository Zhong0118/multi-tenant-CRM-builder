import { afterEach, describe, expect, it, vi } from "vitest";

import { aiApi } from "./ai-api";
import { AiStreamError } from "./ai-stream-parser";

const mocks = vi.hoisted(() => ({
  GET: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
}));

vi.mock("@/lib/api/browser-client", () => ({
  browserApiClient: {
    GET: mocks.GET,
    PATCH: mocks.PATCH,
    DELETE: mocks.DELETE,
  },
}));

vi.mock("@/lib/api/api-origin", () => ({
  browserApiOrigin: () => "http://localhost:3001",
}));

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.GET.mockReset();
  mocks.PATCH.mockReset();
  mocks.DELETE.mockReset();
});

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

describe("aiApi", () => {
  it("lists conversations through the generated client", async () => {
    mocks.GET.mockResolvedValue({
      data: { items: [{ id: "c1", title: "问", lastMessageAt: "2026-09-21T00:00:00.000Z" }] },
      response: new Response(null, { status: 200 }),
    });
    await expect(aiApi.listConversations("northwind")).resolves.toEqual({
      items: [{ id: "c1", title: "问", lastMessageAt: "2026-09-21T00:00:00.000Z" }],
    });
    expect(mocks.GET).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/ai/conversations",
      { params: { path: { tenantCode: "northwind" }, query: {} } },
    );
  });

  it("streams public SSE events and rejects unknown provider events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: conversation.ready\ndata: {"conversationId":"c1","title":"问","turnId":"t1"}\n\n',
        'event: text-delta\ndata: {"text":"x"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    await expect(async () => {
      for await (const event of aiApi.streamTurn(
        "northwind",
        { content: "帮我看看" },
        new AbortController().signal,
      )) {
        events.push(event);
      }
    }).rejects.toBeInstanceOf(AiStreamError);
    expect(events).toEqual([
      {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t1" },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/workspaces/northwind/ai/turns",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });
});
