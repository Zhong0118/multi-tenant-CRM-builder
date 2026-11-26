"use client";

import { AccessReason, useAiFeature } from "@/features/ai-governance/access";
import { useContext, useEffect, useRef, useState } from "react";
import { useTenantTimezone } from "@/features/follow-ups/use-tenant-timezone";
import { savedFollowUpLabel } from "@/features/records/draft-follow-up-date";
import { Button } from "antd";
import Link from "next/link";
import { AiBadge } from "@/components/ai/ai-badge";
import type { AssistantBatch, AssistantBatchResult } from "@crm/contracts";
import { AssistantCommandContext } from "./assistant-commands";
import { AssistantFieldControl } from "./question-card";
import { ProposalReviewCard } from "./proposal-review-card";
import {
  failureMessage,
  operationLabels,
  resultLink,
  statusLabels,
} from "./ai-proposal-card";
import aiStyles from "./ai-assistant.module.css";
import styles from "./assistant-panel.module.css";

export function AssistantBatchCard({
  batch,
  turnId,
  tenantCode,
}: {
  batch: AssistantBatch;
  turnId: string;
  tenantCode: string;
}) {
  const hasDates = batch.items.some(
    (item) =>
      item.operation === "CREATE_FOLLOW_UP" ||
      item.editableFields?.some((field) => field.type === "DATETIME"),
  );
  const timeZone = useTenantTimezone(tenantCode, undefined, hasDates);
  const commands = useContext(AssistantCommandContext);
  const [selected, setSelected] = useState(() =>
    batch.items
      .filter((item) => item.status === "PROPOSED")
      .map((item) => item.proposalId),
  );
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>(
    {},
  );
  const [results, setResults] = useState<AssistantBatchResult["items"]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const keys = useRef(new Map<string, { input: string; key: string }>());
  async function confirm(ids: string[]) {
    if (!commands || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const items = ids.map((proposalId) => {
        const allowed =
          batch.items.find((item) => item.proposalId === proposalId)
            ?.editableFields ?? [];
        const patch = Object.fromEntries(
          Object.entries(edits[proposalId] ?? {}).filter(([field]) =>
            allowed.some((item) => item.key === field),
          ),
        );
        const input = JSON.stringify(patch);
        if (keys.current.get(proposalId)?.input !== input)
          keys.current.set(proposalId, { input, key: crypto.randomUUID() });
        return {
          proposalId,
          idempotencyKey: keys.current.get(proposalId)!.key,
          ...(Object.keys(patch).length ? { edits: patch } : {}),
        };
      });
      const response = await commands.confirm(turnId, { items });
      setResults((old) => [
        ...old.filter((item) => !ids.includes(item.proposalId)),
        ...response.items,
      ]);
    } catch {
      setError("暂时无法核实执行结果，请刷新后重试");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function reject(id: string) {
    if (!commands || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const view = await commands.reject(id);
      setResults((old) => [
        ...old,
        {
          proposalId: id,
          status: view.status,
          message:
            view.status === "REJECTED"
              ? "已拒绝，未写入数据。"
              : statusLabels[view.status],
        },
      ]);
    } catch {
      setError("暂时无法拒绝此项，请重试");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const next = Math.min(
      ...batch.items
        .filter((item) => item.status === "PROPOSED")
        .map((item) => Date.parse(item.expiresAt))
        .filter((time) => time > now),
    );
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(next - Date.now(), 0) + 1, 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [batch.items, now]);
  const canWrite = useAiFeature("write_proposal");
  const blocked = busy || !!commands?.busy;
  function statusOf(item: AssistantBatch["items"][number]) {
    const result = results.find((entry) => entry.proposalId === item.proposalId);
    return item.status === "PROPOSED"
      ? (result?.status ??
          (Date.parse(item.expiresAt) <= now ? "EXPIRED" : item.status))
      : item.status;
  }
  const statuses = batch.items.map(statusOf);
  const open = statuses.filter((status) => status === "PROPOSED").length;
  const executed = statuses.filter((status) => status === "EXECUTED").length;
  const expired = statuses.filter((status) => status === "EXPIRED").length;
  // The heading follows the cards, so a settled batch never reads as waiting.
  const heading = open
    ? batch.coverage
      ? `共 ${batch.coverage.total} 条，本次提议 ${batch.coverage.targets} 条`
      : `核对 ${batch.items.length} 项建议`
    : executed
      ? `已执行 ${executed} 项${executed < statuses.length ? `，${statuses.length - executed} 项未写入` : ""}`
      : expired === statuses.length
        ? "建议已过期，没有写入"
        : "没有写入任何修改";
  // One record behind every card: name it once, in the heading.
  const targets = new Set(batch.items.map((item) => item.targetSummary || ""));
  const sharedTarget =
    batch.items.length > 1 && targets.size === 1 && !targets.has("")
      ? batch.items[0].targetSummary
      : undefined;
  return (
    <section
      className={`${styles.card} ${styles.batch}`}
      aria-label="待核对的修改"
    >
      <h3 className={styles.batchHeading}>
        <AiBadge>AI 提议</AiBadge>
        <span>{heading}</span>
      </h3>
      {sharedTarget && <p className={styles.batchTarget}>{sharedTarget}</p>}
      {!canWrite && batch.items.some(item=>item.status==="PROPOSED") && <AccessReason />}
      <ProposalReviewCard
        selectedKeys={selected}
        itemResults={{}}
        busy={blocked}
        items={batch.items.map((item) => {
          const id = item.proposalId;
          const result = results.find((result) => result.proposalId === id);
          const status = statusOf(item);
          function displayValue(label: string, value?: string) {
            const field = item.editableFields?.find(
              (field) => field.label === label || field.key === label,
            );
            if (value && field?.options) {
              const parts =
                field.type === "MULTI_SELECT" ? value.split(", ") : [value];
              return parts
                .map(
                  (part) =>
                    field.options?.find(
                      (option) => option.id === part || option.label === part,
                    )?.label ?? "选项不可用",
                )
                .join("、");
            }
            const isDate =
              (item.operation === "CREATE_FOLLOW_UP" && label === "到期时间") ||
              field?.type === "DATETIME";
            return isDate && value && Number.isFinite(Date.parse(value))
              ? savedFollowUpLabel(value, timeZone)
              : value || "—";
          }
          const accessible = Boolean(item.targetSummary || item.changes.length);
          const actionable = status === "PROPOSED" && accessible;
          type Change = (typeof item.changes)[number];
          type Field = NonNullable<typeof item.editableFields>[number];
          const fieldFor = (field: Field, change: Change) =>
            field.label === change.label ||
            field.key === change.label ||
            (item.operation === "CREATE_FOLLOW_UP" &&
              change.label === "到期时间" &&
              field.key === "dueAt");
          // A change with its own control below is shown once, in the control;
          // its old value sits under the control as "原为 …".
          function editedBelow(change: Change) {
            if (!actionable) return false;
            return (item.editableFields ?? []).some((field) =>
              fieldFor(field, change),
            );
          }
          const link =
            status === "EXECUTED" ? resultLink(tenantCode, item) : null;
          const message =
            item.status === "PROPOSED" ? result?.message : undefined;
          return {
            key: id,
            label: sharedTarget
              ? operationLabels[item.operation]
              : item.targetSummary || item.title,
            locked: !actionable,
            render: () => (
              <>
                <div className={styles.meta}>
                  {!sharedTarget && <span>{operationLabels[item.operation]}</span>}
                  <strong className={aiStyles.statusBadge} data-status={status}>
                    {statusLabels[status]}
                  </strong>
                </div>
                <dl>
                  {item.changes
                    .filter((change) => !editedBelow(change))
                    .map((change, index) => (
                    <div key={index}>
                      <dt>{change.label}</dt>
                      <dd>
                        {change.before !== undefined && (
                          <>{displayValue(change.label, change.before)} → </>
                        )}
                        {displayValue(change.label, change.after)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {link && <Link href={link.href}>{link.label}</Link>}
                {!accessible && <p>当前没有可核对的内容</p>}
                {item.validationWarnings.map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
                {actionable && (
                  <>
                    {item.editableFields?.map((field) => {
                      const previous = item.changes.find(
                        (change) =>
                          change.before !== undefined && fieldFor(field, change),
                      );
                      return (
                      <div key={field.key} className={styles.editedField}>
                      <AssistantFieldControl
                        field={field}
                        followUpZone={
                          item.operation === "CREATE_FOLLOW_UP" &&
                          field.key === "dueAt"
                            ? timeZone
                            : undefined
                        }
                        disabled={blocked}
                        value={
                          Object.hasOwn(edits[id] ?? {}, field.key)
                            ? edits[id][field.key]
                            : field.value
                        }
                        onChange={(value) =>
                          setEdits((old) => ({
                            ...old,
                            [id]: { ...old[id], [field.key]: value },
                          }))
                        }
                      />
                      {previous && (
                        <small className={styles.previousValue}>
                          原为 {displayValue(previous.label, previous.before)}
                        </small>
                      )}
                      </div>
                      );
                    })}
                    <div className={styles.itemFooter}>
                      <small>
                        有效至{" "}
                        {new Date(item.expiresAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                      <Button
                        type="text"
                        size="small"
                        disabled={blocked}
                        onClick={() => void reject(id)}
                      >
                        拒绝
                      </Button>
                    </div>
                  </>
                )}
                {(message || failureMessage({ ...item, status })) && (
                  <p
                    role={
                      status === "CONFLICTED" || status === "FAILED"
                        ? "alert"
                        : "status"
                    }
                  >
                    {message ?? failureMessage({ ...item, status })}
                  </p>
                )}
                {Object.values(item.fieldErrors ?? {})
                  .flat()
                  .map((text, i) => (
                    <p key={i} role="alert">
                      {text}
                    </p>
                  ))}
                {(status === "CONFLICTED" || status === "FAILED") && (
                  <Button
                    disabled={blocked}
                    onClick={() => commands?.regenerate(id)}
                  >
                    重新生成这一项
                  </Button>
                )}
              </>
            ),
          };
        })}
        onSelect={(id, checked) =>
          setSelected((old) =>
            checked ? [...old, id] : old.filter((key) => key !== id),
          )
        }
        onConfirm={canWrite ? (ids) => void confirm(ids) : undefined}
        confirmLabel={batch.items.length === 1 ? "确认执行" : "确认所选项"}
      />
      {!open && expired > 0 && executed === 0 && commands?.resend && (
        <div className={styles.batchNext}>
          <span>建议有效期已过，数据可能已经变化。</span>
          <Button
            size="small"
            disabled={blocked}
            onClick={() => commands.resend?.(turnId)}
          >
            按最新数据重新提议
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
