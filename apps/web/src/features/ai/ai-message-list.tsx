"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDownOutlined } from "@ant-design/icons";
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
  const body = useRef<HTMLDivElement>(null);
  const hold = useRef<HTMLDivElement>(null);
  const bodyHeight = useRef(0);
  const following = useRef(true);
  useLayoutEffect(() => {
    following.current = follow;
  }, [follow]);
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

  // A card that collapses at the bottom (confirmed, rejected) would let the
  // browser pull everything above it down. Keep the freed space as an empty
  // stretch under the last message instead, and let the next message grow
  // into it, so nothing above moves. Runs after layout, before paint.
  useLayoutEffect(() => {
    const node = scroller.current;
    const inner = body.current;
    const spacer = hold.current;
    if (!node || !inner || !spacer) return;
    bodyHeight.current = inner.offsetHeight;
    const observer = new ResizeObserver(() => {
      const height = inner.offsetHeight;
      const held = spacer.offsetHeight;
      const next = nextHold(bodyHeight.current, height, held, following.current);
      bodyHeight.current = height;
      if (next === held) return;
      const top = lastScrollTop.current;
      spacer.style.height = `${next}px`;
      if (next > held) node.scrollTop = top;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // Another conversation (or fewer messages) starts from a clean bottom.
  const firstId = messages[0]?.id;
  const count = useRef(messages.length);
  useLayoutEffect(() => {
    const fewer = messages.length < count.current;
    count.current = messages.length;
    if (!fewer) return;
    if (hold.current) hold.current.style.height = "0px";
    if (body.current) bodyHeight.current = body.current.offsetHeight;
  }, [messages.length]);
  useLayoutEffect(() => {
    if (hold.current) hold.current.style.height = "0px";
    if (body.current) bodyHeight.current = body.current.offsetHeight;
  }, [firstId]);

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
        const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
        const atBottom = distance < 48;
        const scrollingUp = node.scrollTop < lastScrollTop.current;
        lastScrollTop.current = node.scrollTop;
        // Resting on the last line always follows (a resize can lower
        // scrollTop without the reader scrolling up).
        setFollow(distance < 2 || (atBottom && !scrollingUp));
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
      <div ref={body}>
      {messages.map((message) =>
        message.role === "USER" ? (
          <div key={message.id} data-ai-question={message.turnId}>
            <UserMessage message={message} />
          </div>
        ) : (
          <AssistantMessage
            key={`assistant-${message.turnId}`}
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
      </div>
      <div ref={hold} aria-hidden />
      <div ref={live} className={styles.srOnly} aria-live="polite">
        {phase === "COMPLETED" || phase === "PARTIAL_COMPLETED"
          ? "回答已完成"
          : ""}
      </div>
    </div>
    {/* Floats in the right gutter, outside the scroll flow: showing it never
        changes the content height, and it never covers a line of the answer. */}
    {!follow ? (
      // The wrapper carries the absolute position: AntD's own button rule
      // (position: relative) would otherwise win and make it a flex item that
      // narrows the list each time it shows.
      <div className={styles.jumpLatest}>
        <Tooltip title="回到最新" placement="left">
          <Button
            shape="circle"
            size="small"
            icon={<ArrowDownOutlined />}
            aria-label="回到最新"
            onClick={() => {
              setFollow(true);
              scroller.current?.scrollTo?.({
                top: scroller.current.scrollHeight,
              });
            }}
          />
        </Tooltip>
      </div>
    ) : null}
    {/* One question has nowhere to jump to. */}
    {questions.length > 1 ? (
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

/**
 * Height of the empty stretch under the last message. Content that shrinks
 * leaves its space behind; content that grows while the reader follows the
 * bottom takes that space back first.
 */
export function nextHold(
  previous: number,
  height: number,
  held: number,
  following: boolean,
) {
  const change = height - previous;
  if (change < 0) return held - change;
  if (change > 0 && following) return Math.max(0, held - change);
  return held;
}
