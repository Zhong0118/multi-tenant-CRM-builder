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
}: {
  tenantCode: string;
  messages: AiMessage[];
  loading?: boolean;
  streaming?: boolean;
  phase: AiTurnPhase;
  onLoadOlder?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const live = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!follow) return;
    scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
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
