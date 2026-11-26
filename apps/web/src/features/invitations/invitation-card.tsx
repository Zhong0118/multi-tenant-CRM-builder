import { ArrowRightOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import Link from "next/link";


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
          {[
            invitation.role === "TENANT_ADMIN" ? "公司管理员" : "员工",
            invitation.inviterName ? `邀请人 ${invitation.inviterName}` : null,
            invitation.expiresAt ? `${formatExpiry(invitation.expiresAt)}前有效` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <Link className={styles.cardLink} href={`/invitations/${encodeURIComponent(invitation.id)}`}>
        查看邀请 <ArrowRightOutlined aria-hidden />
      </Link>
    </article>
  );
}

function formatExpiry(value: string) {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
