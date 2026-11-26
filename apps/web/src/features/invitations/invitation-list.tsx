"use client";

import { CheckOutlined, CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Tooltip } from "antd";
import { useCallback, useEffect, useState } from "react";

import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";

import type { PersonalInvitation } from "./invitation-api";
import { InvitationCard } from "./invitation-card";
import styles from "./invitations.module.css";

/** How often an open, visible page asks again while nothing has arrived. */
const POLL_MS = 20_000;

/** "+8618800009301" → "+86 188 0000 9301"; other numbers are left as given. */
export function spacedPhone(phone: string) {
  const local = /^\+86(\d{11})$/.exec(phone)?.[1];
  return local
    ? `+86 ${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`
    : phone;
}

/**
 * Before a person belongs to any company: where they are on the way in, the
 * number to give the company admin, and each invitation as soon as it
 * arrives. The page asks again on its own while it is open, so there is
 * nothing to explain and nothing to remember to refresh.
 */
export function InvitationList({
  phone,
  initialInvitations,
  initialError = null,
}: {
  phone: string;
  initialInvitations: PersonalInvitation[];
  initialError?: string | null;
}) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [copied, setCopied] = useState(false);
  const pending = invitations.filter(
    (invitation) => invitation.status === "PENDING",
  );
  const invited = pending.length > 0;

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const result = await browserApiClient.GET("/api/v1/me/invitations");
      if (result.data) {
        setInvitations(result.data as PersonalInvitation[]);
        setError(null);
      } else if (!quiet) {
        setError(toApiError(result.error, result.response.status).message);
      }
    } catch {
      if (!quiet) setError("刷新失败，请检查网络后重试。");
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  // Ask again when the person comes back to the tab, and now and then while
  // they wait on it.
  useEffect(() => {
    if (invited) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const timer = window.setInterval(onVisible, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [invited, refresh]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone.replace(/^\+86/, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.waiting}>
      <ol className={styles.progress} aria-label="进入工作区的步骤">
        <li data-state="done">
          <span aria-hidden>
            <CheckOutlined />
          </span>
          注册账号
        </li>
        <li data-state={invited ? "done" : "current"}>
          <span aria-hidden>{invited ? <CheckOutlined /> : 2}</span>
          收到邀请
        </li>
        <li data-state={invited ? "current" : "pending"}>
          <span aria-hidden>3</span>
          进入公司
        </li>
      </ol>
      <h1 className={styles.waitingTitle}>
        {invited ? "你收到了公司邀请" : "等待公司邀请"}
      </h1>
      <p className={styles.waitingLead}>
        {invited
          ? "接受后即可进入工作区。"
          : "把手机号发给公司管理员，邀请会出现在这里。"}
      </p>
      {error ? (
        <Alert
          className={styles.waitingAlert}
          type="error"
          showIcon
          title={error}
        />
      ) : null}
      <section className={styles.waitingGroup} aria-label="公司邀请">
        {invited ? (
          pending.map((invitation) => (
            <InvitationCard key={invitation.id} invitation={invitation} />
          ))
        ) : (
          <>
            <div className={styles.waitingRow}>
              <span>手机号</span>
              <strong>{spacedPhone(phone)}</strong>
              <Button
                size="small"
                icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                onClick={() => void copy()}
              >
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <div className={styles.waitingRow}>
              <span>公司邀请</span>
              <span className={styles.waitingMuted} role="status">
                {refreshing ? "正在查看…" : "还没有收到"}
              </span>
              <Tooltip title="现在查看">
                <Button
                  size="small"
                  type="text"
                  aria-label="刷新邀请"
                  icon={<ReloadOutlined />}
                  loading={refreshing}
                  onClick={() => void refresh()}
                />
              </Tooltip>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
