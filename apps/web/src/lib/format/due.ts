/**
 * One way to describe when something is due, shared by the workbench,
 * follow-ups and tasks. Days are counted on the company calendar (its time
 * zone), never the browser's, so "今天" means the same day everywhere.
 */
export type DueTone = "danger" | "warning" | "info" | "neutral";

export interface DueDescription {
  /** Short text for lists: 「已逾期 2 天」「今天 14:00」「明天 09:30」. */
  label: string;
  tone: DueTone;
  overdue: boolean;
  /** Full local date and time, for a title or screen readers. */
  full: string;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const hour = values.hour === "24" ? "00" : values.hour;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    time: `${hour}:${values.minute}`,
    dayNumber:
      Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
      ) / 86_400_000,
  };
}

/** The calendar date (YYYY-MM-DD) of an instant in the company time zone. */
export function calendarDate(value: string | Date, timeZone: string): string {
  const date = parts(new Date(value), timeZone);
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function describeDue(
  dueAt: string,
  timeZone: string,
  now: number,
): DueDescription {
  const due = parts(new Date(dueAt), timeZone);
  const today = parts(new Date(now), timeZone);
  const days = due.dayNumber - today.dayNumber;
  const overdue = new Date(dueAt).getTime() < now;
  const weekday =
    WEEKDAYS[new Date(Date.UTC(due.year, due.month - 1, due.day)).getUTCDay()];
  const dateText =
    due.year === today.year
      ? `${due.month}月${due.day}日`
      : `${due.year}年${due.month}月${due.day}日`;
  const full = `${calendarDate(dueAt, timeZone)} ${due.time}（周${weekday}）`;
  if (overdue) {
    return {
      label: days === 0 ? `已逾期 · 今天 ${due.time}` : `已逾期 ${-days} 天`,
      tone: "danger",
      overdue: true,
      full,
    };
  }
  if (days === 0)
    return { label: `今天 ${due.time}`, tone: "warning", overdue: false, full };
  if (days === 1)
    return { label: `明天 ${due.time}`, tone: "info", overdue: false, full };
  if (days < 7)
    return {
      label: `周${weekday} ${due.time}`,
      tone: "neutral",
      overdue: false,
      full,
    };
  return {
    label: `${dateText} ${due.time}`,
    tone: "neutral",
    overdue: false,
    full,
  };
}
