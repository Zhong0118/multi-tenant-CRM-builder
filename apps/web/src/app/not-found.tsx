"use client";

import { Result } from "antd";
import Link from "next/link";

export default function NotFound() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请检查访问地址。"
      extra={<Link href="/login">返回登录</Link>}
    />
  );
}
