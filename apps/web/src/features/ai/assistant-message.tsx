"use client";

import styles from "./ai-assistant.module.css";
import { renderSafeText } from "./ai-copy";
import { AiErrorState } from "./ai-error-state";
import { SourceCard } from "./source-card";
import { ToolActivity } from "./tool-activity";
import { userErrorMessage } from "./ai-turn-reducer";
import type { AiMessage } from "./ai-types";

export function AssistantMessage({
  tenantCode,
  message,
  onRetry,
}: {
  tenantCode: string;
  message: AiMessage;
  onRetry?: (turnId: string) => void;
}) {
  const retryable =
    (message.status === "FAILED" || message.status === "CANCELLED") && onRetry;
  const partial =
    message.status === "PARTIAL_COMPLETED" ||
    (message.status === "COMPLETED" &&
      message.toolSummary.some((tool) => tool.status === "FAILED"));
  return (
    <article className={styles.assistantSurface}>
      <ToolActivity tools={message.toolSummary} />
      {renderSafeText(message.content).map((paragraph, index) => (
        <p key={`${message.id}-${index}`}>{paragraph}</p>
      ))}
      {partial ? (
        <AiErrorState message="部分 CRM 数据暂时无法读取，本次回答可能不完整" />
      ) : null}
      {retryable ? (
        <AiErrorState
          message={
            message.status === "CANCELLED"
              ? "回答已停止"
              : userErrorMessage(message.errorCode)
          }
          onRetry={() => onRetry(message.turnId)}
        />
      ) : null}
      {message.sourceSummary.length > 0 ? (
        <div className={styles.sources}>
          {message.sourceSummary.map((source, index) => (
            <SourceCard
              key={`${source.kind}-${source.objectCode}-${index}`}
              tenantCode={tenantCode}
              source={source}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}
