import type { PlatformTenant } from "./create-tenant-form";

export function tenantNextStep(tenant: PlatformTenant): string {
  if (tenant.status === "CLOSED") return "已关闭 · 查阅历史日志";
  if (tenant.status === "SUSPENDED") return "核对暂停原因后重新启用";
  if (tenant.status === "ACTIVE")
    return "由公司管理员配置、发布业务表并邀请员工";
  if (tenant.activeAdminCount > 0) return "管理员已就绪 · 可启用公司";
  const invitation = tenant.firstAdminInvitation;
  if (!invitation) return "尚未邀请管理员";
  if (invitation.status === "ACCEPTED") return "核对有效管理员，当前人数为 0";
  if (invitation.status === "PENDING") return "请受邀手机号登录并接受邀请";
  return "管理员邀请已失效 · 需重新邀请";
}
