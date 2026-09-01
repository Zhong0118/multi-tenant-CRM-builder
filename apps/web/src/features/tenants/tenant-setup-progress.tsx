import {
  ProcessRail,
  type ProcessStep,
} from "@/components/workbench/process-rail";

const invitationStatusText = {
  PENDING: "等待接受",
  ACCEPTED: "已接受",
  DECLINED: "已拒绝",
  REVOKED: "已撤销",
  EXPIRED: "已过期",
} as const;

export type TenantSetupInvitationStatus = keyof typeof invitationStatusText;
export type TenantSetupStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED";

export function buildTenantSetupSteps(input: {
  tenantStatus: TenantSetupStatus;
  invitationStatus?: TenantSetupInvitationStatus;
  activeAdminCount: number;
  objectCount: number;
}): ProcessStep[] {
  const invitationAccepted =
    input.invitationStatus === "ACCEPTED" || input.activeAdminCount > 0;
  const companyEnabled = input.tenantStatus === "ACTIVE";
  const hasObjects = input.objectCount > 0;

  return [
    {
      key: "created",
      label: "公司已创建",
      description: "草稿公司已建立，工作空间代码不可随意变更。",
      state: "complete",
    },
    {
      key: "invited",
      label: "邀请首位管理员",
      description: input.invitationStatus
        ? `邀请状态：${invitationStatusText[input.invitationStatus]}`
        : "尚未发出首位管理员邀请",
      state: input.invitationStatus ? "complete" : "current",
    },
    {
      key: "accepted",
      label: "管理员已接受",
      description: invitationAccepted
        ? `已有 ${input.activeAdminCount} 位有效公司管理员`
        : input.invitationStatus === "PENDING"
          ? "等待被邀请人注册或登录后接受"
          : input.invitationStatus
            ? `邀请${invitationStatusText[input.invitationStatus]}，无法启用`
            : "发出邀请后继续",
      state: invitationAccepted
        ? "complete"
        : input.invitationStatus
          ? "current"
          : "upcoming",
    },
    {
      key: "enabled",
      label: "公司已启用",
      description: companyEnabled
        ? "公司管理员可以进入工作空间"
        : invitationAccepted
          ? "管理员门槛已满足，可以启用公司"
          : "首位管理员接受后才会出现启用动作",
      state: companyEnabled
        ? "complete"
        : invitationAccepted
          ? "current"
          : "upcoming",
    },
    {
      key: "tables",
      label: "创建并发布业务表",
      description: hasObjects
        ? `已有 ${input.objectCount} 张业务表。发布后员工才能使用。`
        : companyEnabled
          ? "可由公司管理员手工创建，模板不是必选项"
          : "可选应用模板，或启用后由管理员手工创建",
      state: hasObjects ? "complete" : companyEnabled ? "current" : "upcoming",
    },
  ];
}

export function TenantSetupProgress(input: {
  tenantStatus: TenantSetupStatus;
  invitationStatus?: TenantSetupInvitationStatus;
  activeAdminCount: number;
  objectCount: number;
}) {
  return (
    <ProcessRail
      ariaLabel="公司开通进度"
      steps={buildTenantSetupSteps(input)}
    />
  );
}
