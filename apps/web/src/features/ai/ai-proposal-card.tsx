"use client";

import { Button, Tag } from "antd";
import type { AiProposalView } from "./ai-types";

function statusText(status: AiProposalView["status"]): string {
  const labels: Record<AiProposalView["status"], string> = { PROPOSED: "待确认", REJECTED: "已拒绝", EXPIRED: "已过期", CONFLICTED: "已冲突", FAILED: "执行失败", EXECUTED: "已执行" };
  return labels[status];
}

export function AiProposalCard({ proposal, onConfirm, onReject, busy = false }: { proposal: AiProposalView; onConfirm?: () => void | Promise<void>; onReject?: () => void | Promise<void>; busy?: boolean }) {
  const actionable = proposal.status === "PROPOSED" && new Date(proposal.expiresAt).getTime() > Date.now();
  return <section aria-label={`AI 提案：${proposal.title}`}>
    <header><strong>{proposal.title}</strong> <Tag>{statusText(proposal.status)}</Tag></header>
    <p>{proposal.targetSummary}</p>
    {proposal.changes.length > 0 ? <dl>{proposal.changes.map((change) => <div key={change.label}><dt>{change.label}</dt><dd>{change.before ?? "—"} → {change.after ?? "—"}</dd></div>)}</dl> : null}
    {proposal.validationWarnings.map((warning) => <p role="status" key={warning}>{warning}</p>)}
    {actionable ? <div><Button type="primary" disabled={busy} onClick={() => void onConfirm?.()}>确认执行</Button><Button disabled={busy} onClick={() => void onReject?.()}>拒绝</Button></div> : null}
    {proposal.status === "EXECUTED" && proposal.auditId ? <p>已记录审计：{proposal.auditId}</p> : null}
    {proposal.failureCode ? <p role="alert">{proposal.failureCode === "CONFLICT" ? "数据已变化，请重新生成提案" : "提案执行失败，请检查后重试"}</p> : null}
  </section>;
}
