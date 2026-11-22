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
  const failedOperations = new Set(
    items
      .filter((item) => itemResults[item.key]?.status === "FAILED")
      .map(operation),
  );
  const eligible = selectedItems.filter(
    (item) =>
      !item.locked &&
      !incomplete.has(operation(item)) &&
      itemResults[item.key]?.status !== "EXECUTED",
  );
  const fresh = eligible
    .filter((item) => !failedOperations.has(operation(item)))
    .map((item) => item.key);
  const failed = eligible
    .filter((item) => failedOperations.has(operation(item)))
    .map((item) => item.key);
  return (
    <div className={styles.review}>
      {items.map((item) => {
        const result = itemResults[item.key];
        const disabled = busy || !!item.locked || result?.status === "EXECUTED";
        const selected = selectedKeys.includes(item.key);
        return (
          <div key={item.key} className={onSelect ? styles.item : undefined}>
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
            {item.render((value) => onEdit?.(item.key, value), disabled)}
            {item.evidence && <blockquote>{item.evidence}</blockquote>}
            {selected && item.error && result?.status !== "EXECUTED" && (
              <p role="status">{item.error}</p>
            )}
            {result && (
              <p role={result.status === "FAILED" ? "alert" : "status"}>
                {result.message}
              </p>
            )}
          </div>
        );
      })}
      <div className={styles.actions} aria-label="提案操作">
        {onConfirm &&
          (fresh.length > 0 ||
            (!failed.length &&
              items.some(
                (item) => !item.locked && !itemResults[item.key],
              ))) && (
            <Button
              type="primary"
              disabled={busy || !fresh.length}
              onClick={() => onConfirm(fresh)}
            >
              {confirmLabel}
            </Button>
          )}
        {onRetry && failed.length > 0 && (
          <Button
            disabled={busy}
            type={fresh.length ? "default" : "primary"}
            onClick={() => onRetry(failed)}
          >
            重试失败项
          </Button>
        )}
        {extraActions}
      </div>
    </div>
  );
}
