import Link from "next/link";

import { AuthShell } from "@/features/auth/auth-shell";
import { LoginForm } from "@/features/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnTo = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  return (
    <AuthShell
      eyebrow="ACCOUNT / SIGN IN"
      title="登录"
      description="使用手机号和密码进入你的账号。"
      footer={
        <>
          还没有账号？ <Link href="/register">创建账号</Link>
        </>
      }
    >
      <LoginForm returnTo={returnTo} />
    </AuthShell>
  );
}
