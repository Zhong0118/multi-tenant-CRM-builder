"use client";

import { Button, Result } from "antd";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <Result
      status="error"
      title="页面加载失败"
      subTitle="当前页面未能正常加载。"
      extra={<Button onClick={reset}>重新加载</Button>}
    />
  );
}
