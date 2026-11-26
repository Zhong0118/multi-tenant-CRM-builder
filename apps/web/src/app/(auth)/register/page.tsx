import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/auth-shell";
import { RegisterForm } from "@/features/auth/register-form";

export const metadata: Metadata = {
  title: "创建账号",
  alternates: { canonical: "/register" },
};

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="ACCOUNT / 01"
      title="创建个人账号"
      footer={
        <>
          已有账号？ <Link href="/login">直接登录</Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
