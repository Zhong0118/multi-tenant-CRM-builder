"use client";

import { Button, Result, Space } from "antd";
import Link from "next/link";

export default function NotFound() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请检查访问地址。已登录时可以回到自己的工作区。"
      extra={
        <Space wrap>
          <Link href="/workspaces">
            <Button type="primary">我的工作区</Button>
          </Link>
          <Link href="/">返回首页</Link>
        </Space>
      }
    />
  );
}
