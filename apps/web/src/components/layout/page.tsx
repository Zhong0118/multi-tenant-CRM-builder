import type { ReactNode } from "react";

import styles from "./page.module.css";

/**
 * The content area of one route. Every page picks one of four widths so that
 * the header, toolbar and content of all pages line up on the same edges:
 *
 * - `full`: business data and dashboards, edge to edge with page margins.
 * - `settings`: every page of the settings area, lists and forms alike, in one
 *   1040px column so their edges line up from page to page.
 * - `form`: a single form outside settings, such as a new record (≤720px).
 * - `reading`: a detail or log to read, such as an audit entry (≤1280px).
 * - `editor`: complex configuration — designers, builders, maps — that needs
 *   the desktop width for lists, an editor and a preview side by side.
 * - `bleed`: layouts that manage their own margins, such as the record page.
 */
export type PageWidth =
  "full" | "settings" | "form" | "reading" | "editor" | "bleed";

export function Page({
  width = "full",
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.page} ${className ?? ""}`} data-width={width}>
      <div className={styles.inner}>{children}</div>
    </div>
  );
}

/** Search and filters on the left, page-level actions on the right. */
export function PageToolbar({
  start,
  end,
  ariaLabel,
}: {
  start?: ReactNode;
  end?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div
      className={styles.toolbar}
      role={ariaLabel ? "toolbar" : undefined}
      aria-label={ariaLabel}
    >
      <div className={styles.toolbarStart}>{start}</div>
      {end ? <div className={styles.toolbarEnd}>{end}</div> : null}
    </div>
  );
}

/** A titled block inside a page: a heading outside the content, as in Linear settings. */
export function PageSection({
  title,
  description,
  extra,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {extra ? <div className={styles.sectionExtra}>{extra}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A settings row: the label and its help on the left, the control on the right. */
export function SettingRow({
  label,
  help,
  htmlFor,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>
        {htmlFor ? (
          <label htmlFor={htmlFor}>{label}</label>
        ) : (
          <span>{label}</span>
        )}
        {help ? <p>{help}</p> : null}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/** A list of setting rows, with an optional footer for the section's save action. */
export function SettingRows({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <div className={styles.rows}>{children}</div>
      {footer ? <div className={styles.sectionFooter}>{footer}</div> : null}
    </>
  );
}
