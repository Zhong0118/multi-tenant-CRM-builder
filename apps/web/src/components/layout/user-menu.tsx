"use client";

import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import Link from "next/link";

import { useLogout } from "@/features/auth/logout-button";
import { maskPhone } from "@/features/tenants/mask-phone";

import styles from "./app-shell.module.css";
import type { ShellUser } from "./app-shell";

export function UserMenu({
  user,
  roleLabel,
  showWorkspaceSwitch = false,
}: {
  user: ShellUser;
  roleLabel: string;
  showWorkspaceSwitch?: boolean;
}) {
  const { logout } = useLogout();
  const avatar = user.displayName.trim().charAt(0) || "平";

  const items: MenuProps["items"] = [
    {
      key: "profile",
      disabled: true,
      label: (
        <div className={styles.userMeta}>
          <div>{user.displayName}</div>
          <div>{maskPhone(user.phone)}</div>
          <div>{roleLabel}</div>
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

  return (
    <Dropdown menu={{ items }} trigger={["click"]}>
      <button type="button" className={styles.userButton}>
        <span className={styles.avatar} aria-hidden>
          {avatar}
        </span>
        {roleLabel}
      </button>
    </Dropdown>
  );
}
