import { AccountShell } from "@/components/layout/account-shell";
import { PageHeader } from "@/components/layout/page-header";
import type { PersonalInvitation } from "@/features/invitations/invitation-api";
import { InvitationList } from "@/features/invitations/invitation-list";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";

import styles from "../account.module.css";

/**
 * After registering, a person belongs to no company yet. The page says where
 * they are in the three steps to a workspace and shows any invitation the
 * moment it arrives, instead of a bare greeting over an empty list.
 */
export default async function WaitingPage() {
  const user = await requireUser("/waiting");
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET("/api/v1/me/invitations");
  const initialError = data ? null : toApiError(error, response.status).message;
  const invited = (data ?? []).some((invitation) => invitation.status === "PENDING");

  return (
    <AccountShell platformAdmin={user.isPlatformAdmin}>
      <PageHeader
        title={`你好，${user.displayName}`}
        description="个人账号已经准备好，下一步是加入你的公司。"
      />
      <ol className={styles.steps} aria-label="进入工作区的步骤">
        <li data-state="done">
          <span className={styles.stepMark} aria-hidden>
            ✓
          </span>
          <div>
            <strong>注册个人账号</strong>
            <p>已完成，账号手机号 {user.phone}</p>
          </div>
        </li>
        <li data-state={invited ? "done" : "current"}>
          <span className={styles.stepMark} aria-hidden>
            {invited ? "✓" : 2}
          </span>
          <div>
            <strong>等待公司邀请</strong>
            <p>请公司管理员在「设置 · 成员」里按这个手机号邀请你，邀请会出现在下方。</p>
          </div>
        </li>
        <li data-state={invited ? "current" : "pending"}>
          <span className={styles.stepMark} aria-hidden>3</span>
          <div>
            <strong>接受邀请，进入工作区</strong>
            <p>如果公司还在开通中，接受后需等平台启用才能进入，这不是权限问题。</p>
          </div>
        </li>
      </ol>
      <InvitationList
        initialInvitations={(data ?? []) as PersonalInvitation[]}
        initialError={initialError}
      />
    </AccountShell>
  );
}
