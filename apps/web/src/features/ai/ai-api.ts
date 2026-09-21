"use client";

import { browserApiOrigin } from "@/lib/api/api-origin";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import { dataOrThrow } from "@/features/objects/object-api";

import { AiStreamError, AiStreamParser } from "./ai-stream-parser";
import type {
  AiConversation,
  AiConversationPage,
  AiMessagePage,
  AiPublicStreamEvent,
  AiStreamTurnInput,
} from "./ai-types";

const CONVERSATIONS = "/api/v1/workspaces/{tenantCode}/ai/conversations";
const CONVERSATION = `${CONVERSATIONS}/{id}` as const;
const MESSAGES = `${CONVERSATION}/messages` as const;

export const aiQueryKeys = {
  conversations: (tenantCode: string) =>
    ["workspace", tenantCode, "ai", "conversations"] as const,
  messages: (tenantCode: string, conversationId: string) =>
    ["workspace", tenantCode, "ai", "messages", conversationId] as const,
};

export const aiApi = {
  async listConversations(
    tenantCode: string,
    cursor?: string,
  ): Promise<AiConversationPage> {
    return dataOrThrow(
      await browserApiClient.GET(CONVERSATIONS, {
        params: { path: { tenantCode }, query: cursor ? { cursor } : {} },
      }),
    );
  },

  async listMessages(
    tenantCode: string,
    conversationId: string,
    before?: string,
  ): Promise<AiMessagePage> {
    return dataOrThrow(
      await browserApiClient.GET(MESSAGES, {
        params: {
          path: { tenantCode, id: conversationId },
          query: before ? { before } : {},
        },
      }),
    );
  },

  async rename(
    tenantCode: string,
    conversationId: string,
    title: string,
  ): Promise<AiConversation> {
    return dataOrThrow(
      await browserApiClient.PATCH(CONVERSATION, {
        params: { path: { tenantCode, id: conversationId } },
        body: { title },
      }),
    );
  },

  async remove(tenantCode: string, conversationId: string): Promise<void> {
    const result = await browserApiClient.DELETE(CONVERSATION, {
      params: { path: { tenantCode, id: conversationId } },
    });
    if (result.response.ok) return;
    throw toApiError(result.error, result.response.status);
  },

  streamTurn(
    tenantCode: string,
    input: AiStreamTurnInput,
    signal: AbortSignal,
  ): AsyncIterable<AiPublicStreamEvent> {
    return readSse(
      `${browserApiOrigin()}/api/v1/workspaces/${encodeURIComponent(tenantCode)}/ai/turns`,
      { method: "POST", body: JSON.stringify(input), signal },
    );
  },

  retryTurn(
    tenantCode: string,
    turnId: string,
    signal: AbortSignal,
  ): AsyncIterable<AiPublicStreamEvent> {
    return readSse(
      `${browserApiOrigin()}/api/v1/workspaces/${encodeURIComponent(tenantCode)}/ai/turns/${encodeURIComponent(turnId)}/retry`,
      { method: "POST", signal },
    );
  },
};

async function* readSse(
  url: string,
  init: { method: string; body?: string; signal: AbortSignal },
): AsyncIterable<AiPublicStreamEvent> {
  const response = await fetch(url, {
    method: init.method,
    credentials: "include",
    headers: {
      Accept: "text/event-stream",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body,
    signal: init.signal,
  });
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw toApiError(body, response.status);
  }
  if (!response.body) throw new AiStreamError();
  const parser = new AiStreamParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      yield* parser.flush();
      return;
    }
    yield* parser.push(decoder.decode(value, { stream: true }));
  }
}
