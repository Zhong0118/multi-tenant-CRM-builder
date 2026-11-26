"use client";

import { EllipsisOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Form, Input, Space, Switch } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusTag } from "@/components/workbench/status-tag";
import { SettingRow } from "@/components/layout/page";
import { emailApi, type EmailPurpose, type EmailStatus } from "./email-api";
import { normalizeFormError, useCountdown, waitText } from "./form-support";
import { PasswordField } from "./password-field";
import styles from "./auth.module.css";

type Operation = EmailPurpose | "REMOVE";

/**
 * A sent code outlives the form: closing it or reloading the page keeps the
 * challenge for its 10 minutes, so the code already in the inbox can still be
 * entered. The password is never stored; it is asked for again.
 */
const PENDING_KEY = "crm:email-challenge";
const SENT_KEY = "crm:email-sent-at";
const CODE_LIFETIME = 10 * 60_000;
const RESEND_AFTER = 60_000;
interface Pending {
  purpose: EmailPurpose;
  email: string;
  challengeId: string;
  maskedEmail: string;
  sentAt: number;
}
function readPending(purpose: EmailPurpose): Pending | undefined {
  try {
    const pending = JSON.parse(
      window.sessionStorage.getItem(PENDING_KEY) ?? "null",
    ) as Pending | null;
    return pending?.purpose === purpose &&
      Date.now() - pending.sentAt < CODE_LIFETIME
      ? pending
      : undefined;
  } catch {
    return undefined;
  }
}
function writePending(pending?: Pending) {
  try {
    if (pending) {
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      window.sessionStorage.setItem(SENT_KEY, String(pending.sentAt));
    } else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* Private mode: the form simply starts over. */
  }
}
function resendWait(): number {
  try {
    const sentAt = Number(window.sessionStorage.getItem(SENT_KEY));
    return sentAt ? (RESEND_AFTER - (Date.now() - sentAt)) / 1000 : 0;
  } catch {
    return 0;
  }
}
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
  // A refresh after a change brings the new server setting; follow it.
  const [serverDevice, setServerDevice] = useState(newDevice);
  if (serverDevice !== newDevice) {
    setServerDevice(newDevice);
    setDevice(newDevice);
  }
  const cooldown = useCountdown();
  function open(next?: Operation) {
    const pending = next && next !== "REMOVE" ? readPending(next) : undefined;
    setMode(next);
    setChallenge(
      pending
        ? { challengeId: pending.challengeId, maskedEmail: pending.maskedEmail }
        : undefined,
    );
    setEmail(pending?.email ?? "");
    setPassword("");
    setCode("");
    setNotice(undefined);
    if (next) cooldown.start(resendWait());
    else cooldown.reset();
  }
  async function execute(action: () => Promise<void>) {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
    } catch (error) {
      const apiError = normalizeFormError(error);
      const limited = apiError.code === "RATE_LIMITED";
      // The server names the limit that was hit and when it lifts; the send
      // button waits that long. A code already sent is only mentioned when
      // there is one, next to the box it goes in.
      if (limited && apiError.retryAfterSeconds)
        cooldown.start(apiError.retryAfterSeconds);
      setNotice({
        type: "error",
        text:
          limited && challenge
            ? `${apiError.message}已经收到的验证码 10 分钟内仍然有效，可以直接填写。`
            : apiError.message,
      });
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
    writePending({
      purpose: mode,
      email: email.trim(),
      challengeId: result.challengeId,
      maskedEmail: result.maskedEmail,
      sentAt: Date.now(),
    });
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
    const address = email.trim();
    writePending();
    open();
    // Say which address is now on the account: the masked row alone can
    // look the same before and after.
    setNotice({
      type: "success",
      text:
        mode === "REMOVE"
          ? "邮箱已解绑"
          : mode === "CHANGE"
            ? `邮箱已换成 ${address}`
            : mode === "BIND"
              ? `已绑定并验证 ${address}`
              : "邮箱已验证",
    });
    router.refresh();
  }
  if (!available)
    return (
      <SettingRow label="邮箱">
        <span className={styles.rowMuted}>邮件服务暂未开通</span>
      </SettingRow>
    );
  return (
    <>
      <SettingRow
        label="邮箱"
        // A line only when something needs doing; the tag beside the
        // address already says which state it is in.
        help={
          status === "UNDELIVERABLE"
            ? "邮件无法投递，请重新验证"
            : status === "UNVERIFIED"
              ? "验证后才能用邮箱找回密码"
              : undefined
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
            <p className={styles.inlineTitle}>
              {labels[mode]}
              {maskedEmail && mode !== "BIND" && (
                <span className={styles.inlineTitleMeta}>
                  当前 {maskedEmail}
                </span>
              )}
            </p>
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
              <Form.Item
                label="当前密码"
                htmlFor="mail-password"
                // A code sent before a refresh comes back, the password
                // never does (it is not kept in the browser): say so.
                extra={
                  challenge && !password
                    ? "验证码还在，刷新后需要重新输入当前密码"
                    : undefined
                }
              >
                <PasswordField
                  id="mail-password"
                  autoComplete="current-password"
                  autoFocus={!!challenge}
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
                      ? `${waitText(cooldown.seconds)}后重发`
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
                    writePending();
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
                disabled={
                  mode !== "REMOVE" && !challenge && cooldown.seconds > 0
                }
              >
                {mode === "REMOVE"
                  ? "确认解绑"
                  : challenge
                    ? "完成验证"
                    : cooldown.seconds > 0
                      ? `${waitText(cooldown.seconds)}后可发送`
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
        help={status === "VERIFIED" ? undefined : "验证邮箱后可开启"}
      >
        {/* The switch sits in the same right-hand action column as the
            buttons in the rows above. */}
        <div className={styles.rowSwitch}>
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
        </div>
      </SettingRow>
    </>
  );
}
