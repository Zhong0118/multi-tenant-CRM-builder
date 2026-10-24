import Link from "next/link";

import { PageSection } from "@/components/layout/page";
import { NavIcon } from "@/components/navigation/nav-icon";
import type { WorkspaceNavigationGroup } from "@/components/navigation/workspace-navigation";
import { StatusTag } from "@/components/workbench/status-tag";

import styles from "./workspace-settings.module.css";

/** What a settings page is for and when its changes reach employees. */
const PAGES: Record<
  string,
  { description: string; effect?: "immediate" | "publish" }
> = {
  members: {
    description: "邀请成员，调整角色，为员工设置访问权限例外，办理离职交接。",
    effect: "immediate",
  },
  object: {
    description: "字段、表单、列表和员工默认权限，发布业务表后对员工生效。",
    effect: "publish",
  },
  relation: {
    description: "业务表之间的关联和跨表自动化，随业务表发布生效。",
    effect: "publish",
  },
  stats: {
    description: "工作台的指标、分布和列表，发布工作台后生效。",
    effect: "publish",
  },
  audit: { description: "成员、业务表和记录的每一次变更。" },
};

const EFFECT_LABEL = { immediate: "保存即生效", publish: "发布后生效" };

export interface SettingsOverviewStatus {
  /** A short status per page, keyed by navigation icon; `null` when it failed to load. */
  values: Record<string, string | null | undefined>;
  /** Business tables whose saved changes are not published yet. */
  pendingTables: number;
}

/**
 * The settings home: the settings sidebar's groups, one row per page with what
 * it is for, when its changes take effect, and where it stands.
 */
export function SettingsOverview({
  groups,
  status,
  objectsHref,
}: {
  groups: WorkspaceNavigationGroup[];
  status: SettingsOverviewStatus;
  objectsHref: string;
}) {
  return (
    <>
      <p className={styles.effectNote}>
        标有「发布后生效」的设置先保存为草稿，员工在发布前仍使用上一版；其余设置保存后立即生效。
      </p>
      {status.pendingTables > 0 ? (
        <Link href={objectsHref} className={styles.attention}>
          <StatusTag tone="warning">待发布</StatusTag>
          <span>
            {status.pendingTables}{" "}
            张业务表有未发布的修改，员工仍在使用上次发布的版本。
          </span>
          <span className={styles.attentionAction}>去发布</span>
        </Link>
      ) : null}
      {groups.map((group) => (
        <PageSection key={group.label} title={group.label}>
          <ul className={styles.rows}>
            {group.items.map((item) => {
              const page = PAGES[item.icon];
              const value = status.values[item.icon];
              return (
                <li key={item.href}>
                  <Link href={item.href} className={styles.row}>
                    <span className={styles.rowIcon} aria-hidden>
                      <NavIcon name={item.icon} />
                    </span>
                    <span className={styles.rowCopy}>
                      <span className={styles.rowTitle}>
                        <strong>{item.label}</strong>
                        {page?.effect ? (
                          <span
                            className={styles.effect}
                            data-effect={page.effect}
                          >
                            {EFFECT_LABEL[page.effect]}
                          </span>
                        ) : null}
                      </span>
                      {page ? <span>{page.description}</span> : null}
                    </span>
                    {value !== undefined ? (
                      <span
                        className={styles.rowValue}
                        data-failed={value === null || undefined}
                      >
                        {value ?? "状态读取失败"}
                      </span>
                    ) : null}
                    <span className={styles.rowChevron} aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </PageSection>
      ))}
    </>
  );
}
