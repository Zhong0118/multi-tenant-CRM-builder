import { Button } from "antd";
import Link from "next/link";

import { LogoutButton } from "@/features/auth/logout-button";
import type { PersonalInvitation } from "@/features/invitations/invitation-api";
import { InvitationList } from "@/features/invitations/invitation-list";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";

import styles from "../account.module.css";

export default async function WaitingPage() {
  const user = await requireUser("/waiting");
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET("/api/v1/me/invitations");
  const initialError = data ? null : toApiError(error, response.status).message;

  return (
    <main className={styles.accountPage}>
      <header className={styles.accountHeader}>
        <div>
          <span className={styles.eyebrow}>ACCOUNT READY</span>
          <h1>你好，{user.displayName}</h1>
          <p>
            个人账号已经准备好。接受邀请后，若公司仍是草稿，需要等待平台启用，才能进入工作空间。这不是权限错误。
          </p>
        </div>
        <div className={styles.accountActions}>
          <Button>
            <Link href="/account/security">账号安全</Link>
          </Button>
          <LogoutButton />
        </div>
      </header>
      <div className={styles.accountContent}>
        <InvitationList
          initialInvitations={(data ?? []) as PersonalInvitation[]}
          initialError={initialError}
        />
      </div>
    </main>
  );
}
