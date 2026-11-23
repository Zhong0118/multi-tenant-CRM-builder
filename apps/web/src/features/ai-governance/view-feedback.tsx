"use client";
import { Alert, Button } from "antd";
import { toApiError } from "@/lib/api/api-error";
export function LoadError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const e = toApiError(error);
  return (
    <Alert
      type="error"
      showIcon
      title={error instanceof Error ? error.message : e.message}
      description={
        e.requestId !== "req_unknown" ? "请求编号 " + e.requestId : undefined
      }
      action={
        <Button size="small" onClick={retry}>
          重试
        </Button>
      }
    />
  );
}

export function quotaColor(percent: number) {
  return percent >= 100
    ? "var(--color-danger, #c53737)"
    : percent >= 80
      ? "var(--color-warning, #b97513)"
      : "var(--color-primary)";
}
