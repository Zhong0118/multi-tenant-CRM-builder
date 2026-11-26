"use client";

import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  HomeOutlined,
  MailOutlined,
  SafetyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import { AppShell, type ShellNavGroup, type ShellUser } from "./app-shell";
import { Page } from "./page";

/**
 * The frame for pages that belong to the person rather than a company: the
 * workspace chooser, waiting for an invitation, an invitation, the profile
 * and account security. It is the same sidebar as the workspace — brand at
 * the top, the person at the foot — so moving between work and account never
 * feels like leaving the product.
 */
export function AccountShell({
  current,
  user,
  children,
}: {
  current?: "workspaces" | "profile" | "security";
  user: ShellUser;
  children: ReactNode;
}) {
  const inAccount = current === "profile" || current === "security";
  const navGroups: ShellNavGroup[] = [
    inAccount
      ? {
          ariaLabel: "返回",
          hideLabel: true,
          items: [
            {
              href: "/workspaces",
              label: "返回工作区",
              icon: <ArrowLeftOutlined />,
              subtle: true,
            },
          ],
        }
      : {
          ariaLabel: "开始",
          hideLabel: true,
          items: [
            {
              href: "/workspaces",
              label: "我的工作区",
              icon: <HomeOutlined />,
            },
            { href: "/waiting", label: "公司邀请", icon: <MailOutlined /> },
          ],
        },
    {
      ariaLabel: "账号",
      items: [
        { href: "/account/profile", label: "个人资料", icon: <UserOutlined /> },
        {
          href: "/account/security",
          label: "账号安全",
          icon: <SafetyOutlined />,
        },
      ],
    },
  ];
  return (
    <AppShell
      brand="百杰 CRM"
      brandHref="/workspaces"
      navGroups={navGroups}
      footerItems={
        user.isPlatformAdmin
          ? [
              {
                href: "/platform",
                label: "管理中心",
                icon: <AppstoreOutlined />,
              },
            ]
          : []
      }
      user={user}
      roleLabel={user.isPlatformAdmin ? "平台超级管理员" : "个人账号"}
    >
      {/* The settings width, as in company settings: wide enough for two
          groups side by side instead of one narrow column. */}
      <Page width="settings">{children}</Page>
    </AppShell>
  );
}
