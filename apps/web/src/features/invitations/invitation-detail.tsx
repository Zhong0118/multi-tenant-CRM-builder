"use client";

import { Alert, Descriptions, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";

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

const roleText: Record<PersonalInvitation["role"], string> = {
  TENANT_ADMIN: "公司管理员",
  EMPLOYEE: "员工",
};

const resultText: Partial<Record<PersonalInvitation["status"], string>> = {
  ACCEPTED: "该邀请已接受，你可以从工作空间列表进入公司。",
  DECLINED: "你已拒绝该邀请。如需加入，请联系公司管理员重新邀请。",
  REVOKED: "该邀请已由公司管理员撤销，无法继续处理。",
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
      <Alert
        type="warning"
        showIcon
        title="邀请不可用"
        description="该邀请不存在、已不属于当前账号，或无法继续处理。请联系公司管理员确认。"
      />
    );
  }

  return (
    <article className={styles.detail}>
      <div className={styles.statusRail} aria-hidden="true" />
      <header className={styles.detailHeader}>
        <div>
          <Typography.Text className={styles.eyebrow}>
            INVITATION RECORD
          </Typography.Text>
          <Typography.Title level={2}>
            {invitation.tenantName ?? "公司邀请"}
          </Typography.Title>
        </div>
        <Tag color={invitation.status === "PENDING" ? "cyan" : "default"}>
          {statusText[invitation.status]}
        </Tag>
      </header>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="拟授予角色">
          {roleText[invitation.role]}
        </Descriptions.Item>
        <Descriptions.Item label="邀请人">
          {invitation.inviterName ?? "暂未提供"}
        </Descriptions.Item>
        <Descriptions.Item label="有效期至">
          {formatDate(invitation.expiresAt)}
        </Descriptions.Item>
      </Descriptions>
      {resultText[invitation.status] ? (
        <Alert
          className={styles.stateResult}
          type={invitation.status === "ACCEPTED" ? "success" : "info"}
          showIcon
          title={resultText[invitation.status]}
        />
      ) : null}
      <div className={styles.actionArea}>
        <InvitationActions
          invitation={invitation}
          api={api}
          onNavigate={onNavigate ?? router.push}
        />
      </div>
    </article>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
