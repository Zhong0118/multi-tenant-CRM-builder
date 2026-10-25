import { ArrowRightOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import Link from "next/link";

import { StatusTag } from "@/components/workbench/status-tag";

import type { PersonalInvitation } from "./invitation-api";
import styles from "./invitations.module.css";

export function InvitationCard({
  invitation,
}: {
  invitation: PersonalInvitation;
}) {
  return (
    <article className={styles.invitationRow}>
      <span className={styles.invitationInitial} aria-hidden>
        {(invitation.tenantName ?? "邀").slice(0, 1)}
      </span>
      <div className={styles.invitationText}>
        <Typography.Title level={3} className={styles.cardTitle}>
          {invitation.tenantName ?? "公司邀请"}
        </Typography.Title>
        <span>
          {invitation.role === "TENANT_ADMIN" ? "公司管理员" : "员工"}
          ・邀请人 {invitation.inviterName ?? "暂未提供"}
          {invitation.expiresAt ? `・${formatExpiry(invitation.expiresAt)} 前有效` : null}
        </span>
      </div>
      <StatusTag tone="warning">待接受</StatusTag>
      <Link className={styles.cardLink} href={`/invitations/${encodeURIComponent(invitation.id)}`}>
        查看并处理 <ArrowRightOutlined aria-hidden />
      </Link>
    </article>
  );
}

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}
