"use client";

import { Button, Drawer, Tag } from "antd";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import { aiApi, aiQueryKeys } from "./ai-api";
import styles from "./ai-assistant.module.css";
import { AiComposer } from "./ai-composer";
import { AiEmptyState } from "./ai-empty-state";
import { AiErrorState } from "./ai-error-state";
import { AiMessageList } from "./ai-message-list";
import {
  aiTurnReducer,
  initialAiTurnState,
  toAssistantMessage,
  userErrorMessage,
} from "./ai-turn-reducer";
import { ConversationRail } from "./conversation-rail";
import type { AiMessage } from "./ai-types";

export function AiAssistantPage({
  tenantCode,
  businessObjects,
}: {
  tenantCode: string;
  businessObjects: RuntimeObjectNavigation[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("conversation") ?? undefined;
  const client = useQueryClient();
  const [state, dispatch] = useReducer(aiTurnReducer, initialAiTurnState);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [railOpen, setRailOpen] = useState(false);
  const composerRef = useRef<import("antd/es/input/TextArea").TextAreaRef>(null);

  const conversations = useInfiniteQuery({
    queryKey: aiQueryKeys.conversations(tenantCode),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => aiApi.listConversations(tenantCode, pageParam),
    getNextPageParam: (last) => last.nextCursor,
  });
  const messages = useInfiniteQuery({
    queryKey: aiQueryKeys.messages(tenantCode, conversationId ?? ""),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      aiApi.listMessages(tenantCode, conversationId!, pageParam),
    getNextPageParam: (last) => last.nextBefore,
    enabled: !!conversationId,
  });

  function abandonActiveTurn() {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }

  useEffect(() => {
    const live = stateRef.current;
    if (conversationId === live.conversationId) return;
    const generating = live.phase === "SENDING" || live.phase === "STREAMING";
    if (generating) abandonActiveTurn();
    if (conversationId) dispatch({ type: "hydrate", conversationId });
    else dispatch({ type: "reset" });
  }, [conversationId]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const history = useMemo(() => {
    const pages = messages.data?.pages ?? [];
    return [...pages].reverse().flatMap((page) => page.items) as AiMessage[];
  }, [messages.data]);
  const live = toAssistantMessage(state);
  const pendingUser: AiMessage | null =
    state.pendingUserContent && state.conversationId
      ? {
          id: `pending-${state.turnId ?? "new"}`,
          conversationId: state.conversationId,
          turnId: state.turnId ?? "pending",
          role: "USER",
          status: "COMPLETED",
          content: state.pendingUserContent,
          toolSummary: [],
          sourceSummary: [],
          createdAt: new Date().toISOString(),
        }
      : state.pendingUserContent
        ? {
            id: "pending-new",
            conversationId: "pending",
            turnId: "pending",
            role: "USER",
            status: "COMPLETED",
            content: state.pendingUserContent,
            toolSummary: [],
            sourceSummary: [],
            createdAt: new Date().toISOString(),
          }
        : null;
  const shown = [
    ...history.filter((item) => {
      if (live && item.turnId === live.turnId && item.role !== "USER") return false;
      if (
        pendingUser &&
        state.turnId &&
        item.role === "USER" &&
        item.turnId === state.turnId
      ) {
        return false;
      }
      return true;
    }),
    ...(pendingUser ? [pendingUser] : []),
    ...(live ? [live] : []),
  ];

  async function consume(
    iterable: AsyncIterable<import("./ai-types").AiPublicStreamEvent>,
    controller: AbortController,
    generation: number,
  ) {
    const stillCurrent = () => generation === generationRef.current;
    let liveConversationId = conversationId;
    try {
      for await (const event of iterable) {
        if (!stillCurrent()) return;
        dispatch({ type: "event", event });
        if (event.event === "conversation.ready") {
          liveConversationId = event.data.conversationId;
          router.replace(
            `${pathname}?conversation=${encodeURIComponent(event.data.conversationId)}`,
          );
          void client.invalidateQueries({
            queryKey: aiQueryKeys.conversations(tenantCode),
          });
        }
        if (
          event.event === "turn.completed" ||
          event.event === "turn.failed" ||
          event.event === "turn.cancelled"
        ) {
          if (liveConversationId) {
            void client.invalidateQueries({
              queryKey: aiQueryKeys.messages(tenantCode, liveConversationId),
            });
          }
          void client.invalidateQueries({
            queryKey: aiQueryKeys.conversations(tenantCode),
          });
        }
      }
    } catch (error) {
      if (!stillCurrent()) return;
      if (controller.signal.aborted) {
        dispatch({ type: "cancel" });
        return;
      }
      const apiError = toApiError(error);
      const code =
        apiError.code === "AI_STREAM_INVALID" ||
        apiError.code === "INTERNAL_ERROR"
          ? "NETWORK"
          : apiError.code;
      dispatch({ type: "transportFailure", code });
    }
  }

  function startTurn(
    factory: (signal: AbortSignal) => AsyncIterable<import("./ai-types").AiPublicStreamEvent>,
  ) {
    abortRef.current?.abort();
    generationRef.current += 1;
    const generation = generationRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    void consume(factory(abort.signal), abort, generation);
    queueMicrotask(() => composerRef.current?.focus?.());
  }

  function send(content = state.draft) {
    const text = content.trim();
    if (!text) return;
    dispatch({ type: "beginNewTurn", content: text });
    startTurn((signal) =>
      aiApi.streamTurn(tenantCode, { conversationId, content: text }, signal),
    );
  }

  function stop() {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "cancel" });
  }

  function retry(turnId = state.turnId) {
    if (!turnId) return;
    dispatch({ type: "beginRetryTurn", turnId });
    startTurn((signal) => aiApi.retryTurn(tenantCode, turnId, signal));
  }

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      aiApi.rename(tenantCode, id, title),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: aiQueryKeys.conversations(tenantCode) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => aiApi.remove(tenantCode, id),
    onSuccess: (_void, id) => {
      client.invalidateQueries({ queryKey: aiQueryKeys.conversations(tenantCode) });
      if (id === conversationId) {
        router.replace(pathname);
      }
    },
  });

  const rail = (
    <ConversationRail
      conversations={conversations.data?.pages.flatMap((page) => page.items) ?? []}
      selectedId={conversationId}
      loading={conversations.isLoading}
      onNew={() => {
        abandonActiveTurn();
        router.replace(pathname);
        setRailOpen(false);
      }}
      onSelect={(id) => {
        if (id !== (conversationId ?? state.conversationId)) abandonActiveTurn();
        router.replace(`${pathname}?conversation=${encodeURIComponent(id)}`);
        setRailOpen(false);
      }}
      onRename={(id, title) => rename.mutate({ id, title })}
      onDelete={(id) => remove.mutate(id)}
      onLoadMore={
        conversations.hasNextPage
          ? () => void conversations.fetchNextPage()
          : undefined
      }
    />
  );

  return (
    <div className={styles.page}>
      <div className={styles.rail}>{rail}</div>
      <Drawer
        title="会话"
        open={railOpen}
        onClose={() => setRailOpen(false)}
        size={280}
      >
        {rail}
      </Drawer>
      <section className={styles.chat}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <h1 className={styles.headerTitle}>
              AI 助手 <Tag>只读</Tag>
            </h1>
            <p className={styles.headerHint}>基于你当前 CRM 权限回答</p>
          </div>
          <Button
            className={styles.mobileRailButton}
            aria-label="会话"
            onClick={() => setRailOpen(true)}
          >
            会话
          </Button>
        </header>
        <div className={styles.canvas} data-testid="ai-conversation-canvas">
          {shown.length === 0 && state.phase === "IDLE" ? (
            <AiEmptyState
              objects={businessObjects}
              onPrompt={(text) => {
                dispatch({ type: "draft", value: text });
                send(text);
              }}
            />
          ) : (
            <AiMessageList
              tenantCode={tenantCode}
              messages={shown}
              loading={messages.isLoading}
              streaming={state.phase === "STREAMING"}
              phase={state.phase}
              onLoadOlder={
                messages.hasNextPage
                  ? () => messages.fetchNextPage()
                  : undefined
              }
              onRetry={
                state.phase === "SENDING" || state.phase === "STREAMING"
                  ? undefined
                  : retry
              }
            />
          )}
          {state.errorMessage && !live ? (
            <AiErrorState
              message={
                state.phase === "PARTIAL_COMPLETED"
                  ? state.errorMessage
                  : state.errorMessage || userErrorMessage(state.errorCode)
              }
              onRetry={
                (state.phase === "FAILED" || state.phase === "CANCELLED") &&
                state.turnId
                  ? () => retry()
                  : undefined
              }
            />
          ) : null}
          <AiComposer
            value={state.draft}
            phase={state.phase}
            inputRef={composerRef}
            onChange={(value) => dispatch({ type: "draft", value })}
            onSend={() => send()}
            onStop={stop}
          />
        </div>
      </section>
    </div>
  );
}
