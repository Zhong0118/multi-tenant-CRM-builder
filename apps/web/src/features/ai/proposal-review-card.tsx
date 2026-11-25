"use client";

import { Button, Checkbox } from "antd";
import type { ReactNode } from "react";
import styles from "./proposal-review-card.module.css";

export interface ReviewItem {
  key: string;
  operationKey?: string;
  label: string;
  evidence?: string;
  error?: string;
  locked?: boolean;
  render: (edit: (value: unknown) => void, disabled: boolean) => ReactNode;
}

export interface ReviewResult {
  status: "EXECUTED" | "FAILED";
  message: string;
}

export function ProposalReviewCard({
  items,
  selectedKeys,
  itemResults,
  busy,
  onSelect,
  onEdit,
  onConfirm,
  onRetry,
  confirmLabel = "确认所选项",
  extraActions,
}: {
  items: ReviewItem[];
  selectedKeys: string[];
  itemResults: Record<string, ReviewResult>;
  busy: boolean;
  onSelect?: (key: string, selected: boolean) => void;
  onEdit?: (key: string, value: unknown) => void;
  onConfirm?: (keys: string[]) => void;
  onRetry?: (keys: string[]) => void;
  confirmLabel?: string;
  extraActions?: ReactNode;
}) {
  const operation = (item: ReviewItem) => item.operationKey ?? item.key;
  const selectedItems = items.filter((item) => selectedKeys.includes(item.key));
  const incomplete = new Set(
    selectedItems.filter((item) => item.error).map(operation),
  );
  // Several fields share one write. Keep its edits together and give each
  // failed operation one retry, independent of other failed operations.
  const failedItems = new Map(
    items
      .filter((item) => itemResults[item.key]?.status === "FAILED")
      .map((item) => [operation(item), item.key]),
  );
  const eligible = selectedItems.filter(
    (item) =>
      !item.locked &&
      !incomplete.has(operation(item)) &&
      itemResults[item.key]?.status !== "EXECUTED",
  );
  const fresh = eligible
    .filter((item) => !failedItems.has(operation(item)))
    .map((item) => item.key);
  return (
    <div className={styles.review}>
      <div className={styles.items}>
        {items.map((item) => {
          const result = itemResults[item.key];
          if (result?.status === "EXECUTED")
            return (
              <p key={item.key} className={styles.savedItem}>
                {item.label}
                <span>{result.message}</span>
              </p>
            );
          const selected = selectedKeys.includes(item.key);
          const failedItem = failedItems.get(operation(item));
          if (failedItems.size && !failedItem && !selected) return null;
          const retryKeys = eligible
            .filter((entry) => operation(entry) === operation(item))
            .map((entry) => entry.key);
          const disabled = busy || !!item.locked;
          const expanded = !failedItems.size || !!result || selected;
          const controls = (
            <>
              {onSelect && (
                <Checkbox
                  aria-label={`选择${item.label}`}
                  checked={selected}
                  disabled={disabled}
                  onChange={(event) => onSelect(item.key, event.target.checked)}
                >
                  {item.label}
                </Checkbox>
              )}
              {expanded && (
                <>
                  {item.render((value) => onEdit?.(item.key, value), disabled)}
                  {item.evidence && <blockquote>{item.evidence}</blockquote>}
                  {selected && item.error && <p role="status">{item.error}</p>}
                </>
              )}
              {onRetry && failedItem === item.key && (
                <>
                  <p role="alert">{result.message}</p>
                  <Button
                    aria-label={busy ? "正在保存…" : "重试"}
                    loading={busy}
                    disabled={busy || !retryKeys.length}
                    onClick={() => onRetry(retryKeys)}
                  >
                    {busy ? "正在保存…" : "重试"}
                  </Button>
                </>
              )}
            </>
          );
          if (failedItems.size && !failedItem && selected)
            return (
              <details key={item.key} className={styles.item}>
                <summary>
                  {item.label} · {item.error ? "待补充" : "待保存"}
                </summary>
                {controls}
              </details>
            );
          return (
            <div key={item.key} className={onSelect ? styles.item : undefined}>
              {controls}
            </div>
          );
        })}
      </div>
      <div className={styles.actions} aria-label="提案操作">
        {extraActions}
        {onConfirm &&
          (fresh.length > 0 ||
            (!failedItems.size &&
              items.some(
                (item) => !item.locked && !itemResults[item.key],
              ))) && (
            <Button
              type="primary"
              aria-label={confirmLabel}
              loading={busy}
              disabled={busy || !fresh.length}
              onClick={() => onConfirm(fresh)}
            >
              {confirmLabel}
            </Button>
          )}
      </div>
    </div>
  );
}
