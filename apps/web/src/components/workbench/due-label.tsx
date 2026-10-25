import { describeDue } from "@/lib/format/due";

import styles from "./due-label.module.css";

/**
 * A due date as every list shows it: the relative label (已逾期 2 天 / 今天
 * 14:00 / 明天) coloured by urgency, the full date on hover and for screen
 * readers. Finished items show the date without urgency.
 */
export function DueLabel({
  dueAt,
  timeZone,
  now,
  settled = false,
  prefix,
}: {
  dueAt: string;
  timeZone: string;
  now: number;
  /** Done or cancelled: no urgency colour, no 已逾期. */
  settled?: boolean;
  prefix?: string;
}) {
  const due = describeDue(dueAt, timeZone, settled ? 0 : now);
  const label = settled ? due.full.replace(/（.*）$/, "") : due.label;
  return (
    <time
      dateTime={dueAt}
      title={due.full}
      className={styles.due}
      data-tone={settled ? "neutral" : due.tone}
    >
      {prefix ? <span className={styles.prefix}>{prefix}</span> : null}
      {label}
    </time>
  );
}
