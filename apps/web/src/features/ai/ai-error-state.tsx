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
      message={message}
      action={
        onRetry ? (
          <Button size="small" onClick={onRetry}>
            重试
          </Button>
        ) : undefined
      }
    />
  );
}
