import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/auth-shell";
import { LoginForm } from "@/features/auth/login-form";
import { ICP_RECORD } from "@/features/landing/content";
import styles from "@/features/auth/auth.module.css";

export const metadata: Metadata = {
  title: "登录",
  alternates: { canonical: "/login" },
};

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
      title="登录"
      description="使用手机号和密码进入你的账号。"
      footer={
        <>
          还没有账号？ <Link href="/register">创建账号</Link>
          <div className={styles.filing}>
            <a
              href={ICP_RECORD.lookup}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ICP_RECORD.number}
            </a>
          </div>
        </>
      }
    >
      <LoginForm returnTo={returnTo} />
    </AuthShell>
  );
}
