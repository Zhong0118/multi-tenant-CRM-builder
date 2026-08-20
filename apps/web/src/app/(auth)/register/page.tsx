import Link from "next/link";

import { AuthShell } from "@/features/auth/auth-shell";
import { RegisterForm } from "@/features/auth/register-form";

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="ACCOUNT / 01"
      title="创建个人账号"
      description="账号先独立存在；公司管理员邀请后，你即可进入对应工作区。"
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
