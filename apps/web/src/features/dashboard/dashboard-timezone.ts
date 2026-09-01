interface WallClock {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  millisecond: string;
}

export function utcIsoToDatetimeLocal(value: string, timeZone: string): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid datetime");
  return wallClockText(wallClockAt(instant, wallClockFormatter(timeZone)));
}

export function datetimeLocalToUtcIso(
  value: string,
  timeZone: string,
  preferredInstant?: string,
): string | undefined {
  const candidates = datetimeLocalUtcCandidates(value, timeZone);
  const preferred = canonicalInstant(preferredInstant);
  return preferred && candidates.includes(preferred)
    ? preferred
    : candidates[0];
}

export function datetimeLocalUtcCandidates(
  value: string,
  timeZone: string,
): string[] {
  const target = parseWallClock(value);
  const targetEpoch = wallClockEpoch(target);
  const targetText = wallClockText(target);
  const formatter = wallClockFormatter(timeZone);
  const offsets = new Set<number>();
  const hour = 60 * 60 * 1000;

  for (let distance = -48; distance <= 48; distance += 1) {
    const probe = new Date(targetEpoch + distance * hour);
    offsets.add(
      wallClockEpoch(wallClockAt(probe, formatter)) - probe.getTime(),
    );
  }

  return Array.from(offsets)
    .map((offset) => new Date(targetEpoch - offset))
    .filter(
      (candidate) =>
        wallClockText(wallClockAt(candidate, formatter)) === targetText,
    )
    .map((candidate) => candidate.toISOString())
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .sort();
}

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function wallClockAt(instant: Date, formatter: Intl.DateTimeFormat): WallClock {
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  const second = part("second");
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error("Unable to format tenant wall-clock time");
  }
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond: String(instant.getUTCMilliseconds()).padStart(3, "0"),
  };
}

function parseWallClock(value: string): WallClock {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );
  if (!match) throw new Error("Invalid datetime-local value");
  const parsed = {
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
    second: match[6] ?? "00",
    millisecond: (match[7] ?? "0").padEnd(3, "0"),
  } satisfies WallClock;
  const instant = new Date(wallClockEpoch(parsed));
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.toISOString().slice(0, 23) !== wallClockText(parsed)
  ) {
    throw new Error("Invalid datetime-local value");
  }
  return parsed;
}

function wallClockEpoch(value: WallClock): number {
  return Date.parse(`${wallClockText(value)}Z`);
}

function wallClockText(value: WallClock): string {
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}.${value.millisecond}`;
}

function canonicalInstant(value?: string): string | undefined {
  if (!value) return undefined;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : undefined;
}
