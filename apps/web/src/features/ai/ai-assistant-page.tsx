"use client";

import { useAiFeature, useQuotaExhausted } from "@/features/ai-governance/access";
import {
  CloseOutlined,
  ExpandOutlined,
  LinkOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Tag } from "antd";
import {
  hashKey,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import type {
  AssistantCommands,
  AssistantPageContext,
} from "./assistant-commands";
import { AssistantCommandContext } from "./assistant-commands";
import {
  sessionKey,
  useAssistantSession,
  writeAssistantSession,
} from "./assistant-session";
import panelStyles from "./assistant-panel.module.css";
import { aiApi, aiQueryKeys } from "./ai-api";
import styles from "./ai-assistant.module.css";
import { assistantHistory, rowFingerprint } from "./assistant-history";
import { useAssistantProposals } from "./use-assistant-proposals";
import { AiComposer } from "./ai-composer";
import { AiEmptyState } from "./ai-empty-state";
import { AiErrorState } from "./ai-error-state";
import { AiMessageList } from "./ai-message-list";
import {
  aiTurnReducer,
  initialAiTurnState,
  userErrorMessage,
} from "./ai-turn-reducer";
import { ConversationRail } from "./conversation-rail";
import type { AiMessage } from "./ai-types";

export function AiAssistantPage({
  tenantCode,
  businessObjects,
  memberId,
  panel,
}: {
  tenantCode: string;
  businessObjects: RuntimeObjectNavigation[];
  memberId?: string;
  panel?: {
    page: AssistantPageContext;
    conversationId?: string;
    select: (id?: string) => void;
    close: () => void;
  };
}) {
  const router = useRouter();
  const assistantAllowed = useAiFeature("assistant");
  const quotaExhausted = useQuotaExhausted();
  const canSend = assistantAllowed && !quotaExhausted;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const conversationId = panel
    ? panel.conversationId
    : (searchParams.get("conversation") ?? undefined);
  const key = (part: string) => sessionKey(tenantCode, memberId ?? "", part);
  const bindingKey = key(`detached:${conversationId ?? "new"}`);
  const detached = useAssistantSession(bindingKey) === "1";
  const transferred = useAssistantSession(
    key(`page:${conversationId ?? "new"}`),
  );
  const page =
    panel?.page ??
    (searchParams.get("fromPage") === "1" && transferred
      ? (JSON.parse(transferred) as AssistantPageContext)
      : undefined);
  const bound = detached ? undefined : page;
  const selectConversation = (id?: string) => {
    if (memberId && !panel) writeAssistantSession(key("active"), id);
    if (panel) panel.select(id);
    else
      router.replace(
        id
          ? `${pathname}?conversation=${encodeURIComponent(id)}${page ? "&fromPage=1" : ""}`
          : pathname,
      );
  };
  const [cardError, setCardError] = useState("");
  const [cardBusy, setCardBusy] = useState(false);
  const mutationLock = useRef(false);
  const client = useQueryClient();
  const [state, dispatch] = useReducer(aiTurnReducer, initialAiTurnState);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  const [railOpen, setRailOpen] = useState(false);
  const {proposalUpdates, proposalError, confirmProposal, rejectProposal} = useAssistantProposals(tenantCode, conversationId);
  // The persisted row of the attempt being retried. The server rewrites that
  // row (same turnId) once the retry starts, so until it changes it describes
  // the old attempt and must not hide this attempt's stream or failure.
  const [retriedRow, setRetriedRow] = useState<{
    turnId: string;
    fingerprint: string;
  } | null>(null);
  const composerRef =
    useRef<import("antd/es/input/TextArea").TextAreaRef>(null);

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
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const live = stateRef.current;
    if (conversationId === live.conversationId) return;
    const generating = live.phase === "SENDING" || live.phase === "STREAMING";
    if (generating) abandonActiveTurn();
    setRetriedRow(null);
    setCardError("");
    setCardBusy(false);
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

  const fullHistory = useMemo(() => {
    const pages = messages.data?.pages ?? [];
    return [...pages].reverse().flatMap((page) => page.items) as AiMessage[];
  }, [messages.data]);
  const shown = assistantHistory(fullHistory, retriedRow, state, proposalUpdates);

  async function consume(
    iterable: AsyncIterable<import("./ai-types").AiPublicStreamEvent>,
    controller: AbortController,
    generation: number,
    onResume?: () => void,
  ) {
    let received = false;
    const stillCurrent = () => generation === generationRef.current;
    let liveConversationId = conversationId;
    try {
      for await (const event of iterable) {
        if (!stillCurrent()) return;
        if (!received && onResume) {
          onResume();
          setCardBusy(false);
        }
        received = true;
        dispatch({ type: "event", event });
        if (event.event === "conversation.ready") {
          liveConversationId = event.data.conversationId;
          if (!conversationId && memberId) {
            if (detached)
              writeAssistantSession(key(`detached:${liveConversationId}`), "1");
            writeAssistantSession(key("detached:new"));
            if (!panel && page)
              writeAssistantSession(
                key(`page:${liveConversationId}`),
                JSON.stringify(page),
              );
          }
          selectConversation(liveConversationId);
          void client.invalidateQueries({
            queryKey: aiQueryKeys.conversations(tenantCode),
          });
        }
        if (
          event.event === "question.ready" ||
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
      // A stream that closes without a terminal event was cut off; the
      // reducer ignores this once the turn has already finished.
      if (onResume && !received) throw new Error("stream closed");
      if (stillCurrent()) dispatch({ type: "network" });
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
      if (onResume && !received) {
        setCardBusy(false);
        void refreshHistory();
        if (code === "VALIDATION_FAILED") return apiError.fieldErrors;
        setCardError(
          code === "AI_TURN_NOT_RETRYABLE"
            ? "问题已变化，请核对当前会话"
            : "暂时无法提交回答，填写内容已保留",
        );
      } else dispatch({ type: "transportFailure", code, message: apiError.message });
    } finally {
      if (stillCurrent()) {
        abortRef.current = null;
        void client.invalidateQueries({queryKey:["ai-capabilities",tenantCode]});
      }
    }
  }

  function startTurn(
    factory: (
      signal: AbortSignal,
    ) => AsyncIterable<import("./ai-types").AiPublicStreamEvent>,
    onResume?: () => void,
  ) {
    abortRef.current?.abort();
    generationRef.current += 1;
    const generation = generationRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    const result = consume(factory(abort.signal), abort, generation, onResume);
    if (!onResume) queueMicrotask(() => composerRef.current?.focus?.());
    return result;
  }

  function send(content = state.draft) {
    const text = content.trim();
    if (!canSend || !text || requestBusy()) return;
    setRetriedRow(null);
    dispatch({ type: "beginNewTurn", content: text });
    startTurn((signal) =>
      aiApi.streamTurn(
        tenantCode,
        {
          conversationId,
          content: text,
          ...(bound && {
            context: bound.hint,
            ...(bound.filterDraft &&
              !bound.hint.recordId && { filterDraft: bound.filterDraft }),
          }),
        },
        signal,
      ),
    );
  }

  function stop() {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "cancel" });
    const stopped = state.conversationId ?? conversationId;
    if (stopped) {
      void client.invalidateQueries({
        queryKey: aiQueryKeys.messages(tenantCode, stopped),
      });
    }
  }

  function requestBusy() {
    return (
      stateRef.current.phase === "SENDING" ||
      stateRef.current.phase === "STREAMING" ||
      (abortRef.current !== null && !abortRef.current.signal.aborted) ||
      mutationLock.current ||
      confirmProposal.isPending ||
      rejectProposal.isPending
    );
  }

  function retry(turnId = state.turnId) {
    if (!turnId || requestBusy()) return;
    const row = shown.find(
      (item) => item.role === "ASSISTANT" && item.turnId === turnId,
    );
    if (
      row?.proposal ||
      row?.batch ||
      row?.questions?.some((question) => question.state === "OPEN") ||
      row?.action ||
      (row &&
        !(
          row.status === "FAILED" ||
          row.status === "CANCELLED" ||
          row.status === "PARTIAL_COMPLETED" ||
          (row.status === "COMPLETED" &&
            row.toolSummary.some((tool) => tool.status === "FAILED"))
        ))
    )
      return;
    const previous = fullHistory.find(
      (item) => item.role === "ASSISTANT" && item.turnId === turnId,
    );
    setRetriedRow(
      previous ? { turnId, fingerprint: rowFingerprint(previous) } : null,
    );
    dispatch({ type: "beginRetryTurn", turnId });
    startTurn((signal) => aiApi.retryTurn(tenantCode, turnId, signal));
  }

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      aiApi.rename(tenantCode, id, title),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: aiQueryKeys.conversations(tenantCode),
      }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => aiApi.remove(tenantCode, id),
    onSuccess: (_void, id) => {
      client.invalidateQueries({
        queryKey: aiQueryKeys.conversations(tenantCode),
      });
      if (id === conversationId) {
        selectConversation();
      }
    },
  });

  const renderRail = (hideBrand = false) => (
    <ConversationRail
      hideBrand={hideBrand}
      conversations={
        conversations.data?.pages.flatMap((page) => page.items) ?? []
      }
      selectedId={conversationId}
      loading={conversations.isLoading}
      error={conversations.isError}
      onRetry={() => void conversations.refetch()}
      onNew={() => {
        abandonActiveTurn();
        selectConversation();
        setRailOpen(false);
      }}
      onSelect={(id) => {
        if (id !== (conversationId ?? state.conversationId))
          abandonActiveTurn();
        selectConversation(id);
        setRailOpen(false);
      }}
      onRename={(id, title) => rename.mutateAsync({ id, title })}
      onDelete={(id) => remove.mutateAsync(id)}
      renamePending={rename.isPending}
      deletePending={remove.isPending}
      // Rename failures are reported inside the rename dialog.
      mutationError={
        remove.error instanceof Error ? remove.error.message : null
      }
      onLoadMore={
        conversations.hasNextPage
          ? () => void conversations.fetchNextPage()
          : undefined
      }
    />
  );

  function refreshHistory() {
    return conversationId
      ? client.invalidateQueries({
          queryKey: aiQueryKeys.messages(tenantCode, conversationId),
        })
      : Promise.resolve();
  }
  async function mutateCard<T>(operation: () => Promise<T>): Promise<T> {
    if (requestBusy()) throw new Error("助手正在处理请求");
    mutationLock.current = true;
    setCardBusy(true);
    setCardError("");
    try {
      return await operation();
    } finally {
      await refreshHistory();
      mutationLock.current = false;
      setCardBusy(false);
    }
  }
  const commands: AssistantCommands = {
    busy: cardBusy || state.phase === "SENDING" || state.phase === "STREAMING",
    answer(question, value) {
      if (!conversationId || requestBusy()) return;
      const previous = fullHistory.find(
        (row) => row.turnId === question.turnId && row.role === "ASSISTANT",
      );
      setCardBusy(true);
      setCardError("");
      const onResume = () => {
        setRetriedRow(
          previous
            ? { turnId: question.turnId, fingerprint: rowFingerprint(previous) }
            : null,
        );
        dispatch({ type: "beginRetryTurn", turnId: question.turnId });
      };
      return startTurn(
        (signal) =>
          aiApi.streamTurn(
            tenantCode,
            {
              conversationId,
              answer: { questionId: question.questionId, value },
              ...(bound && { context: bound.hint }),
            },
            signal,
          ),
        onResume,
      );
    },
    cancel(question) {
      if (!conversationId || requestBusy()) return;
      void mutateCard(() =>
        aiApi.cancelQuestion(tenantCode, conversationId, question.questionId),
      ).catch(() => setCardError("暂时无法取消问题，请刷新后重试"));
    },
    regenerate(id) {
      if (!conversationId || requestBusy()) return;
      dispatch({ type: "beginNewTurn", content: "重新生成这一项" });
      startTurn((signal) =>
        aiApi.streamTurn(
          tenantCode,
          { conversationId, regenerateProposalId: id },
          signal,
        ),
      );
    },
    confirm: (id, input) =>
      mutateCard(async () => {
        const result = await aiApi.confirmBatch(tenantCode, id, input);
        if (result.items.some((item) => item.status === "EXECUTED"))
          await client.invalidateQueries({
            predicate: (q) =>
              q.queryKey[0] === "workspace" &&
              q.queryKey[1] === tenantCode &&
              !q.queryKey.includes("ai"),
          });
        return result;
      }),
    reject: (id) => mutateCard(() => aiApi.rejectProposal(tenantCode, id)),
    describeRule: bound?.describeRule,
    apply(action, rule) {
      const empty = { version: 1, match: "all", conditions: [] };
      if (panel) {
        if (
          !bound ||
          !bound.applyFilter ||
          bound.hint.recordId ||
          bound.hint.objectCode !== action.objectCode ||
          bound.hint.viewId !== action.baseViewId ||
          hashKey([bound.filterDraft ?? empty]) !==
            hashKey([action.currentRule])
        )
          return "stale";
        bound.applyFilter(rule);
        return "applied";
      }
      if (!conversationId || !memberId) return "stale";
      const sameList =
        page &&
        !page.hint.recordId &&
        page.hint.objectCode === action.objectCode;
      const params = new URLSearchParams(sameList ? page.listQuery : undefined);
      if (!sameList && action.baseViewId)
        params.set("viewId", action.baseViewId);
      params.set("assistant", conversationId);
      writeAssistantSession(key("active"), conversationId);
      router.push(
        `/workspace/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(action.objectCode)}?${params}`,
      );
      return "review";
    },
  };
  const title =
    conversations.data?.pages
      .flatMap((page) => page.items)
      .find((item) => item.id === conversationId)?.title ??
    state.title ??
    "新会话";
  function expandPanel() {
    if (!panel) return;
    const params = new URLSearchParams({ fromPage: "1" });
    if (conversationId) params.set("conversation", conversationId);
    writeAssistantSession(
      key(`page:${conversationId ?? "new"}`),
      JSON.stringify({
        ...panel.page,
        ...(!panel.page.hint.recordId && { listQuery: window.location.search }),
      }),
    );
    router.push(`/workspace/${encodeURIComponent(tenantCode)}/ai?${params}`);
  }
  return (
    <AssistantCommandContext.Provider value={commands}>
      <div className={panel ? panelStyles.panel : styles.page}>
        {!panel && <div className={styles.rail}>{renderRail()}</div>}
        <Drawer
          title="AI 会话"
          placement="left"
          open={railOpen}
          onClose={() => setRailOpen(false)}
          size={300}
          styles={{
            body: { display: "flex", padding: 0, background: "var(--bg-page)" },
          }}
        >
          {renderRail(true)}
        </Drawer>
        <section className={styles.chat}>
          <header className={styles.header}>
            <div className={styles.headerCopy}>
              <h1 className={styles.headerTitle}>
                {panel ? (
                  title
                ) : (
                  <>
                    AI 助手 <Tag>需确认后执行</Tag>
                  </>
                )}
              </h1>
              {!panel && (
                <p className={styles.headerHint}>基于你当前 CRM 权限回答</p>
              )}
            </div>
            {panel ? (
              <div className={panelStyles.headerButtons}>
                <Button
                  type="text"
                  icon={<UnorderedListOutlined />}
                  aria-label="切换会话"
                  onClick={() => setRailOpen(true)}
                />
                <Button
                  type="text"
                  icon={<ExpandOutlined />}
                  aria-label="打开完整页"
                  onClick={expandPanel}
                />
                <Button
                  type="text"
                  icon={<CloseOutlined />}
                  aria-label="关闭助手"
                  onClick={panel.close}
                />
              </div>
            ) : (
              <Button
                className={styles.mobileRailButton}
                aria-label="会话"
                icon={<UnorderedListOutlined aria-hidden />}
                onClick={() => setRailOpen(true)}
              >
                会话
              </Button>
            )}
          </header>
          {page && (
            <div className={panelStyles.contextBar}>
              {bound ? (
                <span className={panelStyles.contextTag}>
                  <LinkOutlined aria-hidden />
                  {page.label}
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    aria-label="移除页面关联"
                    onClick={() => writeAssistantSession(bindingKey, "1")}
                  />
                </span>
              ) : (
                <Button
                  size="small"
                  type="text"
                  icon={<LinkOutlined />}
                  onClick={() => writeAssistantSession(bindingKey)}
                >
                  关联当前页面
                </Button>
              )}
            </div>
          )}
          <div className={styles.canvas} data-testid="ai-conversation-canvas">
            {shown.length === 0 &&
            state.phase === "IDLE" &&
            !conversationId && canSend &&
            !messages.isError ? (
              <AiEmptyState
                objects={businessObjects}
                objectName={bound?.objectName}
                pageKind={
                  bound ? (bound.hint.recordId ? "record" : "list") : undefined
                }
                onPrompt={(text) => {
                  dispatch({ type: "draft", value: text });
                  send(text);
                }}
              />
            ) : (
              <AiMessageList
                key={conversationId ?? state.conversationId ?? "new"}
                tenantCode={tenantCode}
                messages={shown}
                loading={messages.isLoading}
                error={messages.isError}
                onRetryMessages={() => void messages.refetch()}
                streaming={state.phase === "STREAMING"}
                phase={state.phase}
                onLoadOlder={
                  messages.hasNextPage
                    ? () => messages.fetchNextPage()
                    : undefined
                }
                onRetry={
                  state.phase === "SENDING" ||
                  state.phase === "STREAMING" ||
                  confirmProposal.isPending ||
                  rejectProposal.isPending
                    ? undefined
                    : retry
                }
                onConfirmProposal={(id) => confirmProposal.mutate(id)}
                onRejectProposal={(id) => rejectProposal.mutate(id)}
                proposalBusy={
                  confirmProposal.isPending || rejectProposal.isPending
                }
                proposalError={proposalError}
              />
            )}
            {state.errorMessage &&
            !shown.some(
              (item) =>
                item.role === "ASSISTANT" && item.turnId === state.turnId,
            ) ? (
              <div className={styles.turnError}>
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
              </div>
            ) : null}
            {cardError && <p role="alert">{cardError}</p>}
            <AiComposer
              disabled={quotaExhausted}
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
    </AssistantCommandContext.Provider>
  );
}
