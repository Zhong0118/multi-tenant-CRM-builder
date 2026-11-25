import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/auth-shell";
import { ResetMethods } from "@/features/auth/email-reset-form";
import { createServerApiClient } from "@/lib/api/server-client";

export const metadata: Metadata = {
  title: "找回密码",
  robots: { index: false },
};

export default async function ForgotPasswordPage() {
  const client = await createServerApiClient();
  const { data } = await client
    .GET("/api/v1/auth/email/status")
    .catch(() => ({ data: undefined }));
  return (
    <AuthShell
      title="重置密码"
      description="验证账号后设置新密码，完成后所有设备将退出登录。"
      footer={
        <>
          想起密码了？ <Link href="/login">返回登录</Link>
        </>
      }
    >
      <ResetMethods mailAvailable={data?.mailAvailable ?? false} />
    </AuthShell>
  );
}
