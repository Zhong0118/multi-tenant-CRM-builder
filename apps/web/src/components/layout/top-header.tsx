"use client";

import { MenuOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

import { UserMenu } from "./user-menu";
import type { ShellUser } from "./app-shell";
import styles from "./app-shell.module.css";

export function TopHeader({
  headerLeft,
  headerActions,
  user,
  roleLabel,
  showWorkspaceSwitch,
  onOpenNavigation,
}: {
  headerLeft: ReactNode;
  headerActions?: ReactNode;
  user: ShellUser;
  roleLabel: string;
  showWorkspaceSwitch?: boolean;
  onOpenNavigation: () => void;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeading}>
        <button
          type="button"
          className={styles.mobileMenuButton}
          aria-label="打开导航"
          onClick={onOpenNavigation}
        >
          <MenuOutlined />
        </button>
        <div>{headerLeft}</div>
      </div>
      <div className={styles.headerActions}>
        {headerActions}
        <UserMenu
          user={user}
          roleLabel={roleLabel}
          showWorkspaceSwitch={showWorkspaceSwitch}
        />
      </div>
    </header>
  );
}
