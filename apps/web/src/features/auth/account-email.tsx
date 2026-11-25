"use client";

import { Alert, Button, Form, Input, Space, Switch, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusTag } from "@/components/workbench/status-tag";
import { PageSection } from "@/components/layout/page";
import { emailApi, type EmailPurpose, type EmailStatus } from "./email-api";
import { normalizeFormError, useCountdown } from "./form-support";
import { PasswordField } from "./password-field";

type Operation = EmailPurpose | "REMOVE";
const labels: Record<Operation, string> = {
  BIND: "绑定邮箱",
  CHANGE: "换绑邮箱",
  REVERIFY: "重新验证",
  REMOVE: "解绑邮箱",
};

export function AccountEmail({
  status,
  maskedEmail,
  available,
  newDevice,
}: {
  status: EmailStatus;
  maskedEmail: string | null;
  available: boolean;
  newDevice: boolean | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Operation>();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    maskedEmail: string;
  }>();
  const [notice, setNotice] = useState<{
    type: "error" | "success";
    text: string;
  }>();
  const [device, setDevice] = useState(newDevice);
  const cooldown = useCountdown();
  function open(next?: Operation) {
    setMode(next);
    setChallenge(undefined);
    setEmail("");
    setPassword("");
    setCode("");
    setNotice(undefined);
    cooldown.reset();
  }
  async function execute(action: () => Promise<void>) {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
    } catch (error) {
      setNotice({ type: "error", text: normalizeFormError(error).message });
    } finally {
      setBusy(false);
    }
  }
  const needsPassword = mode === "CHANGE" || mode === "REMOVE";
  const needsEmail = mode === "BIND" || mode === "CHANGE";
  async function send() {
    if (!mode || mode === "REMOVE") return;
    const result = await emailApi.challenge({
      purpose: mode,
      ...(needsEmail ? { email: email.trim() } : {}),
      ...(needsPassword ? { currentPassword: password } : {}),
    });
    setChallenge(result);
    setCode("");
    cooldown.start();
  }
  async function submit() {
    if (!mode) return;
    if (mode === "REMOVE") await emailApi.remove(password);
    else if (challenge)
      await emailApi.verify({
        purpose: mode,
        challengeId: challenge.challengeId,
        code,
        ...(needsEmail ? { email: email.trim() } : {}),
        ...(needsPassword ? { currentPassword: password } : {}),
      });
    else return send();
    open();
    setNotice({
      type: "success",
      text: mode === "REMOVE" ? "邮箱已解绑" : "邮箱已验证",
    });
    router.refresh();
  }
  return (
    <PageSection
      title="邮箱"
      description={available ? "用于找回密码和接收安全提醒" : undefined}
    >
      {!available ? (
        <Typography.Text type="secondary">邮件服务暂未开通</Typography.Text>
      ) : (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text strong>
            {maskedEmail ?? "未绑定邮箱"}
          </Typography.Text>
          {status === "VERIFIED" && (
            <StatusTag tone="success">已验证</StatusTag>
          )}
          {status === "UNDELIVERABLE" && (
            <Alert
              type="warning"
              showIcon
              title="邮件无法投递，请重新验证邮箱"
            />
          )}
          {status === "UNVERIFIED" && (
            <Typography.Text type="secondary">邮箱尚未验证</Typography.Text>
          )}
          {!mode ? (
            <Space wrap>
              {status === "UNBOUND" ? (
                <Button type="primary" onClick={() => open("BIND")}>
                  绑定邮箱
                </Button>
              ) : (
                <>
                  {status !== "VERIFIED" && (
                    <Button type="primary" onClick={() => open("REVERIFY")}>
                      重新验证
                    </Button>
                  )}
                  <Button onClick={() => open("CHANGE")}>换绑邮箱</Button>
                  <Button danger onClick={() => open("REMOVE")}>
                    解绑邮箱
                  </Button>
                </>
              )}
            </Space>
          ) : (
            <Form
              layout="vertical"
              onFinish={() => void execute(submit)}
              disabled={busy}
            >
              <Typography.Title level={5}>{labels[mode]}</Typography.Title>
              {mode === "REMOVE" && (
                <Form.Item>
                  <Alert
                    showIcon
                    type="warning"
                    title="解绑后，邮箱找回和邮件通知将停止"
                  />
                </Form.Item>
              )}
              {needsEmail && (
                <Form.Item label="新邮箱" htmlFor="bind-mail">
                  <Input
                    id="bind-mail"
                    type="email"
                    autoComplete="email"
                    maxLength={320}
                    value={email}
                    disabled={busy || !!challenge}
                    required
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Form.Item>
              )}
              {needsPassword && (
                <Form.Item label="当前密码" htmlFor="mail-password">
                  <PasswordField
                    id="mail-password"
                    autoComplete="current-password"
                    value={password}
                    required
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Form.Item>
              )}
              {challenge && (
                <Form.Item
                  label="邮箱验证码"
                  htmlFor="bind-code"
                  extra={`已发送至 ${challenge.maskedEmail}，10 分钟内有效`}
                >
                  <Space.Compact block>
                    <Input
                      id="bind-code"
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <Button
                      disabled={busy || cooldown.seconds > 0}
                      onClick={() => void execute(send)}
                    >
                      {cooldown.seconds
                        ? `${cooldown.seconds} 秒后重发`
                        : "重新发送"}
                    </Button>
                  </Space.Compact>
                </Form.Item>
              )}
              <Space>
                <Button
                  type="primary"
                  danger={mode === "REMOVE"}
                  htmlType="submit"
                  loading={busy}
                >
                  {mode === "REMOVE"
                    ? "确认解绑"
                    : challenge
                      ? "完成验证"
                      : "发送验证码"}
                </Button>
                <Button
                  onClick={() =>
                    void execute(async () => {
                      if (challenge)
                        await emailApi.cancel(challenge.challengeId);
                      open();
                    })
                  }
                >
                  取消
                </Button>
              </Space>
            </Form>
          )}
          {status === "VERIFIED" && !mode && (
            <label>
              <Switch
                aria-label="新设备登录提醒"
                checked={device ?? false}
                disabled={busy || device === null}
                onChange={(value) =>
                  void execute(async () => {
                    await emailApi.device(value);
                    setDevice(value);
                  })
                }
              />
              　新设备登录提醒
            </label>
          )}
          {notice && <Alert type={notice.type} showIcon title={notice.text} />}
        </Space>
      )}
    </PageSection>
  );
}
