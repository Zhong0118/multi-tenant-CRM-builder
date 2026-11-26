"use client";

import { Alert, Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { StatePanel } from "@/components/workbench/state-panel";
import { StatusTag, type StatusTone } from "@/components/workbench/status-tag";

import { InvitationActions } from "./invitation-actions";
import {
  invitationApi,
  type InvitationApi,
  type PersonalInvitation,
} from "./invitation-api";
import styles from "./invitations.module.css";

export type { InvitationApi, PersonalInvitation } from "./invitation-api";

export interface InvitationDetailProps {
  invitation?: PersonalInvitation;
  unavailable?: boolean;
  api?: InvitationApi;
  onNavigate?: (path: string) => void;
}

const statusText: Record<PersonalInvitation["status"], string> = {
  PENDING: "等待处理",
  ACCEPTED: "已接受",
  DECLINED: "已拒绝",
  REVOKED: "已撤销",
  EXPIRED: "已过期",
};

const statusTone: Record<PersonalInvitation["status"], StatusTone> = {
  PENDING: "warning",
  ACCEPTED: "success",
  DECLINED: "neutral",
  REVOKED: "neutral",
  EXPIRED: "neutral",
};

const roleText: Record<PersonalInvitation["role"], string> = {
  TENANT_ADMIN: "公司管理员",
  EMPLOYEE: "员工",
};

const resultText: Partial<Record<PersonalInvitation["status"], string>> = {
  ACCEPTED: "该邀请已接受，公司启用后即可进入工作空间。",
  DECLINED: "你已拒绝该邀请。如需加入，请联系公司管理员重新邀请。",
  REVOKED: "该邀请已由公司管理员撤销。",
  EXPIRED: "该邀请已过期，请联系公司管理员重新邀请。",
};

export function InvitationDetail({
  invitation,
  unavailable = false,
  api = invitationApi,
  onNavigate,
}: InvitationDetailProps) {
  const router = useRouter();
  if (unavailable || !invitation) {
    return (
      <StatePanel
        tone="blocked"
        title="邀请不可用"
        description="该邀请不存在、已不属于当前账号，或无法继续处理。请联系公司管理员确认。"
        action={
          <Link href="/waiting">
            <Button>查看我的邀请</Button>
          </Link>
        }
      />
    );
  }

  const pending = invitation.status === "PENDING";
  return (
    // One centred panel, like the waiting page: who invites you, as what,
    // until when, and the two answers. What happens if the company is not
    // live yet is said after accepting, when it is known.
    <article className={styles.decision}>
      <span className={styles.decisionInitial} aria-hidden>
        {(invitation.tenantName ?? "邀").slice(0, 1)}
      </span>
      <h1 className={styles.waitingTitle}>
        {invitation.tenantName ?? "公司邀请"}
      </h1>
      <p className={styles.waitingLead}>
        邀请你以「{roleText[invitation.role]}」身份加入
        {invitation.inviterName ? `，邀请人 ${invitation.inviterName}` : ""}
        <br />
        {pending ? (
          <span className={styles.decisionMeta}>
            {formatDate(invitation.expiresAt)} 前有效
          </span>
        ) : (
          <StatusTag tone={statusTone[invitation.status]}>
            {statusText[invitation.status]}
          </StatusTag>
        )}
      </p>
      {resultText[invitation.status] ? (
        <Alert
          className={styles.stateResult}
          type={invitation.status === "ACCEPTED" ? "success" : "info"}
          showIcon
          title={resultText[invitation.status]}
        />
      ) : null}
      {pending ? (
        <div className={styles.decisionActions}>
          <InvitationActions
            invitation={invitation}
            api={api}
            onNavigate={onNavigate ?? router.push}
          />
        </div>
      ) : (
        <p className={styles.decisionBack}>
          <Link href="/waiting">返回公司邀请</Link>
        </p>
      )}
    </article>
  );
}

/** "12月3日 21:11", with the year only when it is not this year. */
function formatDate(value: string): string {
  const date = new Date(value);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const year =
    date.getFullYear() === new Date().getFullYear()
      ? ""
      : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
