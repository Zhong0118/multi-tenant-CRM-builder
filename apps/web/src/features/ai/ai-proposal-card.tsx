"use client";

import Link from "next/link";
import { Button, Tag } from "antd";
import { useEffect, useState } from "react";
import type { AiProposalView } from "./ai-types";
import styles from "./ai-assistant.module.css";

const statusLabels: Record<AiProposalView["status"], string> = {
  PROPOSED: "待确认",
  REJECTED: "已拒绝",
  EXPIRED: "已过期",
  CONFLICTED: "已冲突",
  FAILED: "执行失败",
  EXECUTED: "已执行",
};

const operationLabels: Record<AiProposalView["operation"], string> = {
  UPDATE_RECORD: "更新记录",
  CREATE_FOLLOW_UP: "创建跟进",
  ADD_ACTIVITY_NOTE: "添加备注",
};

function safeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  );
}

function resultLink(
  tenantCode: string,
  proposal: AiProposalView,
): { href: string; label: string } | null {
  if (!proposal.result || typeof proposal.result !== "object") return null;
  const result = proposal.result as Record<string, unknown>;
  if (
    !safeIdentifier(tenantCode) ||
    !safeIdentifier(result.objectCode) ||
    !safeIdentifier(result.recordId)
  )
    return null;
  const record = `/workspace/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(result.objectCode)}/${encodeURIComponent(result.recordId)}`;
  if (
    proposal.operation === "CREATE_FOLLOW_UP" &&
    safeIdentifier(result.followUpId)
  ) {
    return {
      href: `${record}?followUp=${encodeURIComponent(result.followUpId)}`,
      label: "查看跟进",
    };
  }
  return { href: record, label: "查看记录" };
}

function failureMessage(proposal: AiProposalView): string | null {
  if (
    [
      "FORBIDDEN",
      "PERMISSION_DENIED",
      "OBJECT_ACTION_FORBIDDEN",
      "FIELD_READ_ONLY",
      "FIELD_HIDDEN",
    ].includes(proposal.failureCode ?? "")
  )
    return "当前权限已变化，暂时不能执行此建议。";
  if (
    proposal.status === "CONFLICTED" ||
    proposal.failureCode === "CONFLICT" ||
    proposal.failureCode === "RECORD_VERSION_CONFLICT"
  )
    return "数据已变化，未覆盖最新内容，请重新提出请求。";
  if (proposal.failureCode === "VALIDATION_FAILED")
    return "业务校验未通过，请检查建议内容后重新提出请求。";
  if (proposal.status === "FAILED")
    return "执行失败，未写入数据，请稍后重试或重新提出请求。";
  return null;
}

export function AiProposalCard({
  tenantCode,
  proposal,
  onConfirm,
  onReject,
  busy = false,
  mutationError,
}: {
  tenantCode?: string;
  proposal: AiProposalView;
  onConfirm?: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
  busy?: boolean;
  mutationError?: string | null;
}) {
  const expiresAt = Date.parse(proposal.expiresAt);
  const [expired, setExpired] = useState(
    () => !Number.isFinite(expiresAt) || expiresAt <= Date.now(),
  );
  useEffect(() => {
    if (expired) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.min(Math.max(0, expiresAt - Date.now()) + 1, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt, expired]);

  const actionable = proposal.status === "PROPOSED" && !expired;
  const result = resultLink(tenantCode ?? "", proposal);
  const failure = failureMessage(proposal);
  return (
    <section
      className={styles.proposalCard}
      aria-label={`AI 提案：${proposal.title}`}
    >
      <header className={styles.proposalHeader}>
        <div>
          <strong>{proposal.title}</strong>
          <span className={styles.proposalOperation}>
            {operationLabels[proposal.operation]}
          </span>
        </div>
        <Tag>
          {expired && proposal.status === "PROPOSED"
            ? "已过期"
            : statusLabels[proposal.status]}
        </Tag>
      </header>
      {proposal.operation === "UPDATE_RECORD" ? (
        <p className={styles.proposalTarget}>{proposal.targetSummary}</p>
      ) : null}
      {proposal.changes.length > 0 || proposal.operation !== "UPDATE_RECORD" ? (
        <dl className={styles.proposalChanges}>
          {proposal.operation !== "UPDATE_RECORD" ? (
            <div>
              <dt>关联 Record</dt>
              <dd>{proposal.targetSummary}</dd>
            </div>
          ) : null}
          {proposal.changes.map((change) => (
            <div key={change.label}>
              <dt>{change.label}</dt>
              <dd>
                {change.before !== undefined
                  ? `${change.before || "—"} → `
                  : ""}
                {change.after ?? "—"}
              </dd>
            </div>
          ))}
          {proposal.operation === "CREATE_FOLLOW_UP" ? (
            <div>
              <dt>负责人</dt>
              <dd>当前执行人</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {proposal.validationWarnings.map((warning) => (
        <p role="status" className={styles.proposalWarning} key={warning}>
          {warning}
        </p>
      ))}
      {actionable ? (
        <div className={styles.proposalActions} aria-label="提案操作">
          <Button
            type="primary"
            disabled={busy}
            onClick={() => void onConfirm?.()}
          >
            确认执行
          </Button>
          <Button disabled={busy} onClick={() => void onReject?.()}>
            拒绝
          </Button>
        </div>
      ) : null}
      {expired && proposal.status === "PROPOSED" ? (
        <p role="status" className={styles.proposalStatus}>
          建议已过期，请重新提出请求。
        </p>
      ) : null}
      {proposal.status === "REJECTED" ? (
        <p role="status" className={styles.proposalStatus}>
          已拒绝，未写入数据。
        </p>
      ) : null}
      {busy ? (
        <p role="status" className={styles.proposalStatus}>
          正在执行，请稍候…
        </p>
      ) : null}
      {mutationError ? (
        <p role="alert" className={styles.proposalFailure}>
          {mutationError}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className={styles.proposalFailure}>
          {failure}
        </p>
      ) : null}
      {proposal.status === "EXECUTED" ? (
        <div className={styles.proposalSuccess}>
          <p>
            已执行并记录审计{proposal.auditId ? `：${proposal.auditId}` : "。"}
          </p>
          {result && tenantCode ? (
            <Link href={result.href}>{result.label} →</Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
