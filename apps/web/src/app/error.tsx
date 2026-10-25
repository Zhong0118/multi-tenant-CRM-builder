"use client";

import { Button, Result } from "antd";
import { useRouter } from "next/navigation";
import { startTransition } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <Result
      status="error"
      title="页面加载失败"
      subTitle={
        error.digest
          ? `服务暂时没有返回数据，请稍后重试。错误编号 ${error.digest}`
          : "服务暂时没有返回数据，请稍后重试。"
      }
      extra={
        <Button
          type="primary"
          onClick={() =>
            // refresh re-reads server data; reset alone would re-render the same failure.
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          重新加载
        </Button>
      }
    />
  );
}
