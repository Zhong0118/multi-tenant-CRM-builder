"use client";

import styles from "./ai-assistant.module.css";
import type { AiMessage } from "./ai-types";

export function UserMessage({ message }: { message: AiMessage }) {
  return (
    <div className={styles.userBubble}>
      {message.content}
      {message.createdAt ? (
        <div>
          <small>{new Date(message.createdAt).toLocaleString()}</small>
        </div>
      ) : null}
    </div>
  );
}
