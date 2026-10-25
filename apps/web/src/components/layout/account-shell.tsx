import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceThemeScope } from "@/components/theme/workspace-theme-scope";
import { LogoutButton } from "@/features/auth/logout-button";
import { LogoMark } from "@/features/landing/logo-mark";

import styles from "./account-shell.module.css";

/**
 * The frame for pages that belong to the person rather than a company: the
 * workspace chooser, waiting for an invitation, an invitation and account
 * security. A slim bar with the way back to work and out, then one 720px
 * column — the same width, palette and header grammar as the settings pages.
 */
export function AccountShell({
  current,
  platformAdmin = false,
  children,
}: {
  current?: "workspaces" | "security";
  /** Platform administrators get their way back to the 管理中心. */
  platformAdmin?: boolean;
  children: ReactNode;
}) {
  return (
    <WorkspaceThemeScope className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/workspaces" className={styles.brand}>
          <LogoMark className={styles.mark} />
          <span>百杰 CRM</span>
        </Link>
        <nav className={styles.nav} aria-label="账号">
          {platformAdmin ? <Link href="/platform">管理中心</Link> : null}
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
    </WorkspaceThemeScope>
  );
}
