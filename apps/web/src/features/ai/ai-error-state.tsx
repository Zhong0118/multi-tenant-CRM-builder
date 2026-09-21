"use client";

import { Alert, Button } from "antd";

export function AiErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      type="warning"
      showIcon
      title={message}
      action={
        onRetry ? (
          <Button size="small" aria-label="重试" onClick={onRetry}>
            重试
          </Button>
        ) : undefined
      }
    />
  );
}
