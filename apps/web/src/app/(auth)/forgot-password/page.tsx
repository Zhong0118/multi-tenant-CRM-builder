import Link from "next/link";

import { AuthShell } from "@/features/auth/auth-shell";
import { PasswordResetForm } from "@/features/auth/password-reset-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="ACCOUNT / RECOVERY"
      title="重置密码"
      description="验证绑定手机号后设置新密码；完成后其他设备将退出登录。"
      footer={
        <>
          想起密码了？ <Link href="/login">返回登录</Link>
        </>
      }
    >
      <PasswordResetForm />
    </AuthShell>
  );
}
