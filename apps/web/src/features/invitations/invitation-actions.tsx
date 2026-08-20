"use client";

import { Alert, Button, Space } from "antd";
import { useState } from "react";

import type { ApiError } from "@/lib/api/api-error";
import { resolvePostLoginRoute } from "@/lib/auth/post-login-route";

import type { InvitationApi, PersonalInvitation } from "./invitation-api";

export interface InvitationActionsProps {
  invitation: PersonalInvitation;
  api: InvitationApi;
  onNavigate: (path: string) => void;
}

export function InvitationActions({
  invitation,
  api,
  onNavigate,
}: InvitationActionsProps) {
  const [pendingAction, setPendingAction] = useState<
    "accept" | "decline" | null
  >(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionable = invitation.status === "PENDING";
  const disabled = !actionable || pendingAction !== null || result !== null;

  async function accept() {
    setPendingAction("accept");
    setError(null);
    try {
      await api.accept(invitation.id);
      const workspaces = (await api.listWorkspaces()).filter(
        (workspace) =>
          workspace.tenantStatus === "ACTIVE" &&
          workspace.memberStatus === "ACTIVE",
      );
      setResult("邀请已接受，正在进入你的工作空间。 ");
      onNavigate(resolvePostLoginRoute({ workspaces, returnTo: null }));
    } catch (reason) {
      setError(errorMessage(reason));
      setPendingAction(null);
    }
  }

  async function decline() {
    setPendingAction("decline");
    setError(null);
    try {
      await api.decline(invitation.id);
      setResult("已拒绝该邀请。你仍可返回等待页查看其他邀请。");
    } catch (reason) {
      setError(errorMessage(reason));
      setPendingAction(null);
    }
  }

  return (
    <div>
      {result ? <Alert type="success" showIcon title={result} /> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <Space wrap>
        <Button
          type="primary"
          disabled={disabled}
          loading={pendingAction === "accept"}
          onClick={() => void accept()}
        >
          接受邀请
        </Button>
        <Button
          danger
          disabled={disabled}
          loading={pendingAction === "decline"}
          onClick={() => void decline()}
        >
          拒绝邀请
        </Button>
      </Space>
    </div>
  );
}

function errorMessage(reason: unknown): string {
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    return String((reason as Pick<ApiError, "message">).message);
  }
  return "操作未完成，请稍后重试。";
}
