"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Skeleton } from "antd";

import styles from "./ai-assistant.module.css";
import { AssistantMessage } from "./assistant-message";
import { UserMessage } from "./user-message";
import type { AiMessage, AiTurnPhase } from "./ai-types";

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
  const previousCount = useRef(messages.length);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (messages.length > previousCount.current && !follow) {
      const previousHeight = node.scrollHeight;
      requestAnimationFrame(() => {
        node.scrollTop += node.scrollHeight - previousHeight;
      });
    } else if (follow) {
      node.scrollTo?.({ top: node.scrollHeight });
    }
    previousCount.current = messages.length;
  }, [follow, messages, streaming]);

  return (
    <div
      className={styles.messages}
      ref={scroller}
      onScroll={() => {
        const node = scroller.current;
        if (!node) return;
        const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        setFollow(atBottom);
      }}
    >
      {onLoadOlder ? (
        <Button type="link" onClick={onLoadOlder}>
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
