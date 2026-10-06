"use client";

import styles from "./ai-assistant.module.css";
import { messageTime } from "./ai-copy";
import type { AiMessage } from "./ai-types";

export function UserMessage({ message }: { message: AiMessage }) {
  return (
    <div className={styles.userRow}>
      <div className={styles.userBubble}>
        {message.content}
        {message.createdAt ? (
          <div className={styles.userMeta}>
            <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
          </div>
        ) : null}
      </div>
    </div>
  );
}
