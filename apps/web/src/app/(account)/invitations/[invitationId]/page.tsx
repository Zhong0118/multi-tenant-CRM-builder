import { Button } from "antd";
import Link from "next/link";

import { InvitationDetail } from "@/features/invitations/invitation-detail";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";

import styles from "../../account.module.css";

export interface InvitationPageProps {
  params: Promise<{ invitationId: string }>;
}

export default async function InvitationPage({ params }: InvitationPageProps) {
  const { invitationId } = await params;
  await requireUser(`/invitations/${encodeURIComponent(invitationId)}`);
  const client = await createServerApiClient();
  const { data, response } = await client.GET(
    "/api/v1/me/invitations/{invitationId}",
    { params: { path: { invitationId } } },
  );

  if (!data && response.status >= 500) {
    throw new Error("邀请详情暂时不可用。");
  }

  return (
    <main className={styles.accountPage}>
      <header className={styles.accountHeader}>
        <div>
          <span className={styles.eyebrow}>ACCESS REVIEW</span>
          <h1>确认公司邀请</h1>
          <p>
            接受前请核对公司、角色与有效期。只有与当前账号匹配的邀请才会展示详情。
          </p>
        </div>
        <Button>
          <Link href="/waiting">返回等待页</Link>
        </Button>
      </header>
      <div className={`${styles.accountContent} ${styles.detailWidth}`}>
        <InvitationDetail invitation={data} unavailable={!data} />
      </div>
    </main>
  );
}
