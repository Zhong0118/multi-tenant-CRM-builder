import {
  datetimeLocalToUtcIso,
  utcIsoToDatetimeLocal,
} from "./dashboard-timezone";

export type WorkbenchPeriodPreset =
  | "this_week"
  | "this_month"
  | "past_7_days"
  | "past_30_days";

export const WORKBENCH_PERIOD_PRESETS: Array<{
  key: WorkbenchPeriodPreset;
  label: string;
}> = [
  { key: "this_week", label: "本周" },
  { key: "this_month", label: "本月" },
  { key: "past_7_days", label: "近 7 天" },
  { key: "past_30_days", label: "近 30 天" },
];

export function workbenchPeriodRange(
  preset: WorkbenchPeriodPreset,
  timeZone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const to = now.toISOString();
  if (preset === "past_7_days") {
    return { from: addUtcDays(now, -7).toISOString(), to };
  }
  if (preset === "past_30_days") {
    return { from: addUtcDays(now, -30).toISOString(), to };
  }
  return {
    from: startOfTenantCalendarUnit(
      preset === "this_week" ? "week" : "month",
      timeZone,
      now,
    ).toISOString(),
    to,
  };
}

export function workbenchPeriodPreset(
  range: { from: string; to: string },
  timeZone: string,
  now: Date = new Date(),
): WorkbenchPeriodPreset | null {
  for (const { key } of WORKBENCH_PERIOD_PRESETS) {
    const candidate = workbenchPeriodRange(key, timeZone, now);
    if (candidate.from === range.from && candidate.to === range.to) return key;
  }
  return null;
}

export function workbenchPeriodHref(
  pathname: string,
  range: { from: string; to: string },
): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  return `${pathname}?${params.toString()}`;
}

export function workbenchPath(tenantCode: string, dashboardCode?: string) {
  return dashboardCode
    ? `/workspace/${tenantCode}/dashboards/${dashboardCode}`
    : `/workspace/${tenantCode}`;
}

export function dashboardSettingsPath(
  tenantCode: string,
  dashboardCode?: string,
) {
  return `/workspace/${tenantCode}/settings/dashboards/${dashboardCode ?? "home"}`;
}

function startOfTenantCalendarUnit(
  unit: "week" | "month",
  timeZone: string,
  now: Date,
): Date {
  const local = utcIsoToDatetimeLocal(now.toISOString(), timeZone);
  const [year, month, day] = local.slice(0, 10).split("-").map(Number);
  let startYear = year;
  let startMonth = month;
  let startDay = 1;
  if (unit === "week") {
    const monday = new Date(Date.UTC(year, month - 1, day));
    monday.setUTCDate(monday.getUTCDate() - isoWeekdayMondayZero(now, timeZone));
    startYear = monday.getUTCFullYear();
    startMonth = monday.getUTCMonth() + 1;
    startDay = monday.getUTCDate();
  }
  const iso = datetimeLocalToUtcIso(
    `${pad(startYear)}-${pad(startMonth)}-${pad(startDay)}T00:00:00.000`,
    timeZone,
  );
  if (!iso) throw new Error("Unable to resolve tenant calendar start");
  return new Date(iso);
}

function isoWeekdayMondayZero(now: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(now);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
