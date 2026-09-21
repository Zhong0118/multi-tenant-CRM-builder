"use client";

import { Button, Drawer, Tag } from "antd";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const [railOpen, setRailOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);

  const conversations = useInfiniteQuery({
    queryKey: aiQueryKeys.conversations(tenantCode),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => aiApi.listConversations(tenantCode, pageParam),
    getNextPageParam: (last) => last.nextCursor,
  });
  const messages = useQuery({
    queryKey: aiQueryKeys.messages(tenantCode, conversationId ?? ""),
    queryFn: () => aiApi.listMessages(tenantCode, conversationId!),
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (conversationId) dispatch({ type: "hydrate", conversationId });
    else dispatch({ type: "reset" });
  }, [conversationId]);

  useEffect(() => {
    if (state.conversationId && state.conversationId !== conversationId) {
      const next = new URLSearchParams(searchParams.toString());
      next.set("conversation", state.conversationId);
      router.replace(`${pathname}?${next.toString()}`);
    }
  }, [conversationId, pathname, router, searchParams, state.conversationId]);

  const history = useMemo(
    () => (messages.data?.items ?? []) as AiMessage[],
    [messages.data],
  );
  const live = toAssistantMessage(state);
  const shown = live
    ? [
        ...history.filter((item) => item.turnId !== live.turnId || item.role === "USER"),
        live,
      ]
    : history;

  async function consume(
    iterable: AsyncIterable<import("./ai-types").AiPublicStreamEvent>,
  ) {
    try {
      for await (const event of iterable) {
        dispatch({ type: "event", event });
      }
    } catch (error) {
      if (abortRef.current?.signal.aborted) {
        dispatch({ type: "cancel" });
        return;
      }
      const apiError = toApiError(error);
      dispatch({
        type: "event",
        event: {
          event: "turn.failed",
          data: {
            turnId: state.turnId ?? "unknown",
            code: apiError.code,
            messageId: "unknown",
          },
        },
      });
    }
  }

  function send(content = state.draft) {
    const text = content.trim();
    if (!text) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    dispatch({ type: "draft", value: text });
    dispatch({ type: "send" });
    void consume(
      aiApi.streamTurn(
        tenantCode,
        { conversationId, content: text },
        abort.signal,
      ),
    );
  }

  function stop() {
    abortRef.current?.abort();
    dispatch({ type: "cancel" });
  }

  function retry() {
    if (!state.turnId) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    dispatch({ type: "send" });
    void consume(aiApi.retryTurn(tenantCode, state.turnId, abort.signal));
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
        router.replace(pathname);
        setRailOpen(false);
      }}
      onSelect={(id) => {
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
          <div>
            <h1>
              AI 助手 <Tag>只读</Tag>
            </h1>
            <p>基于你当前权限，帮助你查询和总结 CRM 数据</p>
            <p>只读取你当前可访问的数据 · 不会修改业务数据</p>
          </div>
          <Button
            className={styles.mobileRailButton}
            onClick={() => setRailOpen(true)}
          >
            会话
          </Button>
        </header>
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
              messages.data?.nextBefore
                ? () =>
                    void client.fetchQuery({
                      queryKey: [
                        ...aiQueryKeys.messages(tenantCode, conversationId ?? ""),
                        messages.data.nextBefore,
                      ],
                      queryFn: () =>
                        aiApi.listMessages(
                          tenantCode,
                          conversationId!,
                          messages.data?.nextBefore,
                        ),
                    })
                : undefined
            }
          />
        )}
        {state.errorMessage ? (
          <AiErrorState
            message={
              state.phase === "PARTIAL_COMPLETED"
                ? state.errorMessage
                : state.errorMessage || userErrorMessage(state.errorCode)
            }
            onRetry={
              state.phase === "FAILED" || state.phase === "CANCELLED"
                ? retry
                : undefined
            }
          />
        ) : null}
        <div ref={composerRef}>
          <AiComposer
            value={state.draft}
            phase={state.phase}
            onChange={(value) => dispatch({ type: "draft", value })}
            onSend={() => send()}
            onStop={stop}
          />
        </div>
      </section>
    </div>
  );
}
