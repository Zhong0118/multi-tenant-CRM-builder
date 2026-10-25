"use client";

import { ClockCircleOutlined, CopyOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useState } from "react";

import { useToast } from "@/components/feedback/use-toast";

import { elapsedSince, formatDuration, useElapsedNow } from "./ai-elapsed";
import styles from "./ai-assistant.module.css";
import { AiErrorState } from "./ai-error-state";
import { AnswerText } from "./ai-rich-text";
import { SourceCard } from "./source-card";
import { ToolActivity } from "./tool-activity";
import { userErrorMessage } from "./ai-turn-reducer";
import { AiProposalCard } from "./ai-proposal-card";
import type { AiMessage } from "./ai-types";

export function AssistantMessage({
  tenantCode,
  message,
  onRetry,
  onConfirmProposal,
  onRejectProposal,
  proposalBusy,
  proposalError,
}: {
  tenantCode: string;
  message: AiMessage;
  onRetry?: (turnId: string) => void;
  onConfirmProposal?: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
  proposalBusy?: boolean;
  proposalError?: string | null;
}) {
  const toast = useToast();
  const [copyFailed, setCopyFailed] = useState(false);
  const active = message.status === "STREAMING" || message.status === "GENERATING";
  const now = useElapsedNow(active);
  // Persisted GENERATING rows retain the original creation time on retries.
  // Only the local STREAMING projection has a current attempt start.
  const duration = active
    ? message.status === "STREAMING" ? elapsedSince(message.createdAt, now) : undefined
    : message.durationMs ?? (message.completedAt ? elapsedSince(message.createdAt, Date.parse(message.completedAt)) : undefined);
  const partial =
    message.status === "PARTIAL_COMPLETED" ||
    (message.status === "COMPLETED" &&
      message.toolSummary.some((tool) => tool.status === "FAILED"));
  const retryable = !active && !message.proposal && !proposalBusy &&
    (message.status === "FAILED" || message.status === "CANCELLED" || partial) && onRetry;
  const failedTools = message.toolSummary.filter((tool) => tool.status === "FAILED");
  const waiting =
    (message.status === "STREAMING" || message.status === "GENERATING") &&
    !message.content &&
    message.toolSummary.length === 0 &&
    !message.proposal;
  return (
    <article className={styles.assistantRow}>
      <div className={styles.avatar} aria-hidden>
        AI
      </div>
      <div className={styles.assistantSurface}>
        <div className={styles.answerMeta}>
          <span>{active ? "正在回答" : message.status === "FAILED" ? "回答未完成" : message.status === "CANCELLED" ? "已停止" : partial ? "回答含未成功的查询" : "AI 回答"}</span>
          {duration !== undefined ? <span className={styles.turnDuration}><ClockCircleOutlined aria-hidden />{active ? "已用时" : "本轮用时"} {formatDuration(duration)}</span> : null}
        </div>
        {waiting ? <p className={styles.waiting}>正在整理回答…</p> : null}
        <ToolActivity tools={message.toolSummary} running={active} now={active ? now : message.completedAt ? Date.parse(message.completedAt) : undefined} />
        {message.proposal ? <AiProposalCard tenantCode={tenantCode} proposal={message.proposal} busy={proposalBusy} mutationError={proposalError} onConfirm={() => onConfirmProposal?.(message.proposal!.proposalId)} onReject={() => onRejectProposal?.(message.proposal!.proposalId)} /> : null}
        {message.content ? <div className={styles.answerContent}><AnswerText content={message.content} /></div> : null}
        {message.content && !active && message.status !== "FAILED" ? (
          <div className={styles.answerActions}>
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined aria-hidden />}
              onClick={() => {
                const failed = () => setCopyFailed(true);
                setCopyFailed(false);
                if (!navigator.clipboard) return failed();
                void navigator.clipboard
                  .writeText(message.content)
                  .then(() => toast.success("回答已复制"), failed);
              }}
            >
              复制回答
            </Button>
            {copyFailed ? (
              <span role="alert" className={styles.copyFailed}>
                无法写入剪贴板，请选中回答文字手动复制
              </span>
            ) : null}
          </div>
        ) : null}
        {partial ? (
          <AiErrorState message={failedTools.some((tool) => tool.detail || tool.errorCode) ? "查询未全部成功，请展开查看原因" : "部分查询未成功，可展开查看"} onRetry={retryable ? () => onRetry(message.turnId) : undefined} />
        ) : null}
        {!partial && (message.status === "FAILED" || message.status === "CANCELLED") ? (
          <AiErrorState
            message={
              message.status === "CANCELLED"
                ? "回答已停止"
                : userErrorMessage(message.errorCode)
            }
            onRetry={retryable ? () => onRetry(message.turnId) : undefined}
          />
        ) : null}
        {message.sourceSummary.length > 0 ? (
          <div className={styles.sourceBlock}>
            <div className={styles.sourceLabel}>数据来源</div>
            <div className={styles.sources}>
              {message.sourceSummary.map((source, index) => (
                <SourceCard
                  key={`${source.kind}-${source.objectCode}-${index}`}
                  tenantCode={tenantCode}
                  source={source}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
