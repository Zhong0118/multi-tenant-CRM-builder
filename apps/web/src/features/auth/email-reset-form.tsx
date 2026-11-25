"use client";

import { Alert, Button, Form, Input, Segmented, Space } from "antd";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { emailApi } from "./email-api";
import { normalizeFormError, useCountdown } from "./form-support";
import { PasswordField } from "./password-field";
import { PasswordResetForm } from "./password-reset-form";
import { passwordSchema, verificationCodeSchema } from "./schemas";
import styles from "./auth.module.css";

export function ResetMethods({ mailAvailable }: { mailAvailable: boolean }) {
  const [method, setMethod] = useState("手机号");
  return (
    <div className={styles.resetMethods}>
      {mailAvailable && (
        <Segmented
          aria-label="找回方式"
          options={["手机号", "邮箱"]}
          value={method}
          onChange={setMethod}
        />
      )}
      {mailAvailable && method === "邮箱" ? (
        <EmailResetForm />
      ) : (
        <PasswordResetForm />
      )}
    </div>
  );
}

export function EmailResetForm() {
  const router = useRouter(),
    cooldown = useCountdown();
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [newPassword, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(resend = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!challenge || resend) {
        const result = await emailApi.forgot(email.trim());
        setChallenge(result.challengeId);
        setCode("");
        cooldown.start();
      } else {
        const validation = verificationCodeSchema.safeParse(code);
        const password = passwordSchema.safeParse(newPassword);
        if (!validation.success) {
          setError(validation.error.issues[0].message);
          return;
        }
        if (!password.success) {
          setError(password.error.issues[0].message);
          return;
        }
        await emailApi.reset({
          email: email.trim(),
          code,
          newPassword,
          challengeId: challenge,
        });
        router.push("/login?reset=done");
      }
    } catch (e) {
      setError(normalizeFormError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Form
      className={styles.authForm}
      layout="vertical"
      onFinish={() => void submit()}
      disabled={busy}
    >
      <Form.Item label="邮箱" htmlFor="recovery-email">
        <Input
          id="recovery-email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          value={email}
          disabled={busy || !!challenge}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Form.Item>
      {challenge && (
        <>
          <Form.Item>
            <Alert
              showIcon
              type="info"
              title="如果这个邮箱已绑定账号，你会收到验证码"
            />
          </Form.Item>
          <Form.Item label="验证码" htmlFor="recovery-code">
            <Space.Compact block>
              <Input
                id="recovery-code"
                required
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button
                disabled={busy || cooldown.seconds > 0}
                onClick={() => void submit(true)}
              >
                {cooldown.seconds ? `${cooldown.seconds} 秒后重发` : "重新发送"}
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item
            label="设置新密码"
            htmlFor="recovery-password"
            extra="10–72 位，同时包含字母和数字"
          >
            <PasswordField
              id="recovery-password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Form.Item>
        </>
      )}
      {error && (
        <Form.Item>
          <Alert type="error" showIcon title={error} />
        </Form.Item>
      )}
      <Button type="primary" block htmlType="submit" loading={busy}>
        {challenge ? "重置密码" : "获取验证码"}
      </Button>
      {challenge && (
        <Button
          type="link"
          onClick={() => {
            setChallenge(undefined);
            setCode("");
            setPassword("");
            setError("");
            cooldown.reset();
          }}
        >
          更换邮箱
        </Button>
      )}
    </Form>
  );
}
