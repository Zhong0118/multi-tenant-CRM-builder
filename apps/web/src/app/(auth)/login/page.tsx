import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/auth-shell";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = {
  title: "登录",
  alternates: { canonical: "/login" },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string | string[];
    reset?: string | string[];
    reason?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const returnTo = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  return (
    <AuthShell
      title="登录"
      footer={
        <>
          还没有账号？ <Link href="/register">创建账号</Link>
        </>
      }
    >
      <LoginForm
        returnTo={returnTo}
        notice={
          params.reset === "done"
            ? "密码已重置，所有设备已退出登录。请用新密码登录。"
            : undefined
        }
        signedOut={params.reason === "signed-out"}
      />
    </AuthShell>
  );
}
