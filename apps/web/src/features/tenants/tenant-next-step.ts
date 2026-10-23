import type { PlatformTenant } from "./create-tenant-form";

/**
 * The one thing that has to happen next for a company, and who does it.
 * Configuration states come from the company's own tables, read by the
 * platform without editing them.
 */
export function tenantNextStep(tenant: PlatformTenant): string {
  if (tenant.status === "CLOSED") return "已关闭 · 查阅历史日志";
  if (tenant.status === "SUSPENDED") return "核对暂停原因后重新启用";
  if (tenant.status === "ACTIVE") return activeNextStep(tenant);
  if (tenant.activeAdminCount > 0) return "管理员已就绪 · 可启用公司";
  const invitation = tenant.firstAdminInvitation;
  if (!invitation) return "尚未邀请管理员";
  if (invitation.status === "ACCEPTED") return "核对有效管理员，当前人数为 0";
  if (invitation.status === "PENDING") return "请受邀手机号登录并接受邀请";
  return "管理员邀请已失效 · 需重新邀请";
}

function activeNextStep(tenant: PlatformTenant): string {
  const tables = tenant.configuration?.tables;
  if (!tables) return "由公司管理员配置、发布业务表并邀请员工";
  if (tables.total === 0)
    return "尚未初始化 · 可应用模板，或由公司管理员搭建业务表";
  if (tables.published === 0)
    return tenant.configuration?.template
      ? "模板已复制为草稿 · 等公司管理员检查并发布"
      : "业务表都是草稿 · 等公司管理员发布";
  if (tables.pendingChanges > 0)
    return `${tables.pendingChanges} 张表有未发布的修改 · 由公司管理员发布`;
  return "已在使用 · 由公司管理员维护业务表和员工";
}

/** 业务配置: how many tables are in each state, and where they came from. */
export function tenantConfigurationText(tenant: PlatformTenant): {
  summary: string;
  provenance?: string;
} {
  const configuration = tenant.configuration;
  if (!configuration) return { summary: "—" };
  const { tables, template } = configuration;
  const provenance = template
    ? `模板「${template.name}」v${template.versionNo}`
    : undefined;
  if (tables.total === 0) return { summary: "未初始化", provenance };
  const parts = [
    tables.published ? `已发布 ${tables.published}` : null,
    tables.pendingChanges ? `其中待发布修改 ${tables.pendingChanges}` : null,
    tables.draft ? `草稿 ${tables.draft}` : null,
    tables.archived ? `已停用 ${tables.archived}` : null,
  ].filter(Boolean);
  return { summary: parts.join(" · "), provenance };
}
