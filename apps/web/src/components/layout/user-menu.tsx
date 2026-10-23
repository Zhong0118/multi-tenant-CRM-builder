"use client";

import { Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import Link from "next/link";

import { useLogout } from "@/features/auth/logout-button";
import { maskPhone } from "@/features/tenants/mask-phone";

import styles from "./app-shell.module.css";
import type { ShellUser } from "./app-shell";

/**
 * The signed-in member at the foot of the sidebar. The menu opens upward and
 * carries every account action, so there is no separate sign-out button.
 */
export function UserMenu({
  user,
  roleLabel,
  showWorkspaceSwitch = false,
  collapsed = false,
}: {
  user: ShellUser;
  roleLabel: string;
  showWorkspaceSwitch?: boolean;
  collapsed?: boolean;
}) {
  const { logout } = useLogout();
  const avatar = user.displayName.trim().charAt(0) || "平";

  const items: MenuProps["items"] = [
    {
      key: "profile",
      disabled: true,
      label: (
        <div className={styles.userMeta}>
          <div className={styles.userName}>{user.displayName}</div>
          <div className={styles.userPhone}>{maskPhone(user.phone)}</div>
          <div className={styles.userRole}>{roleLabel}</div>
        </div>
      ),
    },
    { type: "divider" },
    {
      key: "security",
      label: <Link href="/account/security">账号与安全</Link>,
    },
    ...(showWorkspaceSwitch
      ? [
          {
            key: "switch-workspace",
            label: <Link href="/workspaces">切换工作空间</Link>,
          },
        ]
      : []),
    { type: "divider" },
    {
      key: "logout",
      label: "退出登录",
      onClick: () => {
        void logout();
      },
    },
  ];

  const trigger = (
    <button
      type="button"
      className={styles.userButton}
      aria-label={collapsed ? `${user.displayName}，${roleLabel}` : undefined}
    >
      <span className={styles.avatar} aria-hidden>
        {avatar}
      </span>
      {collapsed ? null : (
        <span className={styles.userTrigger}>
          <span className={styles.userName}>{user.displayName}</span>
          <span className={styles.userRole}>{roleLabel}</span>
        </span>
      )}
    </button>
  );

  // The tooltip wraps the dropdown, not the other way round: a Dropdown needs
  // its trigger as the direct child to receive the click.
  const menu = (
    <Dropdown menu={{ items }} trigger={["click"]} placement="topLeft">
      {trigger}
    </Dropdown>
  );
  return collapsed ? (
    <Tooltip title={user.displayName} placement="right">
      {menu}
    </Tooltip>
  ) : (
    menu
  );
}
