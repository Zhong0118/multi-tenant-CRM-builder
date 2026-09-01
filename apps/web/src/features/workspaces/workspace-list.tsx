"use client";

import { ArrowRightOutlined, LockOutlined } from "@ant-design/icons";
import { Button, Tag, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { isActiveWorkspace, type WorkspaceView } from "./workspace-access";
import styles from "./workspaces.module.css";

export type { WorkspaceView } from "./workspace-access";

export interface WorkspaceListProps {
  workspaces: readonly WorkspaceView[];
  onNavigate?: (path: string) => void;
}

export function WorkspaceList({ workspaces, onNavigate }: WorkspaceListProps) {
  const router = useRouter();
  const sorted = useMemo(
    () => [...workspaces].sort(compareWorkspaces),
    [workspaces],
  );
  const active = sorted.filter(isActiveWorkspace);
  const soleActiveCode = active.length === 1 ? active[0].tenantCode : null;

  useEffect(() => {
    if (soleActiveCode) {
      (onNavigate ?? router.push)(
        `/workspace/${encodeURIComponent(soleActiveCode)}`,
      );
    }
  }, [onNavigate, router, soleActiveCode]);

  return (
    <div className={styles.workspaceList}>
      {sorted.map((workspace) => {
        const reason = inactiveReason(workspace);
        return (
          <article
            key={workspace.memberId}
            className={`${styles.workspaceCard} ${reason ? styles.inactive : ""}`}
          >
            <div className={styles.rail} aria-hidden="true" />
            <div className={styles.cardHeader}>
              <div>
                <Typography.Text className={styles.eyebrow}>
                  {reason ? "ACCESS PAUSED" : "VERIFIED WORKSPACE"}
                </Typography.Text>
                <Typography.Title level={3}>
                  {workspace.tenantName}
                </Typography.Title>
              </div>
              <Tag color={reason ? "default" : "cyan"}>
                {workspace.role === "TENANT_ADMIN" ? "公司管理员" : "员工"}
              </Tag>
            </div>
            {workspace.lastAccessedAt ? (
              <Typography.Paragraph type="secondary">
                最近访问：{formatDate(workspace.lastAccessedAt)}
              </Typography.Paragraph>
            ) : null}
            {reason ? (
              <div className={styles.reason}>
                <LockOutlined /> {reason}
              </div>
            ) : (
              <Button type="primary">
                <Link
                  aria-label={`进入${workspace.tenantName}`}
                  href={`/workspace/${encodeURIComponent(workspace.tenantCode)}`}
                >
                  进入工作区 <ArrowRightOutlined />
                </Link>
              </Button>
            )}
          </article>
        );
      })}
    </div>
  );
}

function inactiveReason(workspace: WorkspaceView): string | null {
  if (workspace.memberStatus === "DISABLED") return "你的成员资格已停用";
  if (workspace.tenantStatus === "SUSPENDED") return "公司工作区已暂停";
  if (workspace.tenantStatus === "DRAFT") return "等待平台启用公司";
  if (workspace.tenantStatus === "CLOSED") return "公司工作区已关闭";
  return null;
}

function compareWorkspaces(left: WorkspaceView, right: WorkspaceView): number {
  const activeDifference =
    Number(isActiveWorkspace(right)) - Number(isActiveWorkspace(left));
  if (activeDifference !== 0) return activeDifference;
  return (right.lastAccessedAt ?? "").localeCompare(left.lastAccessedAt ?? "");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
