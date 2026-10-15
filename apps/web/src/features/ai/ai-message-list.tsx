"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button, Skeleton, Tooltip } from "antd";

import styles from "./ai-assistant.module.css";
import { AssistantMessage } from "./assistant-message";
import { UserMessage } from "./user-message";
import type { AiMessage, AiTurnPhase } from "./ai-types";

export function nextPrependScrollTop(
  anchor: { height: number; top: number },
  newHeight: number,
): number {
  return anchor.top + (newHeight - anchor.height);
}

export function AiMessageList({
  tenantCode,
  messages,
  loading,
  error,
  onRetryMessages,
  streaming,
  phase,
  onLoadOlder,
  onRetry,
  onConfirmProposal,
  onRejectProposal,
  proposalBusy,
  proposalError,
}: {
  tenantCode: string;
  messages: AiMessage[];
  loading?: boolean;
  error?: boolean;
  streaming?: boolean;
  phase: AiTurnPhase;
  onLoadOlder?: () => void | Promise<unknown>;
  onRetry?: (turnId: string) => void;
  onConfirmProposal?: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
  proposalBusy?: boolean;
  proposalError?: string | null;
  onRetryMessages?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const [follow, setFollow] = useState(true);
  const live = useRef<HTMLDivElement>(null);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const questionNav = useRef<HTMLElement>(null);
  const [activeQuestion, setActiveQuestion] = useState<string>();
  const questions = messages.filter((message) => message.role === "USER");
  const currentQuestion = follow
    ? questions.at(-1)?.turnId
    : activeQuestion ?? questions[0]?.turnId;

  useLayoutEffect(() => {
    const nav = questionNav.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (nav && active) nav.scrollTop = active.offsetTop - nav.clientHeight / 2;
  }, [currentQuestion, questions.length]);

  function locateQuestion(turnId: string) {
    const node = scroller.current;
    const target = Array.from(node?.querySelectorAll<HTMLElement>("[data-ai-question]") ?? [])
      .find((item) => item.dataset.aiQuestion === turnId);
    if (!node || !target) return;
    lastScrollTop.current = node.scrollTop;
    setFollow(false);
    setActiveQuestion(turnId);
    node.scrollTo?.({
      top: Math.max(0, node.scrollTop + target.getBoundingClientRect().top - node.getBoundingClientRect().top - 16),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const anchor = prependAnchor.current;
    if (anchor) {
      node.scrollTop = nextPrependScrollTop(anchor, node.scrollHeight);
      prependAnchor.current = null;
      return;
    }
    if (follow) node.scrollTo?.({ top: node.scrollHeight });
  }, [follow, messages, streaming]);

  return (
    <div className={styles.messageViewport}>
    <div
      className={styles.messages}
      data-testid="ai-message-scroller"
      ref={scroller}
      role="region"
      aria-label="AI 对话内容"
      tabIndex={0}
      onScroll={() => {
        const node = scroller.current;
        if (!node) return;
        const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        const scrollingUp = node.scrollTop < lastScrollTop.current;
        lastScrollTop.current = node.scrollTop;
        setFollow(atBottom && !scrollingUp);
        const anchors = Array.from(node.querySelectorAll<HTMLElement>("[data-ai-question]"));
        const readingTop = node.getBoundingClientRect().top + 72;
        const current = anchors.filter((item) => item.getBoundingClientRect().top <= readingTop).at(-1) ?? anchors[0];
        setActiveQuestion(current?.dataset.aiQuestion);
      }}
    >
      {onLoadOlder ? (
        <Button
          type="link"
          onClick={() => {
            const node = scroller.current;
            if (node) {
              prependAnchor.current = {
                height: node.scrollHeight,
                top: node.scrollTop,
              };
            }
            void Promise.resolve(onLoadOlder()).catch(() => {
              prependAnchor.current = null;
            });
          }}
        >
          加载更早消息
        </Button>
      ) : null}
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
      {error ? (
        <div className={styles.messageError} role="alert">
          <span>消息加载失败</span>
          {onRetryMessages ? <Button type="link" onClick={onRetryMessages}>重试</Button> : null}
        </div>
      ) : null}
      {messages.map((message) =>
        message.role === "USER" ? (
          <div key={message.id} data-ai-question={message.turnId}>
            <UserMessage message={message} />
          </div>
        ) : (
          <AssistantMessage
            key={message.id}
            tenantCode={tenantCode}
            message={message}
            onRetry={streaming || phase === "SENDING" || phase === "STREAMING" || proposalBusy ? undefined : onRetry}
            onConfirmProposal={onConfirmProposal}
            onRejectProposal={onRejectProposal}
            proposalBusy={proposalBusy}
            proposalError={proposalError}
          />
        ),
      )}
      <div ref={live} className={styles.srOnly} aria-live="polite">
        {phase === "COMPLETED" || phase === "PARTIAL_COMPLETED"
          ? "回答已完成"
          : ""}
      </div>
      {!follow ? (
        <div className={styles.jumpLatest}>
          <Button
            onClick={() => {
              setFollow(true);
              scroller.current?.scrollTo?.({
                top: scroller.current.scrollHeight,
              });
            }}
          >
            回到最新
          </Button>
        </div>
      ) : null}
    </div>
    {questions.length > 0 ? (
      <nav className={styles.questionNav} aria-label="按提问定位" ref={questionNav}>
        {questions.map((question) => (
          <Tooltip key={question.turnId} title={question.content.slice(0, 160)} placement="left" trigger={["hover", "focus"]}>
            <button
              type="button"
              className={styles.questionAnchor}
              aria-label={`定位提问：${question.content.slice(0, 80)}`}
              aria-current={question.turnId === currentQuestion ? "location" : undefined}
              onClick={() => locateQuestion(question.turnId)}
            >
              <span aria-hidden />
            </button>
          </Tooltip>
        ))}
      </nav>
    ) : null}
    </div>
  );
}
