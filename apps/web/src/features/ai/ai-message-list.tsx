"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button, Skeleton } from "antd";

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
  streaming,
  phase,
  onLoadOlder,
  onRetry,
}: {
  tenantCode: string;
  messages: AiMessage[];
  loading?: boolean;
  streaming?: boolean;
  phase: AiTurnPhase;
  onLoadOlder?: () => void;
  onRetry?: (turnId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const live = useRef<HTMLDivElement>(null);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);

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
    <div
      className={styles.messages}
      data-testid="ai-message-scroller"
      ref={scroller}
      onScroll={() => {
        const node = scroller.current;
        if (!node) return;
        const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        setFollow(atBottom);
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
            onLoadOlder();
          }}
        >
          加载更早消息
        </Button>
      ) : null}
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
      {messages.map((message) =>
        message.role === "USER" ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <AssistantMessage
            key={message.id}
            tenantCode={tenantCode}
            message={message}
            onRetry={onRetry}
          />
        ),
      )}
      <div ref={live} aria-live="polite">
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
  );
}
