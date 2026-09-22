"use client";

import styles from "./ai-assistant.module.css";
import type { AiMessage } from "./ai-types";

export function UserMessage({ message }: { message: AiMessage }) {
  return (
    <div className={styles.userRow}>
      <div className={styles.userBubble}>
        {message.content}
        {message.createdAt ? (
          <div className={styles.userMeta}>
            <small>{new Date(message.createdAt).toLocaleString()}</small>
          </div>
        ) : null}
      </div>
    </div>
  );
}
