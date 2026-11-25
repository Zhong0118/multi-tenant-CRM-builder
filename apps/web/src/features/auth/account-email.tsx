"use client";

import { EllipsisOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Form, Input, Space, Switch } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusTag } from "@/components/workbench/status-tag";
import { SettingRow } from "@/components/layout/page";
import { emailApi, type EmailPurpose, type EmailStatus } from "./email-api";
import { normalizeFormError, useCountdown } from "./form-support";
import { PasswordField } from "./password-field";
import styles from "./auth.module.css";

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
  if (!available)
    return (
      <SettingRow label="邮箱" help="用于找回密码和接收安全提醒">
        <span className={styles.rowMuted}>邮件服务暂未开通</span>
      </SettingRow>
    );
  return (
    <>
      <SettingRow
        label="邮箱"
        help={
          status === "UNDELIVERABLE"
            ? "邮件无法投递，请重新验证邮箱"
            : status === "UNVERIFIED"
              ? "邮箱尚未验证，验证后才能找回密码"
              : "用于找回密码和接收安全提醒"
        }
      >
        {!mode ? (
          <div className={styles.rowValue}>
            <span className={styles.emailValue}>
              <span>{maskedEmail ?? "未绑定"}</span>
              {status === "VERIFIED" && (
                <StatusTag tone="success">已验证</StatusTag>
              )}
              {status === "UNVERIFIED" && (
                <StatusTag tone="warning">未验证</StatusTag>
              )}
              {status === "UNDELIVERABLE" && (
                <StatusTag tone="danger">无法投递</StatusTag>
              )}
            </span>
            <span className={styles.rowActions}>
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
                  <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                      items: [
                        {
                          key: "remove",
                          danger: true,
                          label: "解绑邮箱",
                          onClick: () => open("REMOVE"),
                        },
                      ],
                    }}
                  >
                    <Button
                      aria-label="更多邮箱操作"
                      icon={<EllipsisOutlined />}
                    />
                  </Dropdown>
                </>
              )}
            </span>
          </div>
        ) : (
          <Form
            className={styles.inlineForm}
            layout="vertical"
            onFinish={() => void execute(submit)}
            disabled={busy}
          >
            <p className={styles.inlineTitle}>{labels[mode]}</p>
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
            <div className={styles.inlineActions}>
              <Button
                onClick={() =>
                  void execute(async () => {
                    if (challenge) await emailApi.cancel(challenge.challengeId);
                    open();
                  })
                }
              >
                取消
              </Button>
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
            </div>
          </Form>
        )}
        {notice && (
          <Alert
            className={styles.rowNotice}
            type={notice.type}
            showIcon
            title={notice.text}
          />
        )}
      </SettingRow>
      <SettingRow
        label="新设备登录提醒"
        help={
          status === "VERIFIED"
            ? "在新设备上登录时，给你的邮箱发一封提醒"
            : "验证邮箱后可以开启"
        }
      >
        <Switch
          aria-label="新设备登录提醒"
          checked={device ?? false}
          disabled={busy || device === null || status !== "VERIFIED"}
          onChange={(value) =>
            void execute(async () => {
              await emailApi.device(value);
              setDevice(value);
            })
          }
        />
      </SettingRow>
    </>
  );
}
