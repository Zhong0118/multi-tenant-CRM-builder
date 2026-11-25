import { datetimeLocalUtcCandidates } from "../dashboard/dashboard-timezone";
import { parseImportDate } from "@/lib/import-date";

export type ImportDateOrder = "DMY" | "MDY";

const yearLast = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/;
const dateAndTime =
  /^([^\sT]+)(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function orderedDate(match: RegExpExecArray, order: ImportDateOrder) {
  const [, first, , second, year] = match;
  return parseImportDate(
    order === "MDY"
      ? `${year}-${first}-${second}`
      : `${year}-${second}-${first}`,
  );
}

// Invalid cells report their own row error and cannot decide the order of other rows.
export function inferImportDateOrder(
  values: Iterable<string>,
): ImportDateOrder | "ambiguous" | "conflict" | undefined {
  let order: ImportDateOrder | undefined;
  let ambiguous = false;
  for (const value of values) {
    const parts = parseDateTimeParts(value.trim());
    const match = parts && yearLast.exec(parts.date);
    if (!match) continue;
    const dmy = orderedDate(match, "DMY");
    const mdy = orderedDate(match, "MDY");
    if (!dmy && !mdy) continue;
    if (dmy && mdy) {
      ambiguous = true;
      continue;
    }
    const candidate = dmy ? "DMY" : "MDY";
    if (order && order !== candidate) return "conflict";
    order = candidate;
  }
  return order ?? (ambiguous ? "ambiguous" : undefined);
}

function calendarDate(value: string, order?: ImportDateOrder) {
  const match = yearLast.exec(value);
  if (match) {
    if (!order && (orderedDate(match, "DMY") || orderedDate(match, "MDY")))
      throw new Error("请选择日期顺序（日/月/年或月/日/年）");
    return order ? orderedDate(match, order) : null;
  }
  const chinese = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(value);
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const parts = chinese ?? compact;
  return parseImportDate(parts ? `${parts[1]}-${parts[2]}-${parts[3]}` : value);
}

function parseDateTimeParts(value: string) {
  const parts = dateAndTime.exec(value);
  if (!parts) return undefined;
  const [
    ,
    date,
    hour = "00",
    minute = "00",
    second = "00",
    fraction = "",
    offset,
  ] = parts;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)
    return undefined;
  if (
    offset &&
    offset !== "Z" &&
    (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)
  )
    return undefined;
  return { date, hour, minute, second, fraction, offset };
}

export function coerceImportDate(
  type: "DATE" | "DATETIME",
  value: string,
  { timeZone, dateOrder }: { timeZone?: string; dateOrder?: ImportDateOrder },
): string {
  const parts = parseDateTimeParts(value);
  if (!parts) throw new Error("日期或时间无效");
  const { date, hour, minute, second, fraction, offset } = parts;
  const normalized = calendarDate(date, dateOrder);
  if (!normalized) throw new Error("日期无效");
  if (type === "DATE") return normalized;
  const wallClock = `${normalized}T${hour.padStart(2, "0")}:${minute}:${second}.${fraction.slice(0, 3).padEnd(3, "0")}`;
  if (offset) return new Date(wallClock + offset).toISOString();
  if (!timeZone) throw new Error("未取得公司时区，无法转换本地时间");
  let candidates: string[];
  try {
    candidates = datetimeLocalUtcCandidates(wallClock, timeZone);
  } catch {
    throw new Error("公司时区无效，无法转换本地时间");
  }
  if (candidates.length !== 1)
    throw new Error("该时间在公司时区跳过或重复，请填写带时区偏移的时间");
  return candidates[0];
}
