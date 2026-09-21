"use client";

import { browserApiOrigin } from "@/lib/api/api-origin";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import { dataOrThrow } from "@/features/objects/object-api";

import { AiStreamError, AiStreamParser } from "./ai-stream-parser";
import type {
  AiConversation,
  AiConversationPage,
  AiMessage,
  AiMessagePage,
  AiPublicStreamEvent,
  AiSourceSummary,
  AiStreamTurnInput,
  AiToolSummary,
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
        params: {
          path: { tenantCode },
          ...(cursor ? { query: { cursor } } : {}),
        },
      }),
    );
  },

  async listMessages(
    tenantCode: string,
    conversationId: string,
    before?: string,
  ): Promise<AiMessagePage> {
    const page = await dataOrThrow(
      await browserApiClient.GET(MESSAGES, {
        params: {
          path: { tenantCode, id: conversationId },
          query: before ? { before } : {},
        },
      }),
    );
    return {
      nextBefore: page.nextBefore,
      items: page.items.map(presentMessage),
    };
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

function presentMessage(item: {
  id: string;
  conversationId: string;
  turnId: string;
  role: string;
  status: string;
  content: string;
  toolSummary: unknown[];
  sourceSummary: unknown[];
  errorCode?: string | null;
  createdAt: string;
  completedAt?: string | null;
}): AiMessage {
  return {
    ...item,
    toolSummary: item.toolSummary.filter(isToolSummary),
    sourceSummary: item.sourceSummary.filter(isSourceSummary),
  };
}

function isToolSummary(value: unknown): value is AiToolSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.callId === "string" &&
    typeof record.toolName === "string" &&
    typeof record.displayName === "string" &&
    (record.status === "RUNNING" ||
      record.status === "COMPLETED" ||
      record.status === "FAILED")
  );
}

function isSourceSummary(value: unknown): value is AiSourceSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "RECORDS" ||
      record.kind === "AGGREGATE" ||
      record.kind === "TIMELINE") &&
    typeof record.objectCode === "string" &&
    typeof record.objectName === "string"
  );
}

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
