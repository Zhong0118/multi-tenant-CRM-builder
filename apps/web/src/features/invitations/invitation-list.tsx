"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty } from "antd";
import { useState } from "react";

import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";

import type { PersonalInvitation } from "./invitation-api";
import { InvitationCard } from "./invitation-card";
import styles from "./invitations.module.css";

export function InvitationList({
  initialInvitations,
  initialError = null,
}: {
  initialInvitations: PersonalInvitation[];
  initialError?: string | null;
}) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const pending = invitations.filter(
    (invitation) => invitation.status === "PENDING",
  );

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const result = await browserApiClient.GET("/api/v1/me/invitations");
      if (result.data) {
        setInvitations(result.data);
      } else {
        setError(toApiError(result.error, result.response.status).message);
      }
    } catch {
      setError("刷新失败，请检查网络后重试。");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section aria-labelledby="pending-invitations">
      <div className={styles.listHeader}>
        <h2 id="pending-invitations">待接受邀请</h2>
        <Button
          icon={<ReloadOutlined />}
          loading={refreshing}
          onClick={() => void refresh()}
        >
          刷新
        </Button>
      </div>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {pending.length > 0 ? (
        <div className={styles.cardGrid}>
          {pending.map((invitation) => (
            <InvitationCard key={invitation.id} invitation={invitation} />
          ))}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="请联系公司管理员按此手机号邀请你。"
        />
      )}
    </section>
  );
}
