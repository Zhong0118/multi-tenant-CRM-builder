import Link from "next/link";
import { notFound } from "next/navigation";

import { Page, PageSection } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { NavIcon } from "@/components/navigation/nav-icon";
import { workspaceSettingsNavigation } from "@/components/navigation/workspace-navigation";
import styles from "@/features/settings/workspace-settings.module.css";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface WorkspaceSettingsPageProps {
  params: Promise<{ tenantCode: string }>;
}

/** One line on what each settings page is for, shown under its name. */
const DESCRIPTIONS: Record<string, string> = {
  members: "邀请成员，调整角色、访问权限和离职交接。",
  object: "创建业务表，配置字段、列表和员工权限，发布后员工可用。",
  relation: "业务表之间的关联，以及跨表创建记录的自动化。",
  stats: "管理工作台的指标、分布和列表。",
  audit: "成员、业务表和记录的每一次变更。",
};

/**
 * The settings home: the same groups as the settings sidebar, one row per page
 * with what it is for and where it stands (Linear, Attio). Replaces a mosaic of
 * cards whose uneven heights left half the screen empty.
 */
export default async function WorkspaceSettingsPage({
  params,
}: WorkspaceSettingsPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  const client = await createServerApiClient();
  const [objects, members] = await Promise.all([
    client.GET("/api/v1/workspaces/{tenantCode}/object-definitions", {
      params: { path: { tenantCode } },
    }),
    client.GET("/api/v1/workspaces/{tenantCode}/members", {
      params: { path: { tenantCode }, query: { page: 1, limit: 1 } },
    }),
  ]);
  const drafts = objects.data ?? [];
  const active = drafts.filter((draft) => draft.object.status === "ACTIVE").length;
  const pending = drafts.filter((draft) => draft.object.hasUnpublishedChanges).length;
  const values: Record<string, string | undefined> = {
    members: members.data ? `${members.data.total} 人` : undefined,
    object: objects.data
      ? `${active} 张使用中${pending ? ` · ${pending} 张待发布` : ""}`
      : undefined,
  };
  const groups = workspaceSettingsNavigation(tenantCode).filter(
    (group) => !group.items.every((item) => item.icon === "overview"),
  );

  return (
    <Page width="settings">
      <PageHeader title="设置" description="公司的成员、数据结构和安全记录。" />
      {groups.map((group) => (
        <PageSection key={group.label} title={group.label}>
          <ul className={styles.rows}>
            {group.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={styles.row}>
                  <span className={styles.rowIcon} aria-hidden>
                    <NavIcon name={item.icon} />
                  </span>
                  <span className={styles.rowCopy}>
                    <strong>{item.label}</strong>
                    <span>{DESCRIPTIONS[item.icon]}</span>
                  </span>
                  {values[item.icon] ? (
                    <span className={styles.rowValue}>{values[item.icon]}</span>
                  ) : null}
                  <span className={styles.rowChevron} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </PageSection>
      ))}
    </Page>
  );
}
