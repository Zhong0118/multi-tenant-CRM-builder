import Link from "next/link";

import styles from "@/features/auth/auth.module.css";
import { SessionList } from "@/features/auth/session-list";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";

export default async function AccountSecurityPage() {
  const user = await requireUser("/account/security");
  const client = await createServerApiClient();
  const {
    data: sessions,
    error,
    response,
  } = await client.GET("/api/v1/me/sessions");

  if (!sessions) {
    const apiError = toApiError(error, response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }

  return (
    <main className={styles.securityPage}>
      <header className={styles.securityHeader}>
        <span className={styles.eyebrow}>ACCOUNT / SECURITY</span>
        <h1>账号安全</h1>
        <p>
          {user.displayName} · {user.phone}　
          <Link href="/workspaces">返回工作区</Link>
        </p>
      </header>
      <SessionList initialSessions={sessions} />
    </main>
  );
}
