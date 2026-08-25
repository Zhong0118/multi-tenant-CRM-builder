"use client";

import type { ReactNode } from "react";

import { UserMenu } from "./user-menu";
import type { ShellUser } from "./app-shell";
import styles from "./app-shell.module.css";

export function TopHeader({
  headerLeft,
  user,
  roleLabel,
  showWorkspaceSwitch,
}: {
  headerLeft: ReactNode;
  user: ShellUser;
  roleLabel: string;
  showWorkspaceSwitch?: boolean;
}) {
  return (
    <header className={styles.header}>
      <div>{headerLeft}</div>
      <UserMenu
        user={user}
        roleLabel={roleLabel}
        showWorkspaceSwitch={showWorkspaceSwitch}
      />
    </header>
  );
}
