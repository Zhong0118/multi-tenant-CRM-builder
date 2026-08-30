import { ProcessRail, type ProcessStep } from "@/components/workbench/process-rail";

export function TenantSetupProgress({
  invitationAccepted,
  activeAdminCount,
  objectCount,
  canApplyTemplate,
}: {
  invitationAccepted: boolean;
  activeAdminCount: number;
  objectCount: number;
  canApplyTemplate: boolean;
}) {
  const hasObjects = objectCount > 0;
  const steps: ProcessStep[] = [
    {
      key: "company",
      label: "公司已创建",
      description: invitationAccepted
        ? "首位管理员已接受邀请"
        : "管理员邀请等待接受",
      state: "complete",
    },
    {
      key: "tables",
      label: "初始化业务表",
      description: hasObjects
        ? `已生成 ${objectCount} 个业务表草稿`
        : canApplyTemplate
          ? "请选择一套已发布模板"
          : "当前状态暂不能初始化",
      state: hasObjects ? "complete" : "current",
    },
    {
      key: "publish",
      label: "公司管理员配置并发布",
      description: hasObjects
        ? activeAdminCount > 0
          ? "等待管理员审核并发布"
          : "等待管理员接受邀请后继续"
        : "初始化业务表后继续",
      state: hasObjects ? "current" : "upcoming",
    },
  ];

  return <ProcessRail ariaLabel="公司配置进度" steps={steps} />;
}
