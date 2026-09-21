"use client";

import styles from "./ai-assistant.module.css";
import { renderSafeText } from "./ai-copy";
import { SourceCard } from "./source-card";
import { ToolActivity } from "./tool-activity";
import type { AiMessage } from "./ai-types";

export function AssistantMessage({
  tenantCode,
  message,
}: {
  tenantCode: string;
  message: AiMessage;
}) {
  return (
    <article className={styles.assistantSurface}>
      <ToolActivity tools={message.toolSummary} />
      {renderSafeText(message.content).map((paragraph, index) => (
        <p key={`${message.id}-${index}`}>{paragraph}</p>
      ))}
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
