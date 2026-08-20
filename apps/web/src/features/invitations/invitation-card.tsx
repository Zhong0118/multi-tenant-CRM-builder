import { ArrowRightOutlined } from "@ant-design/icons";
import { Button, Tag, Typography } from "antd";
import Link from "next/link";

import type { PersonalInvitation } from "./invitation-api";
import styles from "./invitations.module.css";

export function InvitationCard({
  invitation,
}: {
  invitation: PersonalInvitation;
}) {
  return (
    <article className={styles.invitationCard}>
      <div className={styles.cardRail} aria-hidden="true" />
      <div className={styles.cardMain}>
        <div>
          <Typography.Text className={styles.eyebrow}>
            PENDING ACCESS
          </Typography.Text>
          <Typography.Title level={3} className={styles.cardTitle}>
            {invitation.tenantName ?? "公司邀请"}
          </Typography.Title>
        </div>
        <Tag color="cyan">待接受</Tag>
      </div>
      <Typography.Paragraph type="secondary">
        拟授予角色：{invitation.role === "TENANT_ADMIN" ? "公司管理员" : "员工"}
        ・邀请人：{invitation.inviterName ?? "暂未提供"}
      </Typography.Paragraph>
      <Button type="link" className={styles.cardLink}>
        <Link href={`/invitations/${encodeURIComponent(invitation.id)}`}>
          查看并处理 <ArrowRightOutlined />
        </Link>
      </Button>
    </article>
  );
}
