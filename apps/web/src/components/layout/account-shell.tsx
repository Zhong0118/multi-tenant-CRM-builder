import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/features/auth/logout-button";

import styles from "./account-shell.module.css";

/**
 * The frame for pages that belong to the person rather than a company: the
 * workspace chooser, waiting for an invitation, an invitation and account
 * security. A slim bar with the way back to work and out, then one 720px
 * column — the same width and header grammar as the settings pages.
 */
export function AccountShell({
  current,
  children,
}: {
  current?: "workspaces" | "security";
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/workspaces" className={styles.brand}>
          <span className={styles.mark} aria-hidden>
            C
          </span>
          <span>CRM 工作空间</span>
        </Link>
        <nav className={styles.nav} aria-label="账号">
          <Link href="/workspaces" aria-current={current === "workspaces" ? "page" : undefined}>
            我的工作区
          </Link>
          <Link href="/account/security" aria-current={current === "security" ? "page" : undefined}>
            账号安全
          </Link>
          <LogoutButton />
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
